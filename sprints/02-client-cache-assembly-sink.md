# Sprint 2: ContextClient, Cache, Assembly Pipeline & Anthropic Sink

> **Timeline:** Days 8–16 (Weeks 2–3)
> **Milestone:** M1 completion
> **Goal:** A fully working `ContextClient` with in-memory cache, the complete assembly pipeline (Section 6), linting warnings, and the Anthropic sink — enough to declare, assemble, and pass to the Anthropic SDK.

---

## Objectives

1. Implement the in-memory `StoreAdapter`.
2. Implement `ContextClient` with cache management, invalidation, SWR semantics.
3. Implement the 7-step assembly pipeline.
4. Implement the warning/lint system.
5. Implement `@livectx/sink-anthropic`.
6. End-to-end integration: declare bindings → assemble → get Anthropic-shaped output.

---

## Tasks

### 2.1 — In-memory store (`packages/core/src/cache.ts`)

- [ ] `createMemoryStore(): StoreAdapter` — a `Map`-backed implementation.
- [ ] `get<T>(key: string): Promise<CacheEntry<T> | undefined>`
- [ ] `set<T>(key: string, entry: CacheEntry<T>): Promise<void>`
- [ ] `delete(key: string): Promise<void>`
- [ ] `keys(): AsyncIterable<string>`
- [ ] `clear(): Promise<void>`
- [ ] GC sweep: periodic cleanup of entries past `gcTime`. Use a lazy approach — evict on access or on a configurable sweep interval.

**Tests:**
- [ ] Basic CRUD operations.
- [ ] `keys()` iteration correctness.
- [ ] GC eviction: set entry with short `gcTime`, verify it's gone after expiry.
- [ ] Concurrent read/write safety (Promise ordering).

### 2.2 — Dependency resolution (`packages/core/src/resolver.ts`)

- [ ] `topologicalSort(bindings: AnyBinding[]): AnyBinding[][]` — returns wave groups for parallel execution.
  - Bindings with no deps in wave 0, deps-on-wave-0 in wave 1, etc.
- [ ] `detectCycles(bindings: AnyBinding[]): BindingKey[] | null` — returns cycle path or null.
- [ ] `CircularDependencyError` class with informative message showing the cycle.
- [ ] Diamond dependency handling: if A → B → D and A → C → D, D appears once in the earliest wave.

**Tests:**
- [ ] Linear chain: A → B → C.
- [ ] Diamond: A → B, A → C, B → D, C → D.
- [ ] Cycle detection: A → B → A throws `CircularDependencyError`.
- [ ] Independent bindings in same wave.
- [ ] Single binding with no deps.

### 2.3 — `ContextClient` implementation (`packages/core/src/client.ts`)

Core responsibilities:

- [ ] **Constructor** `createContextClient(opts?: ContextClientOptions): ContextClient`
  - Initialize store (default: in-memory).
  - Apply default `staleTime` and `gcTime`.
  - Set up telemetry and warning handlers.

- [ ] **Cache resolution** (`resolveBinding`):
  | Cache state | Action |
  |-------------|--------|
  | Not present | Fetch → await → store → return |
  | Fresh | Return immediately |
  | Stale | Return cached, kick background refetch (SWR) |
  | Fetching (in-flight) | Await existing promise (dedup) |
  | Error + retries left | Retry per `RetryPolicy` |
  | Error final | Use `fallback` or throw |

- [ ] **Invalidation API:**
  - `invalidate(matcher: BindingKey | KeyMatcher): Promise<void>` — marks matching entries stale.
  - `refetch(matcher: BindingKey | KeyMatcher): Promise<void>` — invalidate + immediately fetch.

- [ ] **Cache access:**
  - `getCacheEntry<T>(binding): CacheEntry<T> | undefined`
  - `setCacheEntry<T>(binding, value): void`

- [ ] **Prefetch:** `prefetch(binding): Promise<void>` — fetch and cache without assembling.

