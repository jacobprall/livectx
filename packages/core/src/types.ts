// Keys & matching
export type KeyAtom = string | number | boolean | null | { [k: string]: KeyAtom }
export type BindingKey = readonly KeyAtom[]
export type KeyMatcher =
	| { exact: BindingKey }
	| { prefix: BindingKey }
	| { predicate: (key: BindingKey) => boolean }

// Time & placement
export type Duration = 0 | "Infinity" | `${number}${"ms" | "s" | "m" | "h"}` | number

export type Placement = "static" | "dynamic" | "tool"

// Bindings
export interface BindingDef<T, Deps extends Record<string, AnyBinding> = {}> {
	key: BindingKey
	fetch: (deps: ResolvedDeps<Deps>, ctx: FetchContext) => Promise<T> | T
	placement?: Placement
	staleTime?: Duration
	gcTime?: Duration
	dependsOn?: Deps
	subscribe?: (onInvalidate: () => void) => Unsubscribe
	render?: (value: T) => string
	schema?: Schema<T>
	description?: string
	retry?: RetryPolicy
	fallback?: T
}

export interface Binding<T, Deps extends Record<string, AnyBinding> = {}> {
	readonly __brand: "Binding"
	readonly __def: BindingDef<T, Deps>
	readonly __type: T // phantom for type inference
}

// `any` (not `unknown`) is required here: BindingDef contains both covariant
// positions (fetch return) and contravariant positions (render param), making
// T invariant.  Binding<SomeType> is only assignable to Binding<any>, not
// Binding<unknown>.
// biome-ignore lint/suspicious/noExplicitAny: variance escape hatch
export type AnyBinding = Binding<any, any>

export type ResolvedDeps<Deps extends Record<string, AnyBinding>> = {
	[K in keyof Deps]: Deps[K] extends Binding<infer V, any> ? V : never
}

export interface FetchContext {
	signal: AbortSignal
	client: ContextClient
}

export type Unsubscribe = () => void

export interface RetryPolicy {
	attempts: number
	backoff: "linear" | "exponential"
	baseDelay: Duration
}

// Tool bindings
export interface ToolBindingDef<I, O> {
	key: BindingKey
	name: string
	description: string
	input: Schema<I>
	output?: Schema<O>
	fetch: (input: I, ctx: FetchContext) => Promise<O>
	retry?: RetryPolicy
}

export interface ToolBinding<I, O> extends Binding<O, {}> {
	readonly __tool: ToolBindingDef<I, O>
}

// Template DSL
export interface Template {
	readonly strings: readonly string[]
	readonly values: readonly TemplateValue[]
}

export type TemplateValue =
	| AnyBinding
	| ToolBinding<any, any>
	| { __marker: "cache-breakpoint"; ttl?: "5m" | "1h" }
	| { __marker: "tool-list"; tools: readonly ToolBinding<any, any>[] }
	| string
	| number
	| boolean

// Schema (minimal contract compatible with Zod, Valibot, etc.)
export interface Schema<T> {
	parse(input: unknown): T
	safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error }
	toJsonSchema?(): JsonSchema
}

export interface JsonSchema {
	type: string
	properties?: Record<string, unknown>
	required?: string[]
	[k: string]: unknown
}

// Cache
export interface CacheEntry<T> {
	value: T
	fetchedAt: number
	expiresAt: number
	state: "fresh" | "stale" | "fetching" | "error"
	error?: Error
}

export interface ContextClientOptions {
	store?: StoreAdapter
	defaultStaleTime?: Duration
	defaultGcTime?: Duration
	telemetry?: TelemetryAdapter
	onWarning?: (warning: Warning) => void
}

// Assembly
export interface AssembleOptions<F extends SinkAdapter> {
	template: Template
	sink: F
	tools?: readonly ToolBinding<any, any>[]
	bustPromptCache?: boolean
	signal?: AbortSignal
	onBindingError?: "throw" | "fallback-or-omit"
}

export type SinkOutput<F extends SinkAdapter> = F extends SinkAdapter<infer O> ? O : never

export interface AssembleMetrics {
	bindings: Record<string, BindingMetric>
	prompt: {
		staticTokens: number
		dynamicTokens: number
		totalTokens: number
		expectedCacheHit: boolean
		breakpointOffsetChars: number
	}
	warnings: Warning[]
	durationMs: number
}

export interface BindingMetric {
	source: "cache-fresh" | "cache-stale" | "fetch" | "subscription" | "error"
	ageMs?: number
	latencyMs?: number
	tokens: number
	retries?: number
}

export interface Warning {
	code: WarningCode
	message: string
	bindingKey?: BindingKey
	severity: "info" | "warn" | "error"
}

export type WarningCode =
	| "static-with-short-stale"
	| "dynamic-in-prefix"
	| "cache-buster-detected"
	| "tool-without-schema"
	| "fetch-slow"
	| "subscription-dropped"
	| "schema-mismatch"

// Adapters
export interface StoreAdapter {
	get<T>(key: string): Promise<CacheEntry<T> | undefined>
	set<T>(key: string, entry: CacheEntry<T>): Promise<void>
	delete(key: string): Promise<void>
	keys(): AsyncIterable<string>
	clear(): Promise<void>
}

export interface SinkAdapter<Output = unknown> {
	readonly name: string
	format(segments: AssembledSegments, tools: readonly ResolvedTool[]): Output
}

export interface AssembledSegments {
	staticBlocks: readonly TextBlock[]
	dynamicBlocks: readonly TextBlock[]
	breakpointTtl?: "5m" | "1h"
	metrics: AssembleMetrics
	/** Set during assembly for {@link lintAssembly}. */
	segmentation?: {
		dynamicBindingKeysBeforeBreakpoint: BindingKey[]
	}
}

export interface TextBlock {
	text: string
	bindingKey?: BindingKey
}

export interface ResolvedTool {
	name: string
	description: string
	inputSchema: JsonSchema
	execute(input: unknown): Promise<unknown>
}

export interface TelemetryAdapter {
	recordAssemble(metrics: AssembleMetrics): void
	recordFetch(key: BindingKey, latencyMs: number, success: boolean): void
	recordWarning(warning: Warning): void
}

// ContextClient interface (will be implemented in Sprint 2)
export interface ContextClient {
	assemble<F extends SinkAdapter>(opts: AssembleOptions<F>): Promise<SinkOutput<F>>
	prefetch(binding: AnyBinding): Promise<void>
	invalidate(matcher: BindingKey | KeyMatcher): Promise<void>
	refetch(matcher: BindingKey | KeyMatcher): Promise<void>
	getCacheEntry<T>(binding: Binding<T>): CacheEntry<T> | undefined
	setCacheEntry<T>(binding: Binding<T>, value: T): void
	mount(binding: AnyBinding): Unsubscribe
	isMounted(binding: AnyBinding): boolean
	registerSink<F extends SinkAdapter>(name: string, sink: F): void
	executeTool(name: string, input: unknown): Promise<unknown>
	dispose(): Promise<void>
}
