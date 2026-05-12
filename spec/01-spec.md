# livectx — Specification & Implementation Plan

> **Status:** Draft v0.1
> **Working name:** `livectx` (placeholder — rename before publishing)
> **Package scope:** `@livectx/*`
> **License intent:** MIT

A declarative, cached, MCP-aware context layer for LLM applications. Think *TanStack Query for prompt assembly*: you declare bindings once, the library handles freshness, caching, invalidation, and produces SDK-shaped inputs to whatever LLM client you use.

---

## 1. Overview

### What it is

A framework-agnostic TypeScript library that sits between your data sources and your LLM SDK. You declare **bindings** (typed, keyed, cached references to external data) and assemble them into prompts via a tagged-template DSL. The library returns the inputs to your LLM SDK — system blocks with cache_control placed correctly, messages, tool specs, and metrics — but never calls the LLM itself.

### What it isn't

- Not an LLM SDK wrapper. You keep using Anthropic, OpenAI, Vercel AI SDK, LangChain, or raw fetch.
- Not an agent framework. No tool execution loop, no plan/execute, no orchestration.
- Not a prompt templating engine in the Jinja/PromptL sense. Conditionals and loops are plain JavaScript expressions inside the template tag.
- Not a model router. Sinks output SDK-shaped data; you choose the SDK.

### Design principles

1. **Slottable**: Drops into any project. Core has zero runtime deps. Works in Node, Bun, Deno, Cloudflare Workers, browsers.
2. **Pluggable**: Sources, sinks, and stores are adapters. Adding a new one is a single file.
3. **Cache-aware as a first-class concern**: The two-layer cache model (binding cache + LLM prompt cache) is the central design constraint, not an afterthought.
4. **MCP-native**: Speaks `resources/subscribe` natively. Can expose its own bindings as an MCP server.
5. **Honest about JIT**: First-class support for tool-form bindings (the JIT-retrieval pattern Anthropic recommends), not just inline values.
6. **Pay for what you use**: Tree-shakeable. The MCP layer, framework hooks, and individual sinks are separate entry points.

### Non-goals

- Streaming response handling (the SDK does this).
- Prompt optimization / DSPy-style compilation.
- Evaluation, A/B testing, prompt versioning (use PromptLayer, LangSmith, etc.).
- Conversation memory / chat history (orthogonal concern; can be a binding source).

---

## 2. Architecture

### Layered model

```
┌─────────────────────────────────────────────────────────┐
│  Layer 5: Framework integrations (optional)             │
│  @livectx/react, @livectx/vue, @livectx/svelte          │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Sink adapters (output format)                 │
│  @livectx/sink-anthropic, sink-openai, sink-vercel-ai   │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Source adapters (input transport)             │
│  @livectx/mcp, source-websocket, source-sse             │
├─────────────────────────────────────────────────────────┤
│  Layer 2: ContextClient (core)                          │
│  Cache, scheduler, invalidator, assembler, subscriber   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Primitives (core)                             │
│  source(), tool(), prompt`...`, key matchers            │
└─────────────────────────────────────────────────────────┘
```

Layers 1–2 live in `@livectx/core` with zero runtime deps. Everything above is an opt-in package.

### Package structure (monorepo)

```
livectx/
├── packages/
│   ├── core/                  # @livectx/core — primitives + ContextClient
│   ├── mcp/                   # @livectx/mcp — MCP consumer + server export
│   ├── sink-anthropic/        # @livectx/sink-anthropic
│   ├── sink-openai/           # @livectx/sink-openai
│   ├── sink-vercel-ai/        # @livectx/sink-vercel-ai
│   ├── sink-langchain/        # @livectx/sink-langchain (later)
│   ├── source-websocket/      # @livectx/source-websocket
│   ├── source-sse/            # @livectx/source-sse
│   ├── store-redis/           # @livectx/store-redis
│   ├── react/                 # @livectx/react
│   └── otel/                  # @livectx/otel — OpenTelemetry plugin
├── examples/
│   ├── infra-agent/           # the motivating example
│   ├── customer-support/
│   └── mcp-bridge/
├── docs/
└── tooling/                   # build/release scripts
```

Recommended tooling: **pnpm workspaces** + **tsup** for builds + **changesets** for versioning + **vitest** for tests.

---

## 3. Core Concepts

### Binding

A *binding* is a typed, keyed reference to a piece of context. It has:

- A **key** (array, for cheap structural equality + pattern invalidation)
- A **fetcher** (and optionally a **subscriber**)
- A **placement** (`static` | `dynamic` | `tool`)
- A **staleness policy** (`staleTime`, optional `gcTime`)
- Optional **dependencies** on other bindings
- Optional **renderer** (how the value becomes a string in the prompt)
- Optional **schema** (Zod, for runtime validation + tool spec generation)

Bindings are declared once at module scope. The same binding object is reused across calls — that's how caching identity works.

### ContextClient

Singleton-ish object that owns the cache, the subscription registry, the scheduler, and the assembler. Roughly the role of TanStack's `QueryClient`.