- [ ] **Subscription lifecycle:**
  - `mount(binding): Unsubscribe` — calls binding's `subscribe()`, stores cleanup.
  - `isMounted(binding): boolean`

- [ ] **In-flight dedup:** Use a `Map<string, Promise<T>>` keyed by serialized binding key. Clear on resolve/reject.

- [ ] **Retry logic:** Implement `RetryPolicy` with linear/exponential backoff. Respect `AbortSignal`.

- [ ] **Dispose:** `dispose(): Promise<void>` — unmount all subscriptions, clear cache, abort in-flight.

**Tests:**
- [ ] Fresh cache hit returns without fetch.
- [ ] Cold miss triggers fetch and caches result.
- [ ] Stale entry returns cached value and triggers background refetch.
- [ ] In-flight dedup: 10 concurrent resolves → 1 fetch call.
- [ ] Invalidate by prefix → next resolve refetches.
- [ ] Invalidate by exact key.
- [ ] Invalidate by predicate.
- [ ] Refetch triggers immediate re-fetch.
- [ ] Retry with exponential backoff (mock timers).
- [ ] Fallback used on final retry failure.
- [ ] Throw on failure with no fallback.
- [ ] Mount/unmount subscription lifecycle.
- [ ] Subscribed binding invalidation: `onInvalidate()` → cache marked stale.
- [ ] Dependency cascade: invalidating a dep invalidates dependents.
- [ ] Dispose cleans up everything.

### 2.4 — Assembly pipeline (`packages/core/src/assemble.ts`)

Implement the 7-step pipeline from Section 6:

- [ ] **Step 1: Extract bindings from template.** Walk `Template.values`, collect all `Binding` instances. Include deps transitively.
- [ ] **Step 2: Topological sort + parallel wave resolution.** Use `topologicalSort()` from 2.2. For each wave, resolve all bindings in parallel using `client.resolveBinding()`.
- [ ] **Step 3: Render values.** For each resolved binding, call `binding.render(value)` or fall back to `JSON.stringify(value, null, 2)`.
- [ ] **Step 4: Segment by placement.** Split rendered template into `staticBlocks` and `dynamicBlocks` based on:
  - Binding placement (`static` vs `dynamic`).
  - Cache breakpoint marker position (explicit or inferred from first `dynamic` binding).
  - Literal template strings split at breakpoint and distributed.
- [ ] **Step 5: Lint warnings.** Emit warnings for:
  - `static-with-short-stale`: static binding with staleTime < 5m.
  - `dynamic-in-prefix`: dynamic binding before cache breakpoint.
  - `tool-without-schema`: tool binding missing input schema.
  - `fetch-slow`: binding fetch took > 2s.
  - `schema-mismatch`: schema validation failed on fetched value.
- [ ] **Step 6: Resolve tool bindings.** Collect `ToolBinding` instances from template and `opts.tools`, map to `ResolvedTool[]`.
- [ ] **Step 7: Hand to sink.** Call `sink.format(segments, tools)` and return the result along with metrics.

- [ ] **Metrics collection:** Track per-binding source (cache-fresh, cache-stale, fetch, subscription, error), latency, token estimation (chars / 4 heuristic), and aggregate prompt metrics.

- [ ] **`bustPromptCache` option:** When true, skip `cache_control` insertion in sink.
- [ ] **`onBindingError` option:** `"throw"` (default) vs `"fallback-or-omit"`.
- [ ] **`AssemblyError`** with `failedBindings` and optional `partialResult`.

