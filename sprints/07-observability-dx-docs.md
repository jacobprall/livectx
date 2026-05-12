# Sprint 7: Observability, React Hooks, DX Polish, Docs & Examples

> **Timeline:** Days 49–60 (Weeks 11–12)
> **Milestone:** M6
> **Goal:** Production-readiness polish — OpenTelemetry integration, React hooks, comprehensive warning system, docs site, and working examples.

---

## Objectives

1. Implement `@livectx/otel` — OpenTelemetry telemetry adapter.
2. Implement `@livectx/react` — React hooks for assembly and metrics.
3. Harden the warning system with all documented `WarningCode` patterns.
4. Build 3 working examples (infra-agent, customer-support, mcp-bridge).
5. Launch documentation site with API reference, getting-started guide, and design rationale.
6. Final benchmarks and performance audit.

---

## Tasks

### 7.1 — OpenTelemetry plugin (`packages/otel/`)

- [ ] `otelTelemetry(opts: OtelOptions): TelemetryAdapter`
- [ ] Options:
  ```ts
  interface OtelOptions {
    tracer: Tracer;   // from @opentelemetry/api
    meter?: Meter;    // optional metrics
  }
  ```
- [ ] Implement `TelemetryAdapter` interface:
  - `recordAssemble(metrics)`: Create `livectx.assemble` span with attributes:
    - `livectx.bindings.count`
    - `livectx.tokens.static`, `livectx.tokens.dynamic`, `livectx.tokens.total`
    - `livectx.cache_hit` (boolean)
    - `livectx.duration_ms`
    - `livectx.warnings.count`
  - `recordFetch(key, latencyMs, success)`: Create `livectx.fetch` child span with:
    - `livectx.binding.key` (serialized)
    - `livectx.fetch.latency_ms`
    - `livectx.fetch.success`
  - `recordWarning(warning)`: Create span event with warning details.

- [ ] Optional `Meter` integration for histograms:
  - `livectx.assemble.duration` histogram
  - `livectx.fetch.duration` histogram
  - `livectx.cache.hit_rate` gauge

**Tests:**
- [ ] Mock tracer captures expected spans.
- [ ] Span attributes match metrics from assembly.
- [ ] Child spans for fetches nested under assemble span.
- [ ] Warning events attached to spans.
- [ ] No errors when meter is not provided.

### 7.2 — React hooks (`packages/react/`)

- [ ] `LivectxProvider` — React context provider wrapping a `ContextClient`.
  ```tsx
  <LivectxProvider client={client}>
    <App />
  </LivectxProvider>
  ```

- [ ] `useAssemble(opts: UseAssembleOpts): UseAssembleResult`
  ```ts
  interface UseAssembleOpts {
    template: Template;
    sink: SinkAdapter;
    tools?: ToolBinding[];
    enabled?: boolean;
  }
  interface UseAssembleResult<F> {
    data: SinkOutput<F> | undefined;
    isLoading: boolean;
    error: Error | null;
    metrics: AssembleMetrics | undefined;
    refetch: () => Promise<void>;
  }
  ```
  - Triggers assembly on mount and when dependencies change.
  - Re-assembles when bindings are invalidated.
  - Debounced re-assembly on rapid invalidation (configurable).

- [ ] `useBinding<T>(binding: Binding<T>): UseBindi ngResult<T>`
  ```ts
  interface UseBindingResult<T> {
    data: T | undefined;
    isLoading: boolean;
    isStale: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
  }
  ```
  - Subscribes to a single binding's cache state.
  - Triggers re-render on cache updates.

- [ ] `useMetrics(): AssembleMetrics | undefined`
  - Returns metrics from the most recent assembly.
  - Useful for a dev panel showing token counts, cache hits, warnings.

- [ ] Dev panel component (optional, tree-shakeable):
  ```tsx
  import { LivectxDevPanel } from "@livectx/react/dev";
  ```
  - Shows real-time metrics: token counts, cache states, warnings.
  - Collapsible overlay, only included in development builds.

**Tests:**
- [ ] `useAssemble` returns data after assembly.
- [ ] `useAssemble` re-renders on invalidation.
- [ ] `useBinding` tracks single binding state.
- [ ] Loading states correct during fetch.
- [ ] Error state propagated.
- [ ] Provider context accessible.
- [ ] Cleanup on unmount (subscriptions removed).