```ts
const client = createContextClient({
  store: "memory",          // or store adapter
  defaultStaleTime: "5m",
  telemetry: console,       // or otel adapter
  onWarning: console.warn,
});
```

Most apps have one client. Tests can have many.

### Placement

Three modes — the load-bearing distinction in the whole library.

| Placement   | Where it goes                              | When to use                                      |
|-------------|--------------------------------------------|--------------------------------------------------|
| `"static"`  | Cached prefix (with `cache_control`)       | Rarely changes; safe to cache for 5m–1h          |
| `"dynamic"` | After cache breakpoint                     | Changes every call; small enough to inline       |
| `"tool"`    | Not inlined; emitted as a tool spec        | Large, or only sometimes needed (JIT)            |

The library refuses to put a `static` binding with a sub-5-minute `staleTime` into the cached prefix without warning — that's the kind of footgun warnings exist for.

### Key

Array-based, TanStack-style:

```ts
key: ["project", projectId]
key: ["services", projectId, { region: "us-east" }]
key: ["alerts"]
```

Structural equality via stable serialization (objects sorted by key). Pattern matching:

```ts
client.invalidate({ prefix: ["services"] });          // all services bindings
client.invalidate({ exact: ["project", "p_42"] });    // one binding
client.invalidate({ predicate: k => k[0] === "alert" }); // anything alert-shaped
```

### Staleness model

Two timers per cache entry:

- **`staleTime`**: how long after fetch the value is considered fresh. After this, the value is still served (no re-fetch on read) but the next `assemble()` will refetch in the background. Default: `0` (always considered stale, but cached for in-flight dedup).
- **`gcTime`** (optional): how long after the *last reference* before the entry is evicted. Default: `5m`.

A binding subscribed via MCP `resources/subscribe` ignores `staleTime` once a subscription is established — the server tells it when to be stale. If the subscription drops, it falls back to polling at `staleTime` intervals.

### Dependencies

A binding can declare others it depends on. This does two things:

1. **Passes the dep's resolved value into `fetch`.** The library resolves deps first, then calls your fetcher with `{ depName: depValue }`.
2. **Cascades invalidation.** When a dep is invalidated or refetched, dependents are too. This is what makes `client.invalidate({ prefix: ["project"] })` propagate correctly to anything keyed off the project.

```ts
const services = source({
  key: ["services", projectId],
  dependsOn: { project },                         // declare
  fetch: ({ project }) =>                         // receive
    api.getServices(project.id),
});
```

Dependency cycles are detected at assembly time and throw `CircularDependencyError`. Diamond dependencies (A depends on B and C, B and C both depend on D) resolve correctly — D is fetched once.

---

## 4. Type Definitions

The full core type surface. These are the types `@livectx/core` exports.

