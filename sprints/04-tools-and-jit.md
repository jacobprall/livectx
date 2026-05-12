# Sprint 4: Tool Bindings & JIT Placement

> **Timeline:** Days 25–32 (Weeks 6–7)
> **Milestone:** M3
> **Goal:** First-class `tool()` constructor, schema-to-JSON-schema translation, `client.executeTool()`, and the inline-summary + tool-for-detail pattern.

---

## Objectives

1. Implement `tool()` constructor with full Zod schema integration.
2. Implement `ResolvedTool` emission in the assembly pipeline.
3. Implement `client.executeTool()` convenience method.
4. Build the Zod-to-JSON-Schema adapter.
5. Support the "small inline summary + tool for detail" pattern.
6. Validate tool specs match Anthropic/OpenAI expected formats.

---

## Tasks

### 4.1 — `tool()` constructor (`packages/core/src/binding.ts` — extend)

- [ ] `tool<I, O>(def: ToolBindingDef<I, O>): ToolBinding<I, O>`
- [ ] `ToolBindingDef` requires:
  - `key: BindingKey`
  - `name: string` (the tool name the model sees)
  - `description: string`
  - `input: Schema<I>` (input schema — must have `toJsonSchema()`)
  - `output?: Schema<O>` (optional output validation)
  - `fetch: (input: I, ctx: FetchContext) => Promise<O>`
  - `retry?: RetryPolicy`
- [ ] `ToolBinding<I, O>` extends `Binding<O>` with `__tool: ToolBindingDef<I, O>`.
- [ ] Placement forced to `"tool"` (override any user-provided placement).
- [ ] Construction-time validation:
  - `name` must be non-empty, match `^[a-zA-Z_][a-zA-Z0-9_]*$` (model tool naming convention).
  - `description` must be non-empty.
  - `input` must implement `toJsonSchema()` — emit `tool-without-schema` warning if it doesn't.

**Tests:**
- [ ] Construct a tool with Zod schema → correct `ToolBinding` object.
- [ ] Invalid name (spaces, empty) → throws.
- [ ] Input without `toJsonSchema()` → warning emitted.
- [ ] Type inference: `tool({ input: z.object({ id: z.string() }), ... })` infers `I = { id: string }`.

### 4.2 — Zod adapter (`packages/core/src/zod-adapter.ts`)

- [ ] `zodToJsonSchema(schema: ZodType): JsonSchema` — convert Zod schema to JSON Schema for tool specs.
- [ ] Support common Zod types:
  - `z.string()`, `z.number()`, `z.boolean()`, `z.null()`
  - `z.object({})` with required/optional fields
  - `z.array()`
  - `z.enum()`
  - `z.union()` / `z.discriminatedUnion()`
  - `z.literal()`
  - `.describe()` → `description` field
  - `.default()` → `default` field
  - `.min()` / `.max()` → `minimum` / `maximum`
  - `.optional()` → remove from `required`
- [ ] Alternatively, detect if the Zod schema already has `toJsonSchema()` (Zod v4+) and defer to it.
- [ ] Wrap Zod schemas to satisfy the `Schema<T>` interface:
  ```ts
  function wrapZod<T>(schema: ZodType<T>): Schema<T>
  ```

**Design decision:** Zod is an optional peer dependency. The adapter should be tree-shakeable. Users who don't use Zod can provide a `Schema<T>` manually.

**Tests:**
- [ ] `z.object({ name: z.string(), age: z.number().int() })` → correct JSON schema.
- [ ] Nested objects.
- [ ] Arrays with item schemas.
- [ ] Enums and literals.
- [ ] Optional fields not in `required`.
- [ ] Descriptions propagated.
- [ ] Default values included.
- [ ] Round-trip: Zod validates → JSON schema generated → validates same shape.

### 4.3 — Tool resolution in assembly (`packages/core/src/assemble.ts` — extend)

- [ ] **Step 6 of pipeline** (from Sprint 2): Collect tool bindings from:
  1. `TemplateValue` instances that are `ToolBinding` (interpolated in template via `toolList()`).
  2. `opts.tools` array passed to `assemble()`.
  3. Deduplicate by tool name.
- [ ] Map each `ToolBinding` to `ResolvedTool`:
  ```ts
  {
    name: tool.__tool.name,
    description: tool.__tool.description,
    inputSchema: tool.__tool.input.toJsonSchema(),
    execute: (input) => tool.__tool.fetch(tool.__tool.input.parse(input), ctx)
  }
  ```