### 7.3 — Warning system hardening (`packages/core/src/lint.ts`)

Ensure all `WarningCode` patterns fire correctly:

- [ ] **`static-with-short-stale`**: Static binding with `staleTime < 5m`.
  - Severity: `warn`.
  - Message: clear explanation of why this defeats prompt caching.
- [ ] **`dynamic-in-prefix`**: Dynamic binding interpolated before cache breakpoint.
  - Severity: `warn`.
  - Message: suggests moving binding after breakpoint or changing to `static`.
- [ ] **`cache-buster-detected`**: Binding value changes on every call despite `static` placement.
  - Severity: `warn`.
  - Detection: hash comparison across consecutive assemblies.
- [ ] **`tool-without-schema`**: Tool binding with no `toJsonSchema()` on input.
  - Severity: `warn`.
  - Message: model will receive poorly-described parameters.
- [ ] **`fetch-slow`**: Non-subscribed binding fetch took > 2s.
  - Severity: `info`.
  - Message: suggest moving to `tool` placement for JIT.
- [ ] **`subscription-dropped`**: Subscription callback errored or server disconnected.
  - Severity: `error`.
  - Message: falling back to polling.
- [ ] **`schema-mismatch`**: Fetched value fails schema validation.
  - Severity: `error`.
  - Message: includes key and validation error details.

**Tests:**
- [ ] Each warning code has at least 2 tests (positive case + edge case).
- [ ] Warnings include binding key for context.
- [ ] `onWarning` callback receives all warnings.
- [ ] Warnings included in `AssembleMetrics.warnings`.

### 7.4 — Examples

#### `examples/infra-agent/`
The motivating example from the spec — an infrastructure management agent.

- [ ] Bindings: `project` (static), `services` (dynamic, dep on project), `alerts` (dynamic, subscribed).
- [ ] Tools: `serviceLogs`, `restartService`.
- [ ] Assembles with Anthropic sink.
- [ ] Agent loop: assemble → call LLM → handle tool use → re-assemble.
- [ ] README with setup instructions and expected behavior.
- [ ] Mock API server for local testing.

#### `examples/customer-support/`
A customer support agent with tiered context loading.

- [ ] Bindings: `customerProfile` (static), `recentTickets` (dynamic), `productDocs` (tool).
- [ ] Demonstrates the summary + tool JIT pattern.
- [ ] Uses OpenAI sink.
- [ ] README with setup instructions.

#### `examples/mcp-bridge/`
Demonstrates the bidirectional MCP flywheel.

- [ ] Client A: bindings + tools → exposed as MCP server.
- [ ] Client B: consumes from Client A's MCP server.
- [ ] Shows subscription-driven invalidation across the bridge.
- [ ] Uses Vercel AI SDK sink on Client B side.
- [ ] README explaining the architecture.

### 7.5 — Documentation site

- [ ] Choose framework: **Astro Starlight** (recommended) or Nextra.
- [ ] Pages:
  - **Getting Started** — 5-minute quickstart (from spec Section 18).
  - **Core Concepts** — bindings, placement, keys, staleness, dependencies.
  - **Template DSL** — `prompt` tag, cache breakpoints, interpolation.
  - **Assembly Pipeline** — the 7-step process with diagram.
  - **Caching & Invalidation** — two-layer model, SWR, subscription-driven.
  - **Sinks** — Anthropic, OpenAI, Vercel AI, raw, custom.
  - **MCP Integration** — consumer (mcpResource, mcpTools) and provider (exposeAsMcpServer).
  - **Tool Placement & JIT** — patterns, when to use each placement.
  - **Observability** — metrics, warnings, OpenTelemetry.
  - **React Hooks** — useAssemble, useBinding, dev panel.
  - **API Reference** — generated from TypeDoc.
  - **Design Rationale** — why tagged templates, why two-layer cache, etc.
- [ ] Deploy to GitHub Pages or Vercel.

### 7.6 — TypeDoc API reference

- [ ] Configure `typedoc` for all packages.
- [ ] Generate API docs from JSDoc comments.
- [ ] Integrate into docs site as a sub-section.
- [ ] Ensure all public exports have JSDoc with `@example` tags.

### 7.7 — Benchmarks (`packages/core/test/bench/`)