```ts
// ============================================================================
// Keys & matching
// ============================================================================

export type KeyAtom = string | number | boolean | null | { [k: string]: KeyAtom };
export type BindingKey = readonly KeyAtom[];

export type KeyMatcher =
  | { exact: BindingKey }
  | { prefix: BindingKey }
  | { predicate: (key: BindingKey) => boolean };

// ============================================================================
// Time & placement
// ============================================================================

export type Duration =
  | 0
  | "Infinity"
  | `${number}${"ms" | "s" | "m" | "h"}`
  | number; // milliseconds

export type Placement = "static" | "dynamic" | "tool";

// ============================================================================
// Bindings
// ============================================================================

export interface BindingDef<T, Deps extends Record<string, AnyBinding> = {}> {
  key: BindingKey;
  fetch: (deps: ResolvedDeps<Deps>, ctx: FetchContext) => Promise<T> | T;
  placement?: Placement;                       // default: "dynamic"
  staleTime?: Duration;                         // default: 0
  gcTime?: Duration;                            // default: "5m"
  dependsOn?: Deps;
  subscribe?: (onInvalidate: () => void) => Unsubscribe;
  render?: (value: T) => string;               // default: JSON.stringify with indent 2
  schema?: Schema<T>;                           // optional Zod-like validator
  description?: string;                         // for tool placement
  retry?: RetryPolicy;
}

export interface Binding<T, Deps extends Record<string, AnyBinding> = {}> {
  readonly __def: BindingDef<T, Deps>;
  readonly __type: T;  // phantom for type inference
}

export type AnyBinding = Binding<unknown, any>;

export type ResolvedDeps<Deps extends Record<string, AnyBinding>> = {
  [K in keyof Deps]: Deps[K] extends Binding<infer V, any> ? V : never;
};

export interface FetchContext {
  signal: AbortSignal;
  client: ContextClient;
}

export type Unsubscribe = () => void;

export interface RetryPolicy {
  attempts: number;             // default: 2
  backoff: "linear" | "exponential";
  baseDelay: Duration;          // default: 200ms
}

// ============================================================================
// Tool bindings (specialized)
// ============================================================================

export interface ToolBindingDef<I, O> {
  key: BindingKey;
  name: string;
  description: string;
  input: Schema<I>;
  output?: Schema<O>;
  fetch: (input: I, ctx: FetchContext) => Promise<O>;
  retry?: RetryPolicy;
}

export interface ToolBinding<I, O> extends Binding<O, {}> {
  readonly __tool: ToolBindingDef<I, O>;
}

// ============================================================================
// Template DSL
// ============================================================================

export interface Template {
  readonly strings: readonly string[];
  readonly values: readonly TemplateValue[];
}

export type TemplateValue =
  | AnyBinding
  | { __marker: "cache-breakpoint"; ttl?: "5m" | "1h" }
  | { __marker: "tool-list"; tools: readonly ToolBinding<any, any>[] }
  | string
  | number
  | boolean;

export function prompt(
  strings: TemplateStringsArray,
  ...values: TemplateValue[]
): Template;

export function cacheBreakpoint(opts?: { ttl?: "5m" | "1h" }): TemplateValue;

// ============================================================================
// Schema (minimal contract; works with Zod, Valibot, etc.)
// ============================================================================

export interface Schema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error };
  toJsonSchema?(): JsonSchema;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

// ============================================================================
// ContextClient
// ============================================================================

export interface ContextClient {
  assemble<F extends SinkAdapter>(opts: AssembleOptions<F>): Promise<SinkOutput<F>>;

  prefetch(binding: AnyBinding): Promise<void>;
  invalidate(matcher: BindingKey | KeyMatcher): Promise<void>;
  refetch(matcher: BindingKey | KeyMatcher): Promise<void>;

  getCacheEntry<T>(binding: Binding<T>): CacheEntry<T> | undefined;
  setCacheEntry<T>(binding: Binding<T>, value: T): void;

  // Subscription lifecycle
  mount(binding: AnyBinding): Unsubscribe;
  isMounted(binding: AnyBinding): boolean;

  // Sink registration
  registerSink<F extends SinkAdapter>(name: string, sink: F): void;

  // Lifecycle
  dispose(): Promise<void>;
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
  state: "fresh" | "stale" | "fetching" | "error";
  error?: Error;
}

export interface ContextClientOptions {
  store?: StoreAdapter;
  defaultStaleTime?: Duration;
  defaultGcTime?: Duration;
  telemetry?: TelemetryAdapter;
  onWarning?: (warning: Warning) => void;
}

// ============================================================================
// Assembly
// ============================================================================

export interface AssembleOptions<F extends SinkAdapter> {
  template: Template;
  sink: F;
  tools?: readonly ToolBinding<any, any>[];   // additional tools to surface
  bustPromptCache?: boolean;                  // skip cache_control insertion
  signal?: AbortSignal;
}

export type SinkOutput<F extends SinkAdapter> = F extends SinkAdapter<infer O> ? O : never;

export interface AssembleMetrics {
  bindings: Record<string, BindingMetric>;
  prompt: {
    staticTokens: number;
    dynamicTokens: number;
    totalTokens: number;
    expectedCacheHit: boolean;
    breakpointOffsetChars: number;
  };
  warnings: Warning[];
  durationMs: number;
}

export interface BindingMetric {
  source: "cache-fresh" | "cache-stale" | "fetch" | "subscription" | "error";
  ageMs?: number;
  latencyMs?: number;
  tokens: number;
  retries?: number;
}

export interface Warning {
  code: WarningCode;
  message: string;
  bindingKey?: BindingKey;
  severity: "info" | "warn" | "error";
}

export type WarningCode =
  | "static-with-short-stale"
  | "dynamic-in-prefix"
  | "cache-buster-detected"
  | "tool-without-schema"
  | "fetch-slow"
  | "subscription-dropped"
  | "schema-mismatch";

// ============================================================================
// Adapters
// ============================================================================

export interface StoreAdapter {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): AsyncIterable<string>;
  clear(): Promise<void>;
}

export interface SinkAdapter<Output = unknown> {
  readonly name: string;
  format(segments: AssembledSegments, tools: readonly ResolvedTool[]): Output;
}

export interface AssembledSegments {
  staticBlocks: readonly TextBlock[];   // for cached prefix
  dynamicBlocks: readonly TextBlock[];  // post-breakpoint
  breakpointTtl?: "5m" | "1h";
  metrics: AssembleMetrics;
}

export interface TextBlock {
  text: string;
  bindingKey?: BindingKey;
}

export interface ResolvedTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: unknown) => Promise<unknown>;
}

export interface TelemetryAdapter {
  recordAssemble(metrics: AssembleMetrics): void;
  recordFetch(key: BindingKey, latencyMs: number, success: boolean): void;
  recordWarning(warning: Warning): void;
}

// ============================================================================
// Constructors
// ============================================================================

export function source<T, Deps extends Record<string, AnyBinding> = {}>(
  def: BindingDef<T, Deps>
): Binding<T, Deps>;

export function tool<I, O>(def: ToolBindingDef<I, O>): ToolBinding<I, O>;

export function createContextClient(opts?: ContextClientOptions): ContextClient;
```

