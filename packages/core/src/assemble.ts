import { AssemblyError } from "./errors.js"
import { serializeKey } from "./key.js"
import { lintAssembly } from "./lint.js"
import { topologicalSort } from "./resolver.js"
import type {
	AnyBinding,
	AssembledSegments,
	BindingMetric,
	ContextClient,
	ResolvedTool,
	SinkAdapter,
	SinkOutput,
	TemplateValue,
	TextBlock,
	ToolBinding,
} from "./types.js"
import type { AssembleOptions } from "./types.js"

/** Wiring used by {@link assembleTemplate}; implemented by {@link createContextClient}. */
export interface AssembleRuntimeContext {
	resolveAssemblyValue(
		binding: AnyBinding,
		input: AssemblyResolveInput,
	): Promise<ResolvedAssemblyCell>
	registerBinding(binding: AnyBinding): void
	emitWarning?(warning: import("./types.js").Warning): void
	telemetry?: import("./types.js").TelemetryAdapter | undefined
}

export interface ResolvedAssemblyCell {
	value: unknown
	metric: BindingMetric
	fetchLatencyMs?: number | undefined
	omitted?: boolean | undefined
}

export interface AssemblyResolveInput {
	resolvedDeps: Record<string, unknown>
	signal?: AbortSignal | undefined
	onBindingError?: "throw" | "fallback-or-omit" | undefined
	bustPromptCache?: boolean | undefined
}

function isPrimitiveTemplateValue(v: TemplateValue): v is string | number | boolean {
	return typeof v === "string" || typeof v === "number" || typeof v === "boolean"
}

function hasMarker(value: TemplateValue): value is Extract<TemplateValue, { __marker: string }> {
	return typeof value === "object" && value !== null && "__marker" in value
}

function isBindingLike(value: TemplateValue): value is AnyBinding {
	return (
		typeof value === "object" &&
		value !== null &&
		"__brand" in value &&
		(value as AnyBinding).__brand === "Binding"
	)
}

function depsRecord(binding: AnyBinding): Record<string, AnyBinding> {
	const d = binding.__def.dependsOn
	return d ? ({ ...d } as Record<string, AnyBinding>) : {}
}

/** Seed list in template-discovery order plus transitive deps. */
function extractSeedBindings(template: { values: readonly TemplateValue[] }): AnyBinding[] {
	const seeds: AnyBinding[] = []

	function ensure(binding: AnyBinding): void {
		const id = serializeKey(binding.__def.key)
		if (seeds.some((b) => serializeKey(b.__def.key) === id)) {
			return
		}
		seeds.push(binding)
		for (const dep of Object.values(depsRecord(binding))) {
			ensure(dep)
		}
	}

	for (const v of template.values) {
		walkDiscovery(v)
	}

	function walkDiscovery(v: TemplateValue): void {
		if (!v || isPrimitiveTemplateValue(v)) {
			return
		}
		if (hasMarker(v)) {
			if (v.__marker === "tool-list" && "tools" in v) {
				for (const tb of v.tools) {
					walkDiscovery(tb as TemplateValue)
					ensure(tb as AnyBinding)
				}
			}
			return
		}
		if (isBindingLike(v)) {
			ensure(v)
		}
	}

	return seeds
}

function collectToolsFromOptsAndTemplate(
	template: { values: readonly TemplateValue[] },
	toolsOpt?: readonly ToolBinding<unknown, unknown>[],
): ToolBinding<unknown, unknown>[] {
	const ordered: ToolBinding<unknown, unknown>[] = []

	for (const t of toolsOpt ?? []) {
		ordered.push(t as ToolBinding<unknown, unknown>)
	}

	for (const v of template.values) {
		if (hasMarker(v) && v.__marker === "tool-list" && "tools" in v) {
			for (const t of v.tools) {
				ordered.push(t as ToolBinding<unknown, unknown>)
			}
		}
	}

	const byName = new Map<string, ToolBinding<unknown, unknown>>()
	for (const t of ordered) {
		byName.set(t.__tool.name, t)
	}
	return [...byName.values()]
}

function bindingsForLint(
	extracted: AnyBinding[],
	toolsOpt: readonly ToolBinding<unknown, unknown>[],
): AnyBinding[] {
	const seenKeys = new Set(extracted.map((b) => serializeKey(b.__def.key)))
	const out: AnyBinding[] = [...extracted]
	for (const t of toolsOpt) {
		const k = serializeKey(t.__def.key)
		if (!seenKeys.has(k)) {
			seenKeys.add(k)
			out.push(t as AnyBinding)
		}
	}
	return out
}