- [ ] `assemble-cached.bench.ts`: 10 bindings, all cache hits → target ≤5ms.
- [ ] `assemble-cold.bench.ts`: 10 bindings, all cold → measure baseline.
- [ ] `key-serialize.bench.ts`: 10k key serializations → measure overhead.
- [ ] `store-memory.bench.ts`: 10k get/set operations.
- [ ] Results reported via `vitest bench` with regression detection.
- [ ] Add `pnpm bench` root script.

### 7.8 — Final audit

- [ ] Zero `any` in public API types.
- [ ] All packages build clean (ESM + CJS).
- [ ] All tests pass.
- [ ] No circular dependencies between packages (`madge` check).
- [ ] Bundle size audit: `@livectx/core` < 15KB minified+gzipped.
- [ ] Tree-shaking verification: unused sinks/sources not included in bundle.
- [ ] README.md at root with badges, overview, and links to docs.

---

## Definition of Done

- [ ] OTel adapter emits correct spans and metrics.
- [ ] React hooks work for assembly, binding observation, and dev metrics.
- [ ] All 7 `WarningCode` patterns fire correctly with clear messages.
- [ ] 3 working examples with README instructions.
- [ ] Docs site deployed with all listed pages.
- [ ] API reference generated and integrated.
- [ ] Benchmarks pass targets (≤5ms cached assembly).
- [ ] Bundle size within target.
- [ ] **100+ total new tests** across all additions in this sprint.

---

## Files Created / Modified

```
packages/otel/
├── src/
│   ├── index.ts           # otelTelemetry()
│   └── spans.ts           # span creation logic
├── test/
│   └── otel.test.ts
└── package.json           # peer dep: @opentelemetry/api

packages/react/
├── src/
│   ├── index.ts           # public exports
│   ├── provider.tsx        # LivectxProvider
│   ├── use-assemble.ts    # useAssemble hook
│   ├── use-binding.ts     # useBinding hook
│   ├── use-metrics.ts     # useMetrics hook
│   └── dev/
│       └── panel.tsx      # LivectxDevPanel (tree-shakeable)
├── test/
│   ├── use-assemble.test.tsx
│   ├── use-binding.test.tsx
│   └── provider.test.tsx
└── package.json           # peer deps: react, @livectx/core

packages/core/src/
└── lint.ts                # hardened warnings

packages/core/test/
├── lint.test.ts           # comprehensive warning tests
└── bench/
    ├── assemble-cached.bench.ts
    ├── assemble-cold.bench.ts
    ├── key-serialize.bench.ts
    └── store-memory.bench.ts

examples/
├── infra-agent/
│   ├── src/
│   │   ├── bindings.ts
│   │   ├── tools.ts
│   │   └── agent.ts
│   ├── package.json
│   └── README.md
├── customer-support/
│   ├── src/
│   │   ├── bindings.ts
│   │   └── agent.ts
│   ├── package.json
│   └── README.md
└── mcp-bridge/
    ├── src/
    │   ├── server.ts
    │   ├── client.ts
    │   └── bridge.ts
    ├── package.json
    └── README.md

docs/                       # Astro Starlight site
├── astro.config.mjs
├── src/content/docs/
│   ├── getting-started.md
│   ├── concepts/
│   ├── guides/
│   └── reference/
└── package.json
```

---

## Dependencies

| Package | Runtime deps | Peer deps |
|---------|-------------|-----------|
| `@livectx/otel` | `@livectx/core` | `@opentelemetry/api` |
| `@livectx/react` | `@livectx/core` | `react >= 18` |
| docs | N/A | `astro`, `@astrojs/starlight` |

---

## Risks & Notes

- **React hooks** require careful memoization to avoid re-render storms on rapid invalidation. Use `useSyncExternalStore` internally for subscription-safe state.
- **Dev panel** should be behind a `process.env.NODE_ENV !== 'production'` guard and tree-shaken in production builds.
- **Docs site** is a significant effort. Prioritize Getting Started and Core Concepts; API reference can be auto-generated. Other pages can land iteratively.
- **Benchmark regression** detection should be part of CI (compare against baseline, fail on >20% regression).
- This sprint is the widest in scope — consider splitting React hooks and docs into a Sprint 7b if timeline is tight.