---

## 5. The Template DSL

`prompt` is a tagged template literal. Interpolations may be:

- **Bindings** — resolved at assembly time, value rendered via the binding's `render()` or `JSON.stringify`.
- **Cache breakpoint markers** — `cacheBreakpoint()` returns a marker indicating where the static/dynamic split should occur. If omitted, the split is inferred from the first `dynamic` placement encountered.
- **Plain values** (string/number/boolean) — interpolated as-is.

Example:

```ts
const template = prompt`
You are an infrastructure management agent.

${project}
${services}

${cacheBreakpoint({ ttl: "5m" })}

Current alerts: ${alerts}

User request: ${userMessage}
`;
```

The `prompt` tag returns a `Template` — a plain data object. It does no rendering itself. All resolution happens during `client.assemble({ template, sink })`.

### Why a tagged template instead of an object DSL?

The tag form preserves authorial intent — you write the prompt as text. The `${}` syntax is natively understood by every IDE and prompt-evaluation tool. An object DSL (`{ system: [...], user: [...] }`) forces a different mental model and breaks the read-it-like-a-prompt property that makes prompts maintainable.

---

## 6. Assembly Pipeline

What happens when you call `client.assemble({ template, sink })`:

```
                ┌─────────────────────────────────┐
   template ──▶ │ 1. Topo-sort bindings by deps   │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 2. Resolve in parallel waves    │
                │    - check cache (fresh? use)   │
                │    - stale? fetch in background │
                │    - cold? fetch + await        │
                │    - subscribed? read live      │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 3. Render each value to string  │
                │    via binding.render()         │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 4. Segment by placement         │
                │    static blocks before bp,     │
                │    dynamic after                │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 5. Lint: emit warnings          │
                │    - dynamic-in-prefix          │
                │    - static-with-short-stale    │
                │    - etc.                       │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 6. Resolve tool bindings        │
                │    to ResolvedTool[]            │
                └────────────┬────────────────────┘
                             ▼
                ┌─────────────────────────────────┐
                │ 7. Hand to sink.format()        │
                └────────────┬────────────────────┘
                             ▼
                      SinkOutput<F>
```

### Step 2 details: cache resolution

For each binding, the client checks the store (in-memory or adapter-provided):

| State           | Behavior                                                |
|-----------------|---------------------------------------------------------|
| Not present     | Fetch, await, store, return                             |
| Fresh           | Return cached value immediately                         |
| Stale           | Return cached value, kick off background refetch (SWR)  |
| Fetching        | Wait for in-flight promise (dedup)                      |
| Error + retries | Retry per policy                                        |
| Error final     | If `fallback` provided, use it; else throw with context |

Subscribed bindings short-circuit this: the cache is updated by the subscription pipeline, and reads always hit fresh.

### Step 4 details: segmentation

Each binding's rendered text becomes a `TextBlock` with its key attached (for metrics). Blocks are grouped:

- All `static` blocks → `staticBlocks`
- All `dynamic` blocks → `dynamicBlocks`
- The cache breakpoint marker's position determines where the boundary falls within the template's literal strings

The literal strings of the template are split at the breakpoint and distributed across the two segment lists.

### Step 5 details: linting warnings

Emitted to `onWarning` and included in `metrics.warnings`. The high-value ones:

- **`static-with-short-stale`**: A binding marked `static` has `staleTime < 5m`. The cached prefix will likely be invalidated on most calls — this is almost certainly wrong.
- **`dynamic-in-prefix`**: A `dynamic` binding appears before the cache breakpoint marker. The user explicitly placed it where it'll break caching.
- **`tool-without-schema`**: A `tool()` binding has no input schema. The model will get poorly-described parameters.
- **`fetch-slow`**: A non-subscribed binding took >2s to fetch. Suggest moving to `tool` placement.

---

## 7. Caching & Invalidation

### Two-layer cache model

**Layer A — Binding cache** (in the ContextClient):
- Keyed by stable serialization of `BindingKey`.
- TTL'd by `staleTime` (when content is considered fresh).
- GC'd by `gcTime` (when unreferenced entries are evicted).
- Pluggable via `StoreAdapter` (memory default; Redis/SQLite/etc. as packages).

**Layer B — LLM prompt cache** (provider-managed):
- Managed by sink adapters via `cache_control` (Anthropic) or implicit prefix matching (OpenAI).
- The sink places the breakpoint such that the `staticBlocks` form a stable prefix.
- The library guarantees byte-stability of static blocks across calls *iff* none of the bound values changed.

### Invalidation API

```ts
// Exact key
await client.invalidate(["project", "p_42"]);
await client.invalidate({ exact: ["project", "p_42"] });

// Prefix match (most common)
await client.invalidate({ prefix: ["services"] });           // all services bindings
await client.invalidate({ prefix: ["services", "p_42"] });   // services for one project

// Predicate
await client.invalidate({ predicate: key => key.includes("alerts") });

// Refetch (invalidate + immediately fetch)
await client.refetch({ prefix: ["alerts"] });
```