**Tests:**
- [ ] Simple template with 2 static + 1 dynamic binding → correct segmentation.
- [ ] Cache breakpoint splits literal strings correctly.
- [ ] Inferred breakpoint (no explicit marker) placed at first dynamic binding.
- [ ] Dependencies resolved in correct order.
- [ ] Parallel resolution within a wave (mock fetchers with timing).
- [ ] Metrics include per-binding source and latency.
- [ ] Warning emitted for `static-with-short-stale`.
- [ ] Warning emitted for `dynamic-in-prefix`.
- [ ] `onBindingError: "fallback-or-omit"` omits failed bindings gracefully.
- [ ] `AssemblyError` thrown with context on failure.
- [ ] 10 cached bindings assemble in ≤5ms (benchmark test).

### 2.5 — Anthropic sink (`packages/sink-anthropic/`)

- [ ] `anthropicSink(): SinkAdapter<AnthropicSinkOutput>`
- [ ] `format(segments, tools)`:
  - `staticBlocks` → system content blocks with `cache_control: { type: "ephemeral" }` on the **last** static block.
  - `dynamicBlocks` → user message content.
  - `tools` → Anthropic tool schema format (`name`, `description`, `input_schema`).
  - `breakpointTtl` propagated if present.
- [ ] Output matches the `AnthropicSinkOutput` interface from spec Section 9.

**Tests:**
- [ ] Output shape matches snapshot fixture.
- [ ] `cache_control` placed on last static block only.
- [ ] TTL propagation from breakpoint options.
- [ ] Empty static blocks → no system content (or single block, no `cache_control`).
- [ ] Tool specs formatted correctly.
- [ ] Round-trip: output is directly passable to `@anthropic-ai/sdk` (type check, not runtime).

### 2.6 — End-to-end integration test

- [ ] Declare 3 bindings (project=static, services=dynamic with dep on project, alerts=dynamic).
- [ ] Assemble with Anthropic sink.
- [ ] Assert output shape, metrics, no warnings.
- [ ] Call assemble again → verify `source: "cache-fresh"` in metrics for cached bindings.
- [ ] Invalidate by prefix → next assemble refetches.
- [ ] Concurrent assemble dedup verified.

---

## Definition of Done

- [ ] `createContextClient()` works with in-memory store.
- [ ] Assembly pipeline resolves dependencies, renders, segments, lints, and formats.
- [ ] Anthropic sink produces SDK-compatible output with correct `cache_control` placement.
- [ ] Invalidation (exact, prefix, predicate) propagates correctly.
- [ ] SWR semantics: stale entries served while background refetch runs.
- [ ] In-flight dedup: concurrent assembles share a single fetch per binding.
- [ ] Warnings fire for documented misuse patterns.
- [ ] **80+ unit/integration tests**, all green.
- [ ] Benchmark: ≤5ms assembly overhead for 10 cached bindings.

---

## Files Created / Modified

```
packages/core/src/
├── cache.ts          # createMemoryStore()
├── resolver.ts       # topologicalSort(), detectCycles()
├── client.ts         # createContextClient() implementation
├── assemble.ts       # assembly pipeline
├── lint.ts           # warning generation
├── errors.ts         # AssemblyError, CircularDependencyError
├── index.ts          # updated exports
└── types.ts          # (unchanged, from Sprint 1)

packages/core/test/
├── cache.test.ts
├── resolver.test.ts
├── client.test.ts
├── assemble.test.ts
├── lint.test.ts
└── e2e.test.ts       # end-to-end integration

packages/sink-anthropic/
├── src/
│   ├── index.ts      # anthropicSink() + types
│   └── format.ts     # formatting logic
└── test/
    └── sink.test.ts
```

---

## Risks & Notes

- **Token estimation** is a heuristic (chars/4). Consider allowing sink-specific tokenizers later. For now, good enough.
- **Background refetch in SWR** must not block the current `assemble()` call. Use fire-and-forget with error logging.
- **`cache_control` placement** is Anthropic-specific. The segments abstraction must be generic enough for other sinks.
- **AbortSignal** threading through the entire pipeline is critical for cancellation support. Establish the pattern here.
- The assembly pipeline is the most complex piece of the library — invest heavily in tests.