- [ ] The `execute` function validates input against the schema before calling fetch.
- [ ] Deduplicate tools by name — last one wins if conflict (emit warning).

**Tests:**
- [ ] Tool bindings in template appear in assembled output.
- [ ] Tools from `opts.tools` appear in assembled output.
- [ ] Dedup by name.
- [ ] `inputSchema` matches expected JSON schema.
- [ ] `execute` validates input and calls fetch.
- [ ] Invalid input to `execute` → schema validation error.

### 4.4 — `client.executeTool()` (`packages/core/src/client.ts` — extend)

- [ ] `executeTool(name: string, input: unknown): Promise<unknown>`
- [ ] Looks up the tool from the most recent `assemble()` result's resolved tools.
- [ ] Alternative: maintain a tool registry on the client (tools registered via `assemble()` or `registerTool()`).
- [ ] Validates input, calls `tool.execute(input)`, returns result.
- [ ] Respects `RetryPolicy` on the tool binding.
- [ ] Emits telemetry for tool execution.

**Tests:**
- [ ] Execute a registered tool → correct result.
- [ ] Unknown tool name → clear error.
- [ ] Invalid input → schema validation error.
- [ ] Retry on fetch failure.
- [ ] Telemetry emitted.

### 4.5 — Sink integration for tools

Update `@livectx/sink-anthropic` (and prepare interface for future sinks):

- [ ] **Anthropic sink:** Tools formatted as:
  ```ts
  { name: string, description: string, input_schema: JsonSchema }
  ```
- [ ] Verify output matches Anthropic SDK's expected `tools` parameter shape.
- [ ] Tool descriptions include any `cache_control` if tools should be cached (Anthropic supports this).

**Tests:**
- [ ] Tool in assembled Anthropic output matches expected shape.
- [ ] Multiple tools with different schemas.
- [ ] Tool with complex nested input schema.

### 4.6 — The JIT pattern: summary + tool combo

Document and test the recommended pattern from Section 11:

- [ ] **Example:** `serviceSummary` (inline, dynamic) + `serviceDetails` (tool).
- [ ] The summary is always in context; the tool is available for the model to call on demand.
- [ ] Write an integration test demonstrating:
  1. Template includes `serviceSummary` binding (inline) + `serviceDetails` tool.
  2. Assembly output has summary in dynamic blocks and tool in tools list.
  3. Model can decide when to call the tool (verified by shape, not actual LLM call).

**Tests:**
- [ ] Summary appears in dynamic blocks.
- [ ] Tool appears in tools array.
- [ ] Both coexist without conflict.
- [ ] Metrics track both (inline binding + tool spec).

---

## Definition of Done

- [ ] `tool()` constructs valid tool bindings with schema validation.
- [ ] Zod schemas convert to correct JSON Schema for tool specs.
- [ ] Assembly pipeline includes tools in output (from template and `opts.tools`).
- [ ] `client.executeTool()` routes and executes tool calls with validation.
- [ ] Anthropic sink tool output matches SDK expectations.
- [ ] The summary + tool JIT pattern works end-to-end.
- [ ] **50+ tests** covering tools, schema conversion, assembly integration, execution.

---

## Files Created / Modified

```
packages/core/src/
├── binding.ts         # extended with tool()
├── zod-adapter.ts     # NEW: Zod → JSON Schema → Schema<T>
├── assemble.ts        # extended: Step 6 tool resolution
├── client.ts          # extended: executeTool()
└── index.ts           # export tool, wrapZod

packages/core/test/
├── tool.test.ts       # tool() constructor tests
├── zod-adapter.test.ts
├── tool-assembly.test.ts
├── execute-tool.test.ts
└── jit-pattern.test.ts

packages/sink-anthropic/
├── src/format.ts      # extended: tool formatting
└── test/tools.test.ts
```

---

## Dependencies

- `zod` — **optional peer dependency** of `@livectx/core`. Users who don't use Zod provide `Schema<T>` manually.

---

## Risks & Notes

- **Zod version compatibility:** Zod v3 and v4 have different APIs for JSON schema generation. The adapter should handle both, or document minimum version.
- **Tool name uniqueness** across MCP tools (Sprint 3) and user-defined tools. Need a conflict resolution strategy — namespace prefixing or last-wins with warning.
- **`executeTool` state:** The client needs to track which tools are "active" from the latest assembly. Consider making this explicit rather than implicit.
- **Schema validation performance:** For high-throughput tool execution, schema validation on every call adds overhead. Consider a `skipValidation` option for production.