Invalidation marks the entry stale. The next `assemble()` triggers a refetch. For an immediate refetch, use `refetch()`.

### Subscription-driven invalidation

When a binding has a `subscribe()` function, the client calls it on mount and stores the unsubscribe callback. The subscription's only job is to call `onInvalidate()` when the underlying data changes. The client then:

1. Marks the cache entry stale.
2. If the binding is currently being read (in an in-flight `assemble()`), nothing further happens — that call gets the previous value, the next call gets fresh.
3. If `eagerRefetch` is enabled on the binding, kicks off a refetch immediately.

This is the MCP pattern: the notification is just a signal, the fetch is decoupled.

---

## 8. Source Adapters

### `source()` — generic async source

Already shown. The fundamental primitive.

```ts
export const project = source({
  key: ["project", projectId],
  fetch: async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    return res.json();
  },
  staleTime: "1h",
  placement: "static",
});
```

### `tool()` — JIT placement

```ts
export const serviceLogs = tool({
  key: ["tool", "serviceLogs"],
  name: "get_service_logs",
  description: "Fetch recent logs for a service. Use this when investigating an issue with a specific service.",
  input: z.object({
    serviceId: z.string().describe("The service identifier"),
    lines: z.number().int().min(1).max(1000).default(100),
  }),
  fetch: async ({ serviceId, lines }) => {
    return await api.getLogs(serviceId, lines);
  },
});
```

A `tool()` binding produces a tool spec in the sink output. The model decides when to call it. The library handles invocation routing if you opt in via `client.executeTool(name, input)`.

### `@livectx/mcp` — MCP resource

```ts
import { mcpClient, mcpResource } from "@livectx/mcp";

const alertsServer = await mcpClient({
  transport: { type: "http", url: "https://internal/mcp/alerts" },
});

export const alerts = mcpResource(alertsServer, {
  uri: "alerts://current",
  staleTime: "30s",        // polling fallback if server lacks subscribe capability
  placement: "dynamic",
});
```

`mcpResource` is sugar over `source()` that:

- Sets up subscription via `resources/subscribe` if the server's capabilities advertise it.
- Falls back to polling at `staleTime` if not.
- Translates the resource URI into a `BindingKey` of `["mcp", serverId, uri]`.
- Reads via `resources/read` on cache miss.

### Custom sources

Any object satisfying the `BindingDef` shape works. To make a reusable source type, write a factory:

```ts
import { source, BindingDef } from "@livectx/core";

export function graphqlSource<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>
): BindingDef<T> {
  return {
    key: ["graphql", endpoint, { query, variables }],
    fetch: async () => {
      const res = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ query, variables }),
      });
      const { data, errors } = await res.json();
      if (errors) throw new Error(JSON.stringify(errors));
      return data;
    },
  };
}
```

---

## 9. Sink Adapters

### Anthropic sink

```ts
import { anthropicSink } from "@livectx/sink-anthropic";

const { system, messages, tools, metrics } = await client.assemble({
  template,
  sink: anthropicSink(),
});

// Pass straight to the SDK
const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  system,
  messages,
  tools,
  max_tokens: 4096,
});
```

Output shape:

```ts
interface AnthropicSinkOutput {
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  }>;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string } | ToolUseBlock | ToolResultBlock>;
  }>;
  tools: Array<{
    name: string;
    description: string;
    input_schema: JsonSchema;
  }>;
  metrics: AssembleMetrics;
}
```

The sink places `cache_control: { type: "ephemeral" }` on the last static block, achieving prefix caching. If `cacheBreakpoint({ ttl: "1h" })` was used, the ttl is propagated.

### OpenAI sink

```ts
interface OpenAISinkOutput {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  tools: Array<{ type: "function"; function: { name: string; description: string; parameters: JsonSchema } }>;
  metrics: AssembleMetrics;
}
```

OpenAI handles prefix caching automatically — the sink ensures byte-stable ordering and surfaces `prompt_cache_key` if the model supports it.

### Vercel AI SDK sink

```ts
interface VercelAISinkOutput {
  system: string;
  messages: Array<UIMessage>;
  tools: Record<string, ToolDefinition>;
  metrics: AssembleMetrics;
}
```

Shaped to drop into `streamText` / `generateText`.

### Raw sink

For custom pipelines:

```ts
interface RawSinkOutput {
  staticText: string;
  dynamicText: string;
  toolSpecs: ResolvedTool[];
  metrics: AssembleMetrics;
}
```

### Writing a custom sink

```ts
import { SinkAdapter } from "@livectx/core";

const myInternalSink: SinkAdapter<{ prompt: string; tools: any[] }> = {
  name: "my-internal",
  format(segments, tools) {
    return {
      prompt: [
        segments.staticBlocks.map(b => b.text).join("\n"),
        "---",
        segments.dynamicBlocks.map(b => b.text).join("\n"),
      ].join("\n"),
      tools: tools.map(t => ({ name: t.name, schema: t.inputSchema })),
    };
  },
};
```

