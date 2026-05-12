# Sprint 5: Additional Sink Adapters

> **Timeline:** Days 33–38 (Week 8)
> **Milestone:** M4
> **Goal:** Implement OpenAI, Vercel AI SDK, and raw sinks — same template + bindings produce SDK-shaped output for every supported provider.

---

## Objectives

1. Implement `@livectx/sink-openai`.
2. Implement `@livectx/sink-vercel-ai`.
3. Implement the raw sink (in `@livectx/core`).
4. Smoke test each sink against its respective SDK types.
5. Ensure the `SinkAdapter` contract is sufficiently general for all providers.

---

## Tasks

### 5.1 — OpenAI sink (`packages/sink-openai/`)

- [ ] `openaiSink(): SinkAdapter<OpenAISinkOutput>`
- [ ] Output shape:
  ```ts
  interface OpenAISinkOutput {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: JsonSchema;
      };
    }>;
    metrics: AssembleMetrics;
  }
  ```
- [ ] **System message:** Concatenate all static blocks + dynamic blocks into a single `system` message. OpenAI doesn't have explicit prefix caching control — the sink ensures byte-stable ordering for implicit prefix cache hits.
- [ ] **User message:** The user input portion (if template has it) goes to a `user` message.
- [ ] **Tools:** Formatted as OpenAI function-calling spec (`type: "function"`, nested `function` object).
- [ ] Handle the case where there's no system content (all dynamic → user message only).

**Tests:**
- [ ] Output shape matches snapshot fixture.
- [ ] System content is byte-stable across identical assemblies (for OpenAI prefix caching).
- [ ] Tools formatted as `{ type: "function", function: { ... } }`.
- [ ] Empty tools array when no tools provided.
- [ ] Metrics passed through.
- [ ] Type-check against `openai` SDK types (compile-time, optional dev dep).

### 5.2 — Vercel AI SDK sink (`packages/sink-vercel-ai/`)

- [ ] `vercelAISink(): SinkAdapter<VercelAISinkOutput>`
- [ ] Output shape:
  ```ts
  interface VercelAISinkOutput {
    system: string;
    messages: Array<UIMessage>;
    tools: Record<string, ToolDefinition>;
    metrics: AssembleMetrics;
  }
  ```
  Where `UIMessage` and `ToolDefinition` match Vercel AI SDK's expected types.
- [ ] **System:** Static + dynamic blocks concatenated as a single system string.
- [ ] **Messages:** User message as `{ role: "user", content: "..." }`.
- [ ] **Tools:** Keyed by tool name (not an array — Vercel AI uses `Record<string, ToolDefinition>`):
  ```ts
  {
    [toolName]: {
      description: string;
      parameters: JsonSchema;   // or Zod schema if vercel AI supports it
    }
  }
  ```
- [ ] Compatible with `streamText()` and `generateText()` from `ai` package.

**Tests:**
- [ ] Output shape matches snapshot fixture.
- [ ] Tools are a Record keyed by name, not an array.
- [ ] System is a plain string (not content blocks).
- [ ] Metrics included.
- [ ] Type-check against `ai` package types (compile-time, optional dev dep).

### 5.3 — Raw sink (`packages/core/src/sink-raw.ts`)

- [ ] `rawSink(): SinkAdapter<RawSinkOutput>`
- [ ] Output shape:
  ```ts
  interface RawSinkOutput {
    staticText: string;
    dynamicText: string;
    toolSpecs: ResolvedTool[];
    metrics: AssembleMetrics;
  }
  ```
- [ ] Minimal formatting: concatenate block texts with newlines.
- [ ] Useful for custom pipelines, debugging, and testing.
- [ ] Included in `@livectx/core` (no separate package).

**Tests:**
- [ ] Static and dynamic text separated correctly.
- [ ] Tool specs passed through as-is.
- [ ] Metrics included.

### 5.4 — Sink conformance test suite

Create a shared test harness that runs the same assertions across all sinks:

