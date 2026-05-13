import { assembleTemplate } from "./assemble.js"
import { createMemoryStore } from "./cache.js"
import { parseDuration } from "./duration.js"
import { BudgetExceededError, ToolDeniedError } from "./errors.js"
import { matchKey, serializeKey } from "./key.js"
import type {
	AnyBinding,
	BindingMetric,
	CacheEntry,
	ContextClient,
	ContextClientOptions,
	KeyMatcher,
	TelemetryAdapter,
	ToolBinding,
	Unsubscribe,
} from "./types.js"
import type { AssembleOptions, BindingKey, SinkAdapter, SinkOutput } from "./types.js"

import type { AssemblyResolveInput, ResolvedAssemblyCell } from "./assemble.js"

type BindingTyped<T> = import("./types.js").Binding<T>

function isMatcher(value: BindingKey | KeyMatcher): value is KeyMatcher {
	return !Array.isArray(value)
}

function toMatcher(target: BindingKey | KeyMatcher): KeyMatcher {
	if (isMatcher(target)) {
		return target
	}
	return { exact: target }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		const err = new Error("Aborted")
		err.name = "AbortError"
		return Promise.reject(err)
	}
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			globalThis.clearTimeout(timer)
			const err = new Error("Aborted")
			err.name = "AbortError"
			reject(err)
		}
		const timer = globalThis.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		signal?.addEventListener("abort", onAbort, { once: true })
	})
}

async function backoffDelay(
	attemptIdx: number,
	mode: "linear" | "exponential",
	baseMs: number,
	signal?: AbortSignal,
) {
	const mult = mode === "exponential" ? 2 ** Math.max(0, attemptIdx - 1) : Math.max(1, attemptIdx)
	await sleep(mult * baseMs, signal)
}

function tokenEstimate(value: unknown): number {
	if (typeof value === "string") {
		return Math.ceil(value.length / 4)
	}
	try {
		return Math.ceil(JSON.stringify(value ?? null).length / 4)
	} catch {
		return Math.ceil(`${value}`.length / 4)
	}
}

const NEVER_ABORTED = new AbortController().signal

function combineSignals(primary?: AbortSignal, secondary?: AbortSignal): AbortSignal {
	if (!primary) {
		return secondary ?? NEVER_ABORTED
	}
	if (!secondary) {
		return primary
	}
	return AbortSignal.any([primary, secondary])
}