That's the entire sink contract. Three responsibilities: name, format function, output type.

---

## 10. MCP Integration (Bidirectional)

### As consumer — `@livectx/mcp` client

```ts
import { mcpClient, mcpResource, mcpTools } from "@livectx/mcp";

const server = await mcpClient({
  transport: { type: "http", url: "https://my-server/mcp" },
  // or { type: "stdio", command: "uvx", args: ["my-mcp-server"] }
});

// Single resource
export const config = mcpResource(server, {
  uri: "config://app",
  placement: "static",
  staleTime: "1h",
});

// All tools from the server, exposed to the model
export const allServerTools = await mcpTools(server);
//   → ToolBinding[] — pass to assemble({ tools })

// All resources from a server, pre-bound
export const allResources = await mcpResources(server, {
  placement: "dynamic",
});
```

Subscription is automatic when the server advertises `resources.subscribe: true` in its capabilities. The library opens a long-lived SSE/stdio stream and routes `notifications/resources/updated` to the right binding's invalidate callback.

### As provider — exposing bindings as an MCP server

```ts
import { exposeAsMcpServer } from "@livectx/mcp";

const server = exposeAsMcpServer(client, {
  name: "infra-context",
  version: "0.1.0",
  resources: [project, services, alerts],
  tools: [serviceLogs, restartService],
});

await server.listen({ transport: "http", port: 3001 });
// or
await server.listen({ transport: "stdio" });
```

Mapping rules:

| Binding shape          | MCP exposure                                |
|------------------------|---------------------------------------------|
| `source({ placement: "static" \| "dynamic" })`   | `resources/list` entry; `resources/read` fetches; emits `notifications/resources/updated` on invalidation |
| `tool()`               | `tools/list` entry; `tools/call` invokes `fetch` |
| `source()` with `subscribe` | Resource with `subscribe: true` capability   |

This is the flywheel: write bindings once for your own prompts, expose the same bindings as an MCP server for other agents to consume. Same declaration, two consumers.

---

## 11. Tool Placement: The JIT Story

The frontier of agent design favors just-in-time retrieval over pre-loaded context (Anthropic Claude Code, MCP resources, Jentic JITT). `tool()` is how `livectx` supports this first-class.

```ts
// Inline (every call has services in context)
export const services = source({
  key: ["services"],
  fetch: () => api.getServices(),
  placement: "dynamic",
});

// Tool (model fetches when needed, on demand)
export const servicesTool = tool({
  key: ["tool", "services"],
  name: "list_services",
  description: "List all services in the current project. Returns name, health, region.",
  input: z.object({}),
  fetch: () => api.getServices(),
});

// Both (small summary inline, full detail via tool)
export const serviceSummary = source({
  key: ["service-summary"],
  fetch: () => api.getServiceSummary(),
  placement: "dynamic",
  render: (s) => `${s.totalCount} services, ${s.unhealthy} unhealthy.`,
});
```

The third pattern — small inline summary + tool for detail — is often the sweet spot. The summary keeps the agent grounded without bloating context; the tool gives it depth on demand.

### Tool execution routing

`assemble()` only produces tool *specs*. To execute, either:

1. Let your LLM SDK handle it (Vercel AI SDK's `tools` parameter, Anthropic's tool loop) — the spec format is compatible.
2. Use the helper:

```ts
const result = await client.executeTool(toolName, toolInput);
```

This is purely a convenience; the library doesn't drive the agent loop.

---

## 12. Observability

### Metrics

Every `assemble()` returns `AssembleMetrics`. Sample output:

```
{
  bindings: {
    "project:p_42": {
      source: "cache-fresh",
      ageMs: 720_000,
      tokens: 240
    },
    "services:p_42": {
      source: "fetch",
      latencyMs: 180,
      tokens: 1240
    },
    "alerts:current": {
      source: "subscription",
      ageMs: 4_000,
      tokens: 80
    }
  },
  prompt: {
    staticTokens: 4200,
    dynamicTokens: 1320,
    totalTokens: 5520,
    expectedCacheHit: true,
    breakpointOffsetChars: 18204
  },
  warnings: [],
  durationMs: 195
}
```

### Warnings

Surface design issues at runtime. Tied to `WarningCode` enum so users can filter. Each warning carries the offending binding key.

### OpenTelemetry plugin (`@livectx/otel`)

```ts
import { otelTelemetry } from "@livectx/otel";

const client = createContextClient({
  telemetry: otelTelemetry({ tracer: trace.getTracer("livectx") }),
});
```

Emits spans for:

- `livectx.assemble` (root span)
- `livectx.fetch` (one per binding fetch)
- `livectx.subscribe` (subscription lifecycle)

---

## 13. Error Handling

### Per-binding policy

```ts
export const services = source({
  key: ["services"],
  fetch: () => api.getServices(),
  retry: { attempts: 3, backoff: "exponential", baseDelay: "200ms" },
  fallback: { name: "unknown", services: [] },  // used if all retries fail
});
```