- [ ] **Same template, different sink → each produces valid output.**
- [ ] Test matrix:
  | Scenario | Anthropic | OpenAI | Vercel AI | Raw |
  |----------|-----------|--------|-----------|-----|
  | Static + dynamic bindings | ✓ | ✓ | ✓ | ✓ |
  | Tools present | ✓ | ✓ | ✓ | ✓ |
  | No tools | ✓ | ✓ | ✓ | ✓ |
  | Empty template | ✓ | ✓ | ✓ | ✓ |
  | Only static content | ✓ | ✓ | ✓ | ✓ |
  | Only dynamic content | ✓ | ✓ | ✓ | ✓ |
  | Multiple tools | ✓ | ✓ | ✓ | ✓ |

- [ ] Verify metrics are identical across sinks for the same input.
- [ ] Verify tools contain the same logical content regardless of sink-specific shape.

### 5.5 — "Real LLM" smoke tests (gated)

- [ ] Gated by `LIVECTX_E2E=1` environment variable.
- [ ] One test per sink:
  1. Assemble with Anthropic sink → call `anthropic.messages.create()` → assert non-empty response.
  2. Assemble with OpenAI sink → call `openai.chat.completions.create()` → assert non-empty response.
  3. Assemble with Vercel AI sink → call `generateText()` → assert non-empty response.
- [ ] One cache-hit test: assemble twice with Anthropic → assert `cache_read_input_tokens > 0` in usage.
- [ ] These tests are in `examples/` or a top-level `e2e/` directory, not in package tests.

### 5.6 — Custom sink documentation

- [ ] Write a `CUSTOM_SINKS.md` or in-code JSDoc showing the 3-step process:
  1. Define your output type.
  2. Implement `format(segments, tools)`.
  3. Register or pass to `assemble()`.
- [ ] Include the "my-internal" sink example from the spec (Section 9).

---

## Definition of Done

- [ ] All four sinks produce correct, SDK-compatible output.
- [ ] Same template + bindings yield semantically equivalent output across all sinks.
- [ ] Conformance test suite passes for all sinks across all scenarios.
- [ ] Anthropic sink has `cache_control` placement.
- [ ] OpenAI sink produces byte-stable system content for prefix caching.
- [ ] Vercel AI sink output is `streamText()`/`generateText()`-compatible.
- [ ] Raw sink provides clean debugging output.
- [ ] **30+ tests** (conformance suite + per-sink specifics).
- [ ] E2E smoke tests pass when `LIVECTX_E2E=1` (manual verification, not CI).

---

## Files Created / Modified

```
packages/sink-openai/
├── src/
│   ├── index.ts       # openaiSink() + types
│   └── format.ts      # formatting logic
├── test/
│   └── sink.test.ts
└── package.json

packages/sink-vercel-ai/
├── src/
│   ├── index.ts       # vercelAISink() + types
│   └── format.ts      # formatting logic
├── test/
│   └── sink.test.ts
└── package.json

packages/core/src/
├── sink-raw.ts        # NEW: rawSink()
└── index.ts           # export rawSink

packages/core/test/
└── sink-conformance.test.ts   # shared conformance suite

e2e/
├── anthropic.e2e.ts
├── openai.e2e.ts
└── vercel-ai.e2e.ts
```

---

## Dependencies

| Package | Runtime deps | Dev/peer deps |
|---------|-------------|---------------|
| `@livectx/sink-openai` | `@livectx/core` (peer) | `openai` (dev, for type-checking) |
| `@livectx/sink-vercel-ai` | `@livectx/core` (peer) | `ai` (dev, for type-checking) |
| `@livectx/core` (raw sink) | none | none |

---

## Risks & Notes

- **OpenAI prefix caching** is automatic and undocumented in detail. The best we can do is ensure byte-stable ordering. Monitor OpenAI's `cached_tokens` field when available.
- **Vercel AI SDK** is a fast-moving target. Pin to a specific major version in peer deps and document compatibility.
- **Sink output types** should be exported so users can type their code against them (e.g., `AnthropicSinkOutput`, `OpenAISinkOutput`).
- The conformance test suite is a long-term asset — every future sink must pass it.
