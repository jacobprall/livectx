import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	assembleTemplate,
	createContextClient,
	parseDuration,
	prompt,
	serializeKey,
	source,
} from "../src/index.js"
import type { AssembledSegments, ResolvedTool, SinkAdapter, SinkOutput } from "../src/types.js"

async function flushMicrotasks(times = 16) {
	for (let i = 0; i < times; i++) {
		await Promise.resolve()
	}
}

function captureSink(): SinkAdapter<{
	segments: AssembledSegments
	tools: readonly ResolvedTool[]
}> {
	return {
		name: "capture",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]) {
			return { segments, tools }
		},
	}
}

describe("createContextClient (deterministic timers)", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("cold miss invokes fetch exactly once across repeated reads when fresh window holds", async () => {
		const spy = vi.fn(async () => "v")
		const b = source({ key: ["miss"], staleTime: "10m", fetch: spy })
		const client = createContextClient()
		await client.assemble({
			template: prompt`x:${b}`,
			sink: captureSink(),
		})
		await client.assemble({
			template: prompt`y:${b}`,
			sink: captureSink(),
		})

		expect(spy).toHaveBeenCalledTimes(1)
		await client.dispose()
	})

	it("in-flight dedup coalesces parallel prefetches", async () => {
		const spy = vi.fn(async () => {
			await new Promise<void>((resolve) => {
				globalThis.setTimeout(resolve, 15)
			})
			return 1
		})
		const b = source({ key: ["dedup"], staleTime: "1h", gcTime: "2h", fetch: spy })
		const client = createContextClient()
		const pa = client.prefetch(b)
		const pb = client.prefetch(b)
		await Promise.resolve()
		await vi.runAllTimersAsync()
		await Promise.all([pa, pb])
		expect(spy).toHaveBeenCalledTimes(1)
		await client.dispose()
	})

	it("invalidate cascades dependents as stale markers", async () => {
		const dep = source({ key: ["depCascade"], staleTime: "1h", fetch: vi.fn(async () => "dep") })
		const child = source({
			key: ["childCascade"],
			staleTime: "1h",
			dependsOn: { dep },
			fetch: async ({ dep: d }: { dep: unknown }) => `child:${String(d)}`,
		})

		const client = createContextClient()
		await client.prefetch(dep)
		await client.prefetch(child)

		await client.invalidate(["depCascade"])

		expect(client.getCacheEntry(child)?.state).toBe("stale")

		await client.dispose()
	})

	it("dispose clears persisted cache entries", async () => {
		const b = source({ key: ["disp"], staleTime: "1h", fetch: vi.fn(async () => 99) })
		const client = createContextClient()
		await client.prefetch(b)
		expect(client.getCacheEntry(b)).toBeTruthy()
		await client.dispose()
		expect(client.getCacheEntry(b)).toBeUndefined()
	})

	it("dispose rejects later operations", async () => {
		const b = source({ key: ["afterDispose"], staleTime: "1h", fetch: vi.fn(async () => "x") })
		const client = createContextClient()
		await client.dispose()
		await expect(client.assemble({ template: prompt`${b}`, sink: captureSink() })).rejects.toThrow(
			/disposed/u,
		)
		await expect(client.prefetch(b)).rejects.toThrow(/disposed/u)
	})

	it("reports cache-stale on reads past stale TTL then refreshes asynchronously", async () => {
		vi.setSystemTime(0)
		const spy = vi.fn(async () => "v")
		const b = source({ key: ["win"], staleTime: "40ms", gcTime: "1h", fetch: spy })

		const client = createContextClient()
		await client.assemble({
			template: prompt`${b}`,
			sink: captureSink(),
		})
		expect(spy).toHaveBeenCalledTimes(1)

		vi.setSystemTime(parseDuration("200ms"))

		const metrics = await client.assemble({
			template: prompt`${b}`,
			sink: captureSink(),
		})

		const kind = metrics.segments.metrics.bindings[serializeKey(b.__def.key)]?.source
		expect(kind).toBe("cache-stale")

		await flushMicrotasks()
		await vi.runAllTimersAsync()
		expect(spy).toHaveBeenCalledTimes(2)

		await client.dispose()
	})

	it("fallback-or-omit returns binding fallback without throwing", async () => {
		const b = source({
			key: ["fb"],
			staleTime: "1h",
			fallback: "safe",
			fetch: async () => {
				throw new Error("boom")
			},
			retry: { attempts: 1, backoff: "linear", baseDelay: "1ms" },
		})

		const client = createContextClient()

		let output!: SinkOutput<ReturnType<typeof captureSink>>
		await expect(
			client
				.assemble({
					template: prompt`${b}!`,
					sink: captureSink(),
					onBindingError: "fallback-or-omit",
				})
				.then((o) => {
					output = o
				}),
		).resolves.toBeUndefined()

		const bucket = output.segments.dynamicBlocks.map((x) => x.text).join("|")
		expect(bucket.includes("safe") || bucket.includes('"safe"')).toBe(true)
		await client.dispose()
	})

	it("respects RetryPolicy backoff attempts", async () => {
		let n = 0
		const b = source({
			key: ["retry"],
			staleTime: "10m",
			fetch: async () => {
				n++
				if (n < 3) {
					throw new Error("transient")
				}
				return "ok"
			},
			retry: { attempts: 6, backoff: "linear", baseDelay: "1ms" },
		})

		const client = createContextClient()
		const job = client.prefetch(b)

		await vi.runAllTimersAsync()
		await job

		expect(n).toBe(3)
		await client.dispose()
	})

	it("assembles unrelated roots concurrently within the same tier", async () => {
		const traces: string[] = []
		const wa = source({
			key: ["tierA"],
			staleTime: "1m",
			fetch: vi.fn(async () => {
				traces.push("a")
				return 1
			}),
		})
		const wb = source({
			key: ["tierB"],
			staleTime: "1m",
			fetch: vi.fn(async () => {
				traces.push("b")
				return 2
			}),
		})
		const c = createContextClient()
		await c.assemble({
			template: prompt`${wa}-${wb}`,
			sink: captureSink(),
		})
		expect(traces.sort()).toEqual(["a", "b"])
		await c.dispose()
	})
})