### Assembly-level

`assemble()` throws `AssemblyError` if any required binding fails after retries and has no fallback. The error carries:

```ts
class AssemblyError extends Error {
  failedBindings: Array<{ key: BindingKey; error: Error }>;
  partialResult?: { staticText: string; resolvedBindings: BindingKey[] };
}
```

For best-effort assembly:

```ts
const result = await client.assemble({
  template,
  sink: anthropicSink(),
  onBindingError: "fallback-or-omit",  // default: "throw"
});
```

### Subscription failures

A subscription drop emits a `subscription-dropped` warning, and the binding reverts to polling at `staleTime`. Reconnect attempts follow `retry` policy.

---

## 14. Implementation Plan

Six milestones. Each milestone has a definition-of-done and acceptance tests.

### M1: Core (weeks 1–3)

**Scope:**
- `@livectx/core`: `source()`, `createContextClient()`, in-memory store, `prompt` tag, basic assembly, key matching.
- Anthropic sink with `cache_control` placement.

**Acceptance:**
- ✅ Declare 3 bindings; assemble; pass to Anthropic SDK; get response.
- ✅ Cache hit on second call (verify via `cache_read_input_tokens` in usage).
- ✅ Invalidate by prefix; next assemble refetches matching bindings.
- ✅ Concurrent assembles dedupe in-flight fetches.
- ✅ Bench: ≤5ms overhead for an assembly with 10 cached bindings.

**Out of scope for M1:** subscriptions, MCP, tools, retries, observability.

### M2: MCP consumer (weeks 4–5)

**Scope:**
- `@livectx/mcp`: client transport (HTTP + stdio), `mcpResource`, `mcpTools`, subscription handling.

**Acceptance:**
- ✅ Bind to a resource on a public MCP server (e.g., a reference implementation).
- ✅ Server sends `notifications/resources/updated`; binding marks stale; next assemble refetches.
- ✅ Subscription drops → polling fallback engages within 1s.
- ✅ Tool list from MCP server appears as `ToolBinding[]` in `assemble()` output.

### M3: Tools & JIT (weeks 6–7)

**Scope:**
- `tool()` constructor, ResolvedTool emission, `client.executeTool()`, schema-to-JSON-schema translation (Zod adapter).

**Acceptance:**
- ✅ Declare a `tool()` binding; assemble; verify tool spec in sink output matches Anthropic schema.
- ✅ Model calls tool; `executeTool` runs the fetch; result usable.
- ✅ Tool with Zod input gets a correct JSON schema in output.

### M4: Additional sinks (week 8)

**Scope:**
- `@livectx/sink-openai`, `@livectx/sink-vercel-ai`, raw sink.

**Acceptance:**
- ✅ Same template + bindings, different sink, produces SDK-shaped output for each.
- ✅ Smoke test against each SDK.

### M5: MCP server export (weeks 9–10)

**Scope:**
- `exposeAsMcpServer()` — bindings become resources, tools become tools.
- HTTP and stdio transports.

**Acceptance:**
- ✅ Expose 3 bindings via HTTP transport.
- ✅ Claude Desktop (or MCP Inspector) can list and read them.
- ✅ Invalidating a binding in the host process emits a `resources/updated` notification on the wire.

### M6: Observability + DX polish (weeks 11–12)

**Scope:**
- `@livectx/otel`, warning system, `@livectx/react` hook, docs site, examples (`infra-agent`, `customer-support`, `mcp-bridge`).

**Acceptance:**
- ✅ Warnings fire on the documented misuse patterns.
- ✅ OTel spans visible in a tracing UI for the example app.
- ✅ React example: assembly metrics rendered in a dev panel.
- ✅ Docs site live with API reference, getting-started, and design rationale.

---

## 15. Repo Structure & Tooling