export function createContextClient(opts: ContextClientOptions = {}): ContextClient {
	const store = opts.store ?? createMemoryStore()
	const telemetry = opts.telemetry
	const userWarningHook = opts.onWarning
	const permissions = opts.permissions
	const budget = opts.budget

	const syncSnapshot = new Map<string, CacheEntry<unknown>>()
	const registryKeyBySer = new Map<string, BindingKey>()
	const bindingsBySer = new Map<string, AnyBinding>()
	const dependents = new Map<string, Set<string>>()

	const inflight = new Map<string, Promise<void>>()
	const bgInflight = new Set<string>()
	const mounted = new Map<string, Unsubscribe>()
	const registeredSinks = new Map<string, import("./types.js").SinkAdapter>()
	const toolsByName = new Map<string, ToolBinding<unknown, unknown>>()

	const accounting = {
		cumulativeTokens: 0,
		assembliesTotal: 0,
		assembliesThisWindow: 0,
		fetchesThisWindow: 0,
		windowStart: Date.now(),
	}

	let windowTimer: ReturnType<typeof setInterval> | undefined
	if (budget && (budget.maxAssembliesPerMinute || budget.maxFetchesPerMinute)) {
		windowTimer = setInterval(() => {
			accounting.assembliesThisWindow = 0
			accounting.fetchesThisWindow = 0
			accounting.windowStart = Date.now()
		}, 60_000)
		if (typeof windowTimer === "object" && "unref" in windowTimer) {
			;(windowTimer as { unref: () => void }).unref()
		}
	}

	let disposed = false
	const masterAbort = new AbortController()

	const notifyWarning = (w: import("./types.js").Warning) => {
		try {
			userWarningHook?.(w)
			telemetry?.recordWarning(w)
		} catch {
			//
		}
	}

	async function hydrate(keySer: string): Promise<CacheEntry<unknown> | undefined> {
		const entry = await store.get(keySer)
		if (!entry) {
			syncSnapshot.delete(keySer)
			return undefined
		}
		if (Date.now() > entry.expiresAt) {
			syncSnapshot.delete(keySer)
			await store.delete(keySer)
			return undefined
		}
		syncSnapshot.set(keySer, entry)
		return entry
	}

	async function persist(keySer: string, entry: CacheEntry<unknown>): Promise<void> {
		syncSnapshot.set(keySer, entry)
		await store.set(keySer, entry)
	}

	function register(binding: AnyBinding): void {
		const ser = serializeKey(binding.__def.key)
		registryKeyBySer.set(ser, [...binding.__def.key])
		bindingsBySer.set(ser, binding)

		const depsRaw = binding.__def.dependsOn ? Object.values(binding.__def.dependsOn) : []
		for (const dep of depsRaw) {
			const d = dep as AnyBinding
			const dser = serializeKey(d.__def.key)
			let set = dependents.get(dser)
			if (!set) {
				set = new Set<string>()
				dependents.set(dser, set)
			}
			set.add(ser)
		}
	}

	function staleMs(binding: AnyBinding): number {
		try {
			const dur =
				binding.__def.staleTime !== undefined
					? binding.__def.staleTime
					: (opts.defaultStaleTime ?? 0)
			const bindingStale = parseDuration(dur as import("./types.js").Duration)
			const budgetFloor = budget?.minStaleTime
				? parseDuration(budget.minStaleTime as import("./types.js").Duration)
				: 0
			return Math.max(bindingStale, budgetFloor)
		} catch (e) {
			notifyWarning({
				code: "schema-mismatch",
				message: `Invalid staleTime for binding ${serializeKey(binding.__def.key)}: ${e instanceof Error ? e.message : String(e)}`,
				bindingKey: binding.__def.key,
				severity: "warn",
			})
			return 0
		}
	}

	function gcMs(binding: AnyBinding): number {
		try {
			const dur =
				binding.__def.gcTime !== undefined ? binding.__def.gcTime : (opts.defaultGcTime ?? "5m")
			return parseDuration(dur as import("./types.js").Duration)
		} catch (e) {
			notifyWarning({
				code: "schema-mismatch",
				message: `Invalid gcTime for binding ${serializeKey(binding.__def.key)}: ${e instanceof Error ? e.message : String(e)}`,
				bindingKey: binding.__def.key,
				severity: "warn",
			})
			return parseDuration("5m")
		}
	}

	function logicallyFresh(entry: CacheEntry<unknown>, binding: AnyBinding): boolean {
		return entry.state !== "error" && Date.now() - entry.fetchedAt < staleMs(binding)
	}

	function logicallyStaleServing(entry: CacheEntry<unknown>, binding: AnyBinding): boolean {
		const now = Date.now()
		if (entry.state === "error" || now > entry.expiresAt) {
			return false
		}
		return entry.state === "stale" || now - entry.fetchedAt >= staleMs(binding)
	}

	async function keysMatching(matcher: KeyMatcher): Promise<Set<string>> {
		const out = new Set<string>()
		for await (const ks of store.keys()) {
			const bk = registryKeyBySer.get(ks)
			if (!bk || !matchKey(bk, matcher)) {
				continue
			}
			out.add(ks)
		}
		return out
	}

	async function expandAffected(seeds: Set<string>): Promise<Set<string>> {
		const acc = new Set<string>(seeds)
		const fifo = [...seeds]
		while (fifo.length) {
			const cur = fifo.pop()
			if (!cur) {
				break
			}
			for (const nxt of dependents.get(cur) ?? []) {
				if (!acc.has(nxt)) {
					acc.add(nxt)
					fifo.push(nxt)
				}
			}
		}
		return acc
	}

	async function markStaleSerialized(keys: Iterable<string>): Promise<void> {
		for (const ks of keys) {
			const e = await hydrate(ks)
			if (!e) {
				continue
			}
			await persist(ks, { ...e, state: "stale" })
		}
	}

	async function fetchWithRetry(
		binding: AnyBinding,
		depsVals: Record<string, unknown>,
		signalOuter: AbortSignal | undefined,
		selfClient: ContextClient,
		mode: AssemblyResolveInput["onBindingError"],
	): Promise<{ value?: unknown; omitted?: boolean; latencyMs: number; retries: number }> {
		if (budget?.maxFetchesPerMinute) {
			if (accounting.fetchesThisWindow >= budget.maxFetchesPerMinute) {
				const budgetAction = budget.onExceeded ?? "throw"
				const w: import("./types.js").Warning = {
					code: "budget-exceeded",
					message: `Fetch rate limit exceeded: ${accounting.fetchesThisWindow + 1}/${budget.maxFetchesPerMinute} per minute`,
					bindingKey: binding.__def.key,
					severity: "error",
				}
				notifyWarning(w)
				if (budgetAction === "throw") {
					throw new BudgetExceededError(
						"fetches",
						budget.maxFetchesPerMinute,
						accounting.fetchesThisWindow + 1,
					)
				}
				const cached = syncSnapshot.get(serializeKey(binding.__def.key))
				if (cached && cached.state !== "error") {
					return { value: cached.value, latencyMs: 0, retries: 0 }
				}
			}
			accounting.fetchesThisWindow++
		}

		const rp = binding.__def.retry
		const maxAttempts = rp?.attempts ?? 1
		const backoffMode = rp?.backoff ?? "linear"
		const baseMs = parseDuration(rp?.baseDelay ?? "100ms")

		let retries = 0
		let lastErr: unknown
		const outer = combineSignals(signalOuter, masterAbort.signal)

		const t0 = Date.now()

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const tStart = Date.now()
			try {
				const pend = binding.__def.fetch(depsVals as never, { signal: outer, client: selfClient })
				const value = await Promise.resolve(pend)
				const latency = Date.now() - t0
				try {
					telemetry?.recordFetch(binding.__def.key, Date.now() - tStart, true)
				} catch {
					//
				}
				return { value, latencyMs: latency, retries }
			} catch (err) {
				lastErr = err
				try {
					telemetry?.recordFetch(binding.__def.key, Date.now() - tStart, false)
				} catch {
					//
				}

				if (attempt >= maxAttempts || outer.aborted || masterAbort.signal.aborted) {
					break
				}
				retries++
				await backoffDelay(attempt, backoffMode, baseMs, outer)
			}
		}

		if (mode === "fallback-or-omit") {
			if (binding.__def.fallback !== undefined) {
				return { value: binding.__def.fallback, latencyMs: Date.now() - t0, retries }
			}
			return { omitted: true, latencyMs: Date.now() - t0, retries }
		}

		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
	}

	function scheduleBackgroundPull(
		keySer: string,
		binding: AnyBinding,
		depVals: Record<string, unknown>,
	): void {
		if (disposed || bgInflight.has(keySer)) {
			return
		}
		bgInflight.add(keySer)
		globalThis.setTimeout(() => {
			void (async () => {
				try {
					const res = await fetchWithRetry(binding, depVals, undefined, clientRef, "throw")
					const now = Date.now()
					await persist(keySer, {
						value: res.value,
						fetchedAt: now,
						expiresAt: now + gcMs(binding),
						state: "fresh",
					})
				} catch (err) {
					console.error(`[livectx] background refetch failed for ${keySer}`, err)
				} finally {
					bgInflight.delete(keySer)
				}
			})()
		}, 0)
	}

	function finalizeCellResolved(
		binding: AnyBinding,
		entry: CacheEntry<unknown> | undefined,
		foreground: { ran: boolean; latencyMs?: number; retries?: number },
		mode: AssemblyResolveInput["onBindingError"],
	): ResolvedAssemblyCell {
		if (!entry) {
			if (mode === "fallback-or-omit") {
				return { value: undefined, omitted: true, metric: { source: "error", tokens: 0 } }
			}
			return { value: undefined, metric: { source: "error", tokens: 0 } }
		}

		let source: BindingMetric["source"] = "subscription"

		if (foreground.ran && entry.state !== "error") {
			source = "fetch"
		} else if (entry.state === "error") {
			source = "error"
			if (mode === "fallback-or-omit" && binding.__def.fallback !== undefined) {
				return {
					value: binding.__def.fallback,
					metric: { source: "error", tokens: tokenEstimate(binding.__def.fallback) },
				}
			}
			if (mode === "fallback-or-omit") {
				return { value: undefined, omitted: true, metric: { source: "error", tokens: 0 } }
			}
		} else if (!foreground.ran && logicallyFresh(entry, binding)) {
			source = "cache-fresh"
		} else if (!foreground.ran && logicallyStaleServing(entry, binding)) {
			source = "cache-stale"
		} else if (foreground.ran && entry.state === "fresh") {
			source = "fetch"
		}

		const cell: ResolvedAssemblyCell = {
			value: entry.value,
			metric: {
				source,
				ageMs: Math.max(0, Date.now() - entry.fetchedAt),
				tokens: tokenEstimate(entry.value),
				latencyMs: foreground.ran ? foreground.latencyMs : undefined,
				retries: foreground.ran ? foreground.retries : undefined,
			},
		}

		if (foreground.ran && foreground.latencyMs !== undefined) {
			cell.fetchLatencyMs = foreground.latencyMs
		}

		return cell
	}

	// biome-ignore lint/style/useConst: wired after clientImpl initialization for cyclic references
	let clientRef!: ContextClient

	async function resolveCell(
		binding: AnyBinding,
		opts: Pick<AssemblyResolveInput, "resolvedDeps" | "signal" | "onBindingError">,
		selfClient: ContextClient,
	): Promise<ResolvedAssemblyCell> {
		register(binding)
		const ser = serializeKey(binding.__def.key)

		const wait = inflight.get(ser)
		if (wait) {
			await wait
			const cached = await hydrate(ser)
			return finalizeCellResolved(binding, cached, { ran: false }, opts.onBindingError)
		}

		let foreground: { ran: boolean; latencyMs?: number; retries?: number } = { ran: false }

		const work = (async () => {
			const signal = combineSignals(opts.signal, masterAbort.signal)
			const mode = opts.onBindingError ?? "throw"
			const entry = await hydrate(ser)

			async function writeFresh(value: unknown): Promise<void> {
				const now = Date.now()
				await persist(ser, {
					value,
					fetchedAt: now,
					expiresAt: now + gcMs(binding),
					state: "fresh",
				})
			}

			async function writeErr(e?: Error): Promise<void> {
				const now = Date.now()
				await persist(ser, {
					value: undefined as never,
					fetchedAt: now,
					expiresAt: now + gcMs(binding),
					state: "error",
					error: e,
				})
			}

			async function fetchAndPersist(): Promise<void> {
				const res = await fetchWithRetry(binding, opts.resolvedDeps, signal, selfClient, mode)
				if (res.omitted) {
					await writeErr(new Error("omitted"))
				} else {
					await writeFresh(res.value)
				}
				foreground = { ran: true, latencyMs: res.latencyMs, retries: res.retries }
			}

			if (!entry) {
				await fetchAndPersist()
				return
			}

			if (entry.state === "error") {
				if (mode === "fallback-or-omit" && binding.__def.fallback !== undefined) {
					await writeFresh(binding.__def.fallback)
					return
				}
				if (mode === "fallback-or-omit") {
					return
				}
				await fetchAndPersist()
				return
			}

			if (logicallyFresh(entry, binding)) {
				return
			}

			if (logicallyStaleServing(entry, binding)) {
				scheduleBackgroundPull(ser, binding, opts.resolvedDeps)
				return
			}

			await fetchAndPersist()
		})().finally(() => {
			inflight.delete(ser)
		})

		inflight.set(ser, work)
		await work

		const frozen = await hydrate(ser)
		return finalizeCellResolved(binding, frozen, foreground, opts.onBindingError)
	}

	async function prefetchCascade(binding: AnyBinding): Promise<void> {
		register(binding)
		const deps = binding.__def.dependsOn ? Object.entries(binding.__def.dependsOn) : []

		const depVals: Record<string, unknown> = {}
		for (const [nm, rawDep] of deps) {
			const db = rawDep as AnyBinding
			await prefetchCascade(db)
			const ks = serializeKey(db.__def.key)
			const e = await hydrate(ks)
			depVals[nm] = e?.value
		}

		await resolveCell(
			binding,
			{ resolvedDeps: depVals, signal: masterAbort.signal, onBindingError: "throw" },
			clientRef,
		)
	}

	const clientImpl: ContextClient = {
		async assemble<F extends SinkAdapter>(
			assembleOpts: AssembleOptions<F>,
		): Promise<SinkOutput<F>> {
			if (disposed) {
				throw new Error("ContextClient disposed")
			}

			let truncateToTokens: number | undefined
			if (budget?.onExceeded === "truncate") {
				const limits: number[] = []
				if (budget.maxTokensPerAssembly) limits.push(budget.maxTokensPerAssembly)
				if (budget.maxCumulativeTokens) {
					const remaining = budget.maxCumulativeTokens - accounting.cumulativeTokens
					if (remaining > 0) limits.push(remaining)
				}
				if (limits.length) truncateToTokens = Math.min(...limits)
			}

			const { output, metrics, collectedToolBindings } = await assembleTemplate(
				{
					registerBinding: register,
					resolveAssemblyValue: (bb, inp) =>
						resolveCell(
							bb,
							{
								resolvedDeps: inp.resolvedDeps,
								signal: inp.signal,
								onBindingError: inp.onBindingError,
							},
							clientRef,
						),
					emitWarning: notifyWarning,
					telemetry,
				},
				clientRef,
				assembleOpts,
				truncateToTokens,
			)

			for (const t of collectedToolBindings) {
				toolsByName.set(t.__tool.name, t)
			}

			accounting.assembliesTotal++

			if (budget?.maxAssembliesPerMinute) {
				accounting.assembliesThisWindow++
				if (accounting.assembliesThisWindow > budget.maxAssembliesPerMinute) {
					const w: import("./types.js").Warning = {
						code: "budget-exceeded",
						message: `Assembly rate limit exceeded: ${accounting.assembliesThisWindow}/${budget.maxAssembliesPerMinute} per minute`,
						severity: "error",
					}
					notifyWarning(w)
					if ((budget.onExceeded ?? "throw") === "throw") {
						throw new BudgetExceededError(
							"assemblies",
							budget.maxAssembliesPerMinute,
							accounting.assembliesThisWindow,
						)
					}
				}
			}

			if (
				budget?.maxTokensPerAssembly &&
				metrics.prompt.totalTokens > budget.maxTokensPerAssembly
			) {
				const w: import("./types.js").Warning = {
					code: "budget-exceeded",
					message: `Assembly token limit exceeded: ${metrics.prompt.totalTokens}/${budget.maxTokensPerAssembly}`,
					severity: "error",
				}
				notifyWarning(w)
				if ((budget.onExceeded ?? "throw") === "throw") {
					throw new BudgetExceededError(
						"tokens",
						budget.maxTokensPerAssembly,
						metrics.prompt.totalTokens,
					)
				}
			}

			accounting.cumulativeTokens += metrics.prompt.totalTokens
			if (budget?.maxCumulativeTokens && accounting.cumulativeTokens > budget.maxCumulativeTokens) {
				const w: import("./types.js").Warning = {
					code: "budget-exceeded",
					message: `Cumulative token budget exceeded: ${accounting.cumulativeTokens}/${budget.maxCumulativeTokens}`,
					severity: "error",
				}
				notifyWarning(w)
				if ((budget.onExceeded ?? "throw") === "throw") {
					throw new BudgetExceededError(
						"cumulative",
						budget.maxCumulativeTokens,
						accounting.cumulativeTokens,
					)
				}
			}

			try {
				telemetry?.recordAssemble(metrics)
			} catch {
				//
			}

			return output
		},

		async prefetch(b) {
			if (disposed) {
				throw new Error("ContextClient disposed")
			}
			await prefetchCascade(b)
		},

		async invalidate(mat) {
			if (disposed) {
				return
			}
			const matcher = toMatcher(mat)
			const seeded = await keysMatching(matcher)
			await markStaleSerialized(await expandAffected(seeded))
		},

		async refetch(mat) {
			if (disposed) {
				return
			}
			await clientImpl.invalidate(mat)

			const seeded = await keysMatching(toMatcher(mat))
			const seedsExpanded = await expandAffected(seeded)
			const visited = new Set<string>()

			async function purgeSerializedKey(serial: string): Promise<void> {
				inflight.delete(serial)
				syncSnapshot.delete(serial)
				await store.delete(serial)
			}

			async function refreshSubtree(ser: string): Promise<void> {
				const bd = bindingsBySer.get(ser)
				if (!bd || visited.has(ser)) {
					return
				}
				visited.add(ser)

				const depEntries = bd.__def.dependsOn ? Object.entries(bd.__def.dependsOn) : []

				const depVals: Record<string, unknown> = {}
				for (const [nm, rawDep] of depEntries) {
					const dep = rawDep as AnyBinding
					const dser = serializeKey(dep.__def.key)
					await refreshSubtree(dser)
					const ee = await hydrate(dser)
					depVals[nm] = ee?.value
				}

				await purgeSerializedKey(ser)
				await resolveCell(
					bd,
					{ resolvedDeps: depVals, signal: masterAbort.signal, onBindingError: "throw" },
					clientRef,
				)
			}

			for (const k of seedsExpanded) {
				await refreshSubtree(k)
			}
		},

		getCacheEntry<T>(binding: BindingTyped<T>) {
			const ser = serializeKey(binding.__def.key as BindingKey)
			return syncSnapshot.get(ser) as CacheEntry<T> | undefined
		},

		setCacheEntry<T>(binding: BindingTyped<T>, value: T): void {
			const ser = serializeKey(binding.__def.key as BindingKey)
			const now = Date.now()
			void persist(ser, {
				value,
				fetchedAt: now,
				expiresAt: now + gcMs(binding as unknown as AnyBinding),
				state: "fresh",
			}).catch((err) => {
				notifyWarning({
					code: "subscription-dropped",
					message: `setCacheEntry persist failed: ${err instanceof Error ? err.message : String(err)}`,
					bindingKey: binding.__def.key as BindingKey,
					severity: "error",
				})
			})
		},

		mount(b) {
			if (disposed) {
				return () => {}
			}
			register(b)
			const ks = serializeKey(b.__def.key)
			const prev = mounted.get(ks)
			prev?.()
			const u = b.__def.subscribe?.(() => {
				void clientImpl.invalidate(b.__def.key as BindingKey)
			})
			if (!u) {
				return () => {}
			}
			mounted.set(ks, u)
			return () => {
				try {
					u()
				} catch {
					//
				}
				mounted.delete(ks)
			}
		},

		isMounted(b) {
			return mounted.has(serializeKey(b.__def.key))
		},

		registerSink(nm, adapter) {
			registeredSinks.set(nm, adapter)
		},

		getUsage(): import("./types.js").UsageSnapshot {
			return {
				cumulativeTokens: accounting.cumulativeTokens,
				assembliesTotal: accounting.assembliesTotal,
				assembliesThisWindow: accounting.assembliesThisWindow,
				fetchesThisWindow: accounting.fetchesThisWindow,
				budgetRemaining: {
					tokens: budget?.maxCumulativeTokens
						? Math.max(0, budget.maxCumulativeTokens - accounting.cumulativeTokens)
						: "unlimited",
					assemblies: budget?.maxAssembliesPerMinute
						? Math.max(0, budget.maxAssembliesPerMinute - accounting.assembliesThisWindow)
						: "unlimited",
				},
			}
		},

		registerTool(tb) {
			toolsByName.set(tb.__tool.name, tb as ToolBinding<unknown, unknown>)
		},

		async executeTool(nm, input) {
			if (disposed) {
				throw new Error("ContextClient disposed")
			}
			const tb = toolsByName.get(nm)
			if (!tb) {
				throw new Error(`Unknown tool "${nm}"`)
			}

			if (permissions?.onToolCall) {
				const allowed = await permissions.onToolCall({
					name: nm,
					input,
					description: tb.__tool.description,
					bindingKey: tb.__tool.key,
				})
				if (!allowed) {
					if (permissions.onDeny === "throw") {
						throw new ToolDeniedError(nm, input)
					}
					return { error: `Tool "${nm}" was denied by permissions hook.` }
				}
			}

			const parsed = tb.__tool.input.parse(input)
			return tb.__tool.fetch(parsed as never, { signal: masterAbort.signal, client: clientRef })
		},

		async dispose() {
			if (windowTimer) {
				clearInterval(windowTimer)
				windowTimer = undefined
			}
			disposed = true
			masterAbort.abort()
			bgInflight.clear()
			inflight.clear()

			for (const u of mounted.values()) {
				try {
					u()
				} catch {
					//
				}
			}
			mounted.clear()
			syncSnapshot.clear()
			registryKeyBySer.clear()
			bindingsBySer.clear()
			dependents.clear()
			toolsByName.clear()
			await store.clear()
		},
	}

	clientRef = clientImpl

	return clientRef
}