function templateHasExplicitBreakpoint(template: { values: readonly TemplateValue[] }): boolean {
	return template.values.some(
		(v) =>
			hasMarker(v as TemplateValue) && (v as { __marker?: string }).__marker === "cache-breakpoint",
	)
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

async function assembleValues(
	rt: AssembleRuntimeContext,
	waves: AnyBinding[][],
	input: Omit<AssemblyResolveInput, "resolvedDeps">,
) {
	const values = new Map<string, unknown>()
	const metrics: Record<string, BindingMetric> = {}
	const fetchLatency: Record<string, number> = {}
	const failures: Array<{ key: import("./types.js").BindingKey; error: Error }> = []
	const omitted = new Set<string>()

	for (const wave of waves) {
		await Promise.all(
			wave.map(async (b) => {
				rt.registerBinding(b)
				const deps = depsRecord(b)
				const resolvedDeps: Record<string, unknown> = {}
				for (const [name, dep] of Object.entries(deps)) {
					resolvedDeps[name] = values.get(serializeKey(dep.__def.key))
				}
				try {
					const cell = await rt.resolveAssemblyValue(b, { ...input, resolvedDeps })
					const bk = serializeKey(b.__def.key)
					metrics[bk] = cell.metric
					if (cell.omitted) {
						omitted.add(bk)
					} else {
						values.set(bk, cell.value)
					}
					if (typeof cell.fetchLatencyMs === "number") {
						fetchLatency[bk] = cell.fetchLatencyMs
					}
				} catch (error) {
					failures.push({ key: b.__def.key, error: error as Error })
				}
			}),
		)
	}

	return { values, metrics, fetchLatency, failures, omitted }
}

function renderBindingText(binding: AnyBinding, value: unknown): string {
	if (value === undefined) {
		return ""
	}
	if (binding.__def.render) {
		return binding.__def.render(value as never)
	}
	try {
		return `${JSON.stringify(value, null, 2)}`
	} catch {
		return `${String(value)}`
	}
}

export async function assembleTemplate<F extends SinkAdapter>(
	rt: AssembleRuntimeContext,
	ctx: ContextClient,
	opts: AssembleOptions<F>,
): Promise<{
	output: SinkOutput<F>
	metrics: import("./types.js").AssembleMetrics
	collectedToolBindings: readonly ToolBinding<unknown, unknown>[]
}> {
	const sink = opts.sink as F
	const t0 = Date.now()

	const timings: Record<string, number> = {}
	const extracted = extractSeedBindings(opts.template)
	const hasExplicitBp = templateHasExplicitBreakpoint(opts.template)

	const waves = topologicalSort(extracted)

	const assembled = await assembleValues(rt, waves, {
		signal: opts.signal,
		onBindingError: opts.onBindingError,
		bustPromptCache: opts.bustPromptCache,
	})
	Object.assign(timings, assembled.fetchLatency)

	const { values, metrics: bindingMetricsRaw, failures, omitted } = assembled

	let staticAccumulator = ""
	let dynamicLateAccumulator = ""

	const staticBlocksBuilt: TextBlock[] = []
	const dynamicEarlyBlocks: TextBlock[] = []
	const dynamicLateBlocks: TextBlock[] = []

	const dynamicBeforeBpKeys: import("./types.js").BindingKey[] = []

	let explicitBreakpointReached = false
	let crossedDivider = false

	let breakpointTtl: AssembledSegments["breakpointTtl"]

	function flushStatic(): void {
		if (!staticAccumulator) {
			return
		}
		staticBlocksBuilt.push({ text: staticAccumulator })
		staticAccumulator = ""
	}

	function flushDynLateAccum(): void {
		if (!dynamicLateAccumulator) {
			return
		}
		dynamicLateBlocks.push({ text: dynamicLateAccumulator })
		dynamicLateAccumulator = ""
	}

	function appendLiteralFragment(literal: string): void {
		if (!crossedDivider) {
			if (hasExplicitBp && explicitBreakpointReached) {
				dynamicLateAccumulator += literal
			} else {
				staticAccumulator += literal
			}
		} else {
			dynamicLateAccumulator += literal
		}
	}

	function bindingKeySer(binding: AnyBinding): string {
		return serializeKey(binding.__def.key)
	}

	function renderValue(binding: AnyBinding): string {
		const id = bindingKeySer(binding)
		const val = omitted.has(id) ? undefined : values.get(id)
		return renderBindingText(binding, val)
	}

	for (let i = 0; i < opts.template.values.length; i++) {
		const literal = opts.template.strings[i] ?? ""
		appendLiteralFragment(literal)

		const tv = opts.template.values[i] as TemplateValue
		if (tv === undefined) {
			continue
		}

		if (isPrimitiveTemplateValue(tv)) {
			flushStatic()
			const txt = `${tv}`
			if (hasExplicitBp && !explicitBreakpointReached) {
				dynamicEarlyBlocks.push({ text: txt })
			} else {
				dynamicLateBlocks.push({ text: txt })
			}
			continue
		}

		if (hasMarker(tv)) {
			if (tv.__marker === "cache-breakpoint") {
				flushStatic()
				explicitBreakpointReached = true
				crossedDivider = true
				breakpointTtl = tv.ttl
				continue
			}
			continue
		}

		if (!isBindingLike(tv)) {
			continue
		}

		const binding = tv as AnyBinding
		rt.registerBinding(binding)

		const placement = binding.__def.placement ?? "dynamic"

		if (placement === "tool") {
			continue
		}

		if (!crossedDivider && placement === "dynamic") {
			if (hasExplicitBp && !explicitBreakpointReached) {
				dynamicBeforeBpKeys.push(binding.__def.key)
				flushStatic()
				dynamicEarlyBlocks.push({ text: renderValue(binding), bindingKey: binding.__def.key })
				continue
			}

			flushStatic()
			crossedDivider = true
			dynamicLateBlocks.push({ text: renderValue(binding), bindingKey: binding.__def.key })
			continue
		}

		if (placement === "static") {
			if (!crossedDivider) {
				staticAccumulator += renderValue(binding)
			} else {
				flushDynLateAccum()
				dynamicLateBlocks.push({ text: renderValue(binding), bindingKey: binding.__def.key })
			}
		}
	}

	const trailing = opts.template.strings[opts.template.values.length] ?? ""
	appendLiteralFragment(trailing)
	flushStatic()
	flushDynLateAccum()

	let staticBlocks = staticBlocksBuilt
	let dynamicBlocks: TextBlock[] = [...dynamicEarlyBlocks, ...dynamicLateBlocks]

	if (opts.bustPromptCache) {
		dynamicBlocks = [...staticBlocks, ...dynamicBlocks]
		staticBlocks = []
	}

	const staticTextConcat = staticBlocks.map((x) => x.text).join("")
	const dynamicTextConcat = dynamicBlocks.map((x) => x.text).join("")
	const staticTokens = estimateTokens(staticTextConcat)
	const dynamicTokens = estimateTokens(dynamicTextConcat)

	const mergedMetricsBindings: Record<string, BindingMetric> = { ...bindingMetricsRaw }

	const segmentsBase: AssembledSegments = {
		staticBlocks,
		dynamicBlocks,
		breakpointTtl,
		metrics: {
			bindings: mergedMetricsBindings,
			prompt: {
				staticTokens,
				dynamicTokens,
				totalTokens: staticTokens + dynamicTokens,
				expectedCacheHit: !opts.bustPromptCache && staticBlocks.some((b) => b.text.length > 0),
				breakpointOffsetChars: staticTextConcat.length,
			},
			warnings: [],
			durationMs: Date.now() - t0,
		},
		segmentation: {
			dynamicBindingKeysBeforeBreakpoint: dynamicBeforeBpKeys,
		},
	}

	const collectedTools = collectToolsFromOptsAndTemplate(opts.template, opts.tools)

	const lintWarnings = lintAssembly(
		bindingsForLint(extracted, collectedTools),
		segmentsBase,
		timings,
	)

	for (const w of lintWarnings) {
		try {
			rt.emitWarning?.(w)
		} catch {
			//
		}
	}

	const segments: AssembledSegments = {
		...segmentsBase,
		metrics: { ...segmentsBase.metrics, warnings: lintWarnings },
	}

	if (failures.length && opts.onBindingError !== "fallback-or-omit") {
		throw new AssemblyError("Assembly failed for one or more bindings", failures, {
			partialResult:
				failures.length < extracted.length
					? { staticText: staticTextConcat, resolvedBindings: extracted.map((x) => x.__def.key) }
					: undefined,
			cause: failures[0]?.error,
		})
	}

	const resolvedTools: ResolvedTool[] = collectedTools.map((toolBinding) => {
		const tb = toolBinding as ToolBinding<unknown, unknown>
		const schema =
			tb.__tool.input && typeof tb.__tool.input.toJsonSchema === "function"
				? tb.__tool.input.toJsonSchema()
				: ({ type: "object", additionalProperties: true } as import("./types.js").JsonSchema)
		return {
			name: tb.__tool.name,
			description: tb.__tool.description,
			inputSchema: schema,
			async execute(input: unknown) {
				const parsed = tb.__tool.input.parse(input)
				return tb.__tool.fetch(parsed, {
					signal: opts.signal ?? new AbortController().signal,
					client: ctx,
				})
			},
		}
	})

	const output = sink.format(segments, resolvedTools) as SinkOutput<F>
	return { output, metrics: segments.metrics, collectedToolBindings: collectedTools }
}