```
livectx/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts            # public exports
│   │   │   ├── client.ts           # ContextClient impl
│   │   │   ├── binding.ts          # source(), tool(), Binding types
│   │   │   ├── template.ts         # prompt tag, Template type
│   │   │   ├── key.ts              # key matching, serialization
│   │   │   ├── cache.ts            # default in-memory store
│   │   │   ├── assemble.ts         # the pipeline
│   │   │   ├── lint.ts             # warnings
│   │   │   └── types.ts            # shared types
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsup.config.ts
│   ├── mcp/
│   ├── sink-anthropic/
│   ├── sink-openai/
│   ├── sink-vercel-ai/
│   ├── source-websocket/
│   ├── store-redis/
│   ├── react/
│   └── otel/
├── examples/
├── docs/                            # Astro Starlight or Nextra
├── .changeset/
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

**Tooling choices:**

- **pnpm** (workspaces, fast, lockfile-friendly)
- **tsup** (per-package builds, ESM+CJS dual)
- **vitest** (tests, fast, ESM-native)
- **changesets** (versioning, changelogs)
- **biome** or **eslint + prettier** (lint/format)
- **typedoc** (API docs generation)

---

## 16. Testing Strategy

### Unit (per-package)

- Key serialization round-trips (including objects with reordered keys).
- Pattern matchers across edge cases (empty, nested, predicate throws).
- Cache state transitions (cold → fetching → fresh → stale → refetch).
- Concurrent assembly dedup (10 concurrent calls → 1 fetch).
- Subscription mock: invalidate → next assemble refetches.
- Template parsing: order preservation, breakpoint position correctness.
- Sink output shape conformance against snapshot fixtures.

### Integration

- End-to-end with a mock MCP server (subscribe, update, notify, refetch).
- Multi-sink: same bindings → different SDK shapes, assertions on shape.
- Round-trip: expose bindings as MCP server, connect to it from a second client, read/subscribe.

### "Real LLM" smoke tests

- Gated by `LIVECTX_E2E=1` env var (don't run in CI by default; cost money).
- One test per sink: assemble + call + assert response is non-empty.
- One cache-hit test: assemble twice, assert `cache_read_input_tokens > 0` in usage.

### Benchmarks

- `pnpm bench` — assembly overhead, cache hit/miss rates, store adapter performance.
- Target: ≤5ms for a 10-binding assembly with all cache hits, on Node 20+.

---

## 17. Open Questions

Things deliberately left open for now, to be resolved with usage:

1. **Should `source()` infer placement from `staleTime`?**
   If `staleTime >= 5m`, default to `static`; else `dynamic`. Pro: less boilerplate. Con: implicit behavior is footgun-prone.

2. **How to handle binding versioning?**
   When a binding's `fetch` function changes (different shape), cached entries become invalid. Hash the fetcher source? Require explicit `version` field? Probably the latter.

3. **Streaming bindings.**
   What if a binding's value updates *during* an LLM response (e.g., a live metric)? Out of scope for v1, but worth thinking about — could be a `streamingSource()` that yields async iterables and the sink streams updates back to the model on the next user turn.

4. **Multi-tenant isolation.**
   The current model has one cache per `ContextClient`. For a server serving N users, do you want N clients or one client with tenant-aware keys? Probably both should work — document the pattern of including a tenant ID as the first key element.

5. **Cache busting on prompt changes.**
   If the template's literal strings change (developer edits the prompt), the static prefix bytes change, so the LLM prompt cache misses. This is correct behavior, but unsurprising-and-expensive. Worth a CLI tool to estimate cache impact of prompt diffs.

6. **Long-lived assemblies (streaming responses).**
   If an LLM call streams for 30s and a subscription fires mid-stream, the next assembly will pick up the change. But should we expose this so the caller can decide whether to interrupt? Probably no for v1; SDK ownership.

---

## 18. Getting Started (developer-facing)

What ends up in the README.

```ts
// 1. Install
//    pnpm add @livectx/core @livectx/sink-anthropic
//    pnpm add @livectx/mcp     # optional

// 2. Declare bindings
import { source, tool, createContextClient, prompt, cacheBreakpoint } from "@livectx/core";
import { anthropicSink } from "@livectx/sink-anthropic";
import Anthropic from "@anthropic-ai/sdk";

export const client = createContextClient();
const anthropic = new Anthropic();

const project = source({
  key: ["project", "p_42"],
  fetch: () => fetch("/api/project/p_42").then(r => r.json()),
  staleTime: "1h",
  placement: "static",
});

const services = source({
  key: ["services", "p_42"],
  dependsOn: { project },
  fetch: ({ project }) =>
    fetch(`/api/project/${project.id}/services`).then(r => r.json()),
  placement: "dynamic",
});

// 3. Assemble + call
const { system, messages, tools, metrics } = await client.assemble({
  sink: anthropicSink(),
  template: prompt`
    You are an infrastructure management agent.
    Project: ${project}
    ${cacheBreakpoint()}
    Services: ${services}
    User: ${userInput}
  `,
});

const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  system,
  messages,
  tools,
  max_tokens: 4096,
});

console.log(metrics.warnings);  // catch design issues early
```

---

## 19. Naming

`livectx` is a placeholder. Candidates to evaluate before publishing:

- **livectx** — descriptive, dull, available on npm at time of writing.
- **promptweave** / **weave** — evocative, hints at assembly.
- **tendril** — small organic threads reaching out for data; available.
- **moor** — "to bind/anchor"; short; available.
- **strand** — single thread of context; available.

Whatever the name, package scope should be `@<name>/core`, `@<name>/mcp`, etc.

---

## 20. References

Design influences and prior art that informed this spec:

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Model Context Protocol — Resources (subscribe / notifications)](https://modelcontextprotocol.io/specification/2025-03-26/server/resources)
- [TanStack Query](https://tanstack.com/query) — the QueryClient/queryKey/staleTime mental model is borrowed wholesale.
- [Jentic — Just-In-Time Tooling](https://jentic.com/blog/just-in-time-tooling) — the JIT framing.
- [Cefboud — Dynamic Context Loading for LLMs](https://cefboud.com/posts/dynamic-context-loading-llm-mcp/) — tiered tool loading.