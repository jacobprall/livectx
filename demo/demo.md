# livectx Demo Walkthrough

Five progressive demos that showcase every layer of the library — from basic binding/assembly to bidirectional MCP. No API keys needed; everything uses mock data.

## Setup

```bash
# From the repo root
pnpm install
pnpm build
```

## Running the Demos

Run all five in sequence:

```bash
pnpm --filter @livectx/demo demo:all
```

Or pick one:

| Command | What it shows |
|---------|---------------|
| `pnpm --filter @livectx/demo demo:basics` | Declare bindings, assemble an Anthropic-shaped prompt |
| `pnpm --filter @livectx/demo demo:caching` | SWR semantics, cache hits, invalidation, concurrent dedup |
| `pnpm --filter @livectx/demo demo:tools` | `tool()` with Zod schemas, JIT pattern, `executeTool()` |
| `pnpm --filter @livectx/demo demo:sinks` | Same template → Anthropic, OpenAI, Vercel AI, Raw output |
| `pnpm --filter @livectx/demo demo:mcp` | Expose bindings as MCP server, consume from another client |

---

## Demo 1: Basics

**File:** `src/01-basics.ts`

The core loop of livectx:

1. **Declare bindings** with `source()` — typed, keyed references to data
2. **Write a template** with `prompt``  — the prompt as you'd read it, with `${}` interpolations
3. **Assemble** with `client.assemble()` — resolves bindings, segments by placement, formats for your SDK

```ts
const project = source({
  key: ["project", "acme"],
  placement: "static",      // → goes in cached prefix
  staleTime: "1h",
  fetch: async () => api.getProject(),
});

const template = prompt`You are an infra agent.
Project: ${project}
${cacheBreakpoint()}
Alerts: ${alerts}`;

const result = await client.assemble({ template, sink: anthropicSink() });
// result.system, result.messages, result.tools → pass to SDK
```

Key takeaways:
- **`static` bindings** go before the cache breakpoint → LLM prefix cache hit
- **`dynamic` bindings** go after → always fresh
- The output is SDK-ready — pass it directly to `anthropic.messages.create()`

## Demo 2: Caching & Invalidation

**File:** `src/02-caching.ts`

Shows the TanStack Query-inspired cache model:

- **First assembly**: cold cache → all bindings fetched
- **Second assembly**: `config` (staleTime=10m) served from cache, `metrics` (staleTime=0) re-fetched
- **After invalidation**: invalidated bindings re-fetched on next assembly
- **Concurrent dedup**: 5 parallel assemblies → 1 fetch per binding
- **Prefix stability**: static text is byte-identical across calls → LLM cache hits

## Demo 3: Tools & JIT

**File:** `src/03-tools.ts`

The JIT pattern — small summary inline, full detail via tool:

```ts
// Always in context (tiny)
const summary = source({ ..., render: s => `${s.total} services` });

// Only fetched when model asks
const details = tool({
  name: "get_service_details",
  input: zodToSchema(z.object({ serviceId: z.string() })),
  fetch: async ({ serviceId }) => api.getService(serviceId),
});
```

Shows:
- `tool()` with Zod schema → JSON Schema for the model
- Tools appear in `result.tools` alongside inline context
- `client.executeTool()` validates input and runs the tool

## Demo 4: Multi-Sink

**File:** `src/04-multi-sink.ts`

Same bindings + same template → four different output formats:

| Sink | Output shape |
|------|-------------|
| Anthropic | `{ system: [{type,text,cache_control}], messages, tools }` |
| OpenAI | `{ messages: [{role,content}], tools: [{type:"function",...}] }` |
| Vercel AI | `{ system: string, messages, tools: Record<name, def> }` |
| Raw | `{ staticText, dynamicText, toolSpecs }` |

Metrics are consistent across all sinks — same tokens, same cache state.

## Demo 5: MCP Bridge

**File:** `src/05-mcp-bridge.ts`

The bidirectional flywheel:

1. **Server side**: declare bindings + tools, expose as MCP server
2. **Client side**: connect over MCP, list resources, read values, call tools
3. **Invalidation flows**: server invalidates → MCP notification → client refetches

This is the core value proposition: write bindings once for your own prompts, expose them as an MCP server for other agents to consume.

---

## Running the Test Suite

```bash
# All 173 tests
pnpm test

# Benchmarks (assembly perf)
pnpm bench

# Type checking
pnpm typecheck
```
