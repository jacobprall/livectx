# Sprint 1: Core Primitives

> **Timeline:** Days 3–7 (Week 1)
> **Milestone:** M1 part 1
> **Goal:** Implement Layer 1 — the foundational types, `source()` constructor, key system, and template DSL. No client, no cache, no assembly yet.

---

## Objectives

1. Define and export all core TypeScript types from the spec (Section 4).
2. Implement key serialization, structural equality, and pattern matching.
3. Implement the `source()` binding constructor with full type inference.
4. Implement the `prompt` tagged template literal and `cacheBreakpoint()`.
5. Achieve 100% test coverage on these primitives.

---

## Tasks

### 1.1 — Core types (`packages/core/src/types.ts`)

Export every type from Section 4 of the spec:

- [ ] `KeyAtom`, `BindingKey`, `KeyMatcher`
- [ ] `Duration`, `Placement`
- [ ] `BindingDef<T, Deps>`, `Binding<T, Deps>`, `AnyBinding`, `ResolvedDeps<Deps>`
- [ ] `FetchContext`, `Unsubscribe`, `RetryPolicy`
- [ ] `ToolBindingDef<I, O>`, `ToolBinding<I, O>`
- [ ] `Template`, `TemplateValue`
- [ ] `Schema<T>`, `JsonSchema`
- [ ] `CacheEntry<T>`, `ContextClientOptions`
- [ ] `AssembleOptions<F>`, `SinkOutput<F>`, `AssembleMetrics`, `BindingMetric`
- [ ] `Warning`, `WarningCode`
- [ ] `StoreAdapter`, `SinkAdapter<Output>`, `AssembledSegments`, `TextBlock`, `ResolvedTool`
- [ ] `TelemetryAdapter`

Design notes:
- Use `readonly` generously on array types for immutability.
- `Binding<T, Deps>` should use a branded/phantom type for `__type` (never assigned, only inferred).
- `Schema<T>` is a minimal contract compatible with Zod, Valibot, ArkType.

### 1.2 — Duration parser (`packages/core/src/duration.ts`)

- [ ] `parseDuration(d: Duration): number` — converts `"5m"` → `300_000`, `"200ms"` → `200`, `"Infinity"` → `Infinity`, raw number passthrough.
- [ ] Throw `InvalidDurationError` on bad input.
- [ ] **Tests:** all suffix variants (`ms`, `s`, `m`, `h`), edge cases (`0`, `"Infinity"`, negative numbers → error).

### 1.3 — Key system (`packages/core/src/key.ts`)

- [ ] `serializeKey(key: BindingKey): string` — deterministic JSON serialization. Objects have keys sorted alphabetically. Used as cache map keys.
- [ ] `keysEqual(a: BindingKey, b: BindingKey): boolean` — structural equality via serialized comparison.
- [ ] `matchKey(key: BindingKey, matcher: KeyMatcher): boolean` — handles `exact`, `prefix`, and `predicate` variants.
- [ ] `isKeyMatcher(v: unknown): v is KeyMatcher` — type guard to distinguish `BindingKey` from `KeyMatcher` in overloaded APIs.

**Tests:**
- [ ] Round-trip serialization with nested objects, reordered keys.
- [ ] `prefix` match: `["services"]` matches `["services", "p_42"]` but not `["alerts"]`.
- [ ] `prefix` match with objects in key atoms.
- [ ] `predicate` match: custom function, including one that throws.
- [ ] Empty key edge case.

### 1.4 — `source()` constructor (`packages/core/src/binding.ts`)

- [ ] `source<T, Deps>(def: BindingDef<T, Deps>): Binding<T, Deps>` — wraps the def in a `Binding` object with frozen `__def`.
- [ ] Apply defaults: `placement → "dynamic"`, `staleTime → 0`, `gcTime → "5m"`.
- [ ] Validate at construction time:
  - Key must be non-empty array.
  - `fetch` must be a function.
  - If `placement === "tool"`, warn that `tool()` should be used instead.
- [ ] Type inference: `source({ key: [...], fetch: () => ({ id: 1 }) })` should infer `Binding<{ id: number }>`.

**Tests:**
- [ ] Construction with minimal args.
- [ ] Construction with all args (deps, subscribe, render, schema, retry).
- [ ] Default values applied correctly.
- [ ] Type inference smoke test (compile-time — use `expectTypeOf` from vitest).
- [ ] Invalid key throws.

### 1.5 — Template DSL (`packages/core/src/template.ts`)

- [ ] `prompt(strings: TemplateStringsArray, ...values: TemplateValue[]): Template`
  - Returns a `Template` data object: `{ strings, values }`.
  - No rendering, no resolution — purely data capture.
  - Validates that each value is a recognized `TemplateValue` type.
- [ ] `cacheBreakpoint(opts?: { ttl?: "5m" | "1h" }): TemplateValue`
  - Returns `{ __marker: "cache-breakpoint", ttl }`.
- [ ] `toolList(tools: readonly ToolBinding<any, any>[]): TemplateValue`
  - Returns `{ __marker: "tool-list", tools }`.

**Tests:**
- [ ] Basic template with plain strings and binding interpolations.
- [ ] Template with cache breakpoint in the middle.
- [ ] Template with mixed value types (string, number, boolean, binding).
- [ ] Multiple cache breakpoints → second one wins (or error — decide and document).
- [ ] Empty template.
- [ ] Template preserves insertion order of `strings` and `values`.

### 1.6 — Public exports (`packages/core/src/index.ts`)

- [ ] Re-export all types from `types.ts`.
- [ ] Re-export `source` from `binding.ts`.
- [ ] Re-export `prompt`, `cacheBreakpoint` from `template.ts`.
- [ ] Re-export key utilities (optionally, as `@livectx/core/keys` sub-path or directly).
- [ ] Re-export `parseDuration` (as internal utility, not necessarily public API).

---

## Definition of Done

- [ ] All types compile cleanly under `strict` mode with no `any` escape hatches in public API.
- [ ] `source()` constructs a binding with correct defaults and type inference.
- [ ] `prompt` tag captures template data faithfully.
- [ ] Key serialization is deterministic across object key orderings.
- [ ] Key matching works for all three `KeyMatcher` variants.
- [ ] Duration parsing covers all spec'd formats.
- [ ] **50+ unit tests** covering the above, all green.
- [ ] Package builds to ESM + CJS via tsup.

---

## Files Created / Modified

```
packages/core/src/
├── types.ts          # all type definitions from spec §4
├── duration.ts       # parseDuration()
├── key.ts            # serializeKey(), keysEqual(), matchKey()
├── binding.ts        # source() constructor
├── template.ts       # prompt tag, cacheBreakpoint()
└── index.ts          # public re-exports

packages/core/test/
├── duration.test.ts
├── key.test.ts
├── binding.test.ts
└── template.test.ts
```

---

## Risks & Notes

- **Phantom types** (`__type`, `__def`) need care — TypeScript may strip them in `.d.ts` output if not referenced. Use a branded intersection pattern.
- **Key serialization** must be stable across JS engines. `JSON.stringify` with sorted keys (custom replacer) is the pragmatic choice.
- The `Schema<T>` interface is intentionally minimal — no need to implement a schema library, just the contract Zod/Valibot satisfy.
- `TemplateValue` union must be discriminable at runtime (for the assembler in Sprint 2). Add a `__brand` or use `instanceof` for `Binding` types.