describe("createContextClient (real timers subset)", () => {
	beforeEach(() => vi.useRealTimers())
	afterEach(() => {})

	it("invalidate prefix marks matching bindings stale for later churn", async () => {
		const spy = vi.fn(async () => 1)

		const b = source({ key: ["org", "acme", "leaf"], staleTime: "1h", fetch: spy })
		const client = createContextClient()

		await client.prefetch(b)
		expect(spy).toHaveBeenCalledTimes(1)
		expect(client.getCacheEntry(b)?.state).toBe("fresh")

		await client.invalidate({ prefix: ["org", "acme"] })

		expect(client.getCacheEntry(b)?.state).toBe("stale")

		await client.dispose()
	})

	it("prefix refetch replays subtree resolution hooks without throwing", async () => {
		const spy = vi.fn(async () => 2)

		const b = source({ key: ["org", "beta", "node"], staleTime: "1h", fetch: spy })
		const client = createContextClient()

		await client.prefetch(b)
		await client.invalidate({ prefix: ["org", "beta"] })

		await expect(client.refetch({ prefix: ["org", "beta"] })).resolves.toBeUndefined()

		await client.dispose()
	})
})

describe("mount wiring", () => {
	it("invokes subscribe when provided", async () => {
		let installs = 0
		const binding = source({
			key: ["mounted"],
			staleTime: "1m",
			fetch: vi.fn(async () => "x"),
			subscribe: () => {
				installs++
				return () => {}
			},
		})

		const client = createContextClient()
		client.mount(binding)
		expect(client.isMounted(binding)).toBe(true)
		expect(installs).toBe(1)
		await client.dispose()
	})
})

describe("assembleTemplate telemetry hooks", () => {
	it("pipes lint diagnostics through emitWarning", async () => {
		const warned: string[] = []
		const b = source({
			key: ["swarn"],
			placement: "static",
			staleTime: "1ms",
			fetch: async () => "x",
			gcTime: "5m",
		})

		const sink = captureSink()
		const ctx = createContextClient()

		const { metrics } = await assembleTemplate(
			{
				registerBinding: vi.fn(),
				resolveAssemblyValue: async () => ({
					value: "x",
					metric: { source: "fetch", tokens: 1, latencyMs: 2300 },
					fetchLatencyMs: 2300,
				}),
				emitWarning: (w) => warned.push(w.code),
			},
			ctx,
			{
				template: prompt`>${b}<`,
				sink,
			},
		)

		expect(warned).toContain("fetch-slow")
		expect(metrics.warnings.some((x) => x.code === "static-with-short-stale")).toBeTruthy()
		await ctx.dispose()
	})
})
