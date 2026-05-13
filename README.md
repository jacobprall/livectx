# livectx

**A declarative, cached, MCP-aware context layer for LLM applications.** Think TanStack Query for prompt assembly: declare bindings once, and the library handles freshness, caching, invalidation, and produces SDK-shaped outputs for whatever LLM client you use. It never calls the LLM itself — it gives you the perfectly structured input to pass into your SDK of choice.

---

## Quick Example

```typescript
import { createContextClient, source, prompt, cacheBreakpoint } from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"

// 1. Declare bindings — typed, cached references to external data
const project = source({
  key: ["project", "acme"],
  placement: "static",     // rarely changes → goes in cached prefix
  staleTime: "1h",
  fetch: async () => db.getProject("acme"),
})

const alerts = source({
  key: ["alerts"],
  placement: "dynamic",    // volatile → goes after cache breakpoint
  fetch: async () => monitoring.getActiveAlerts(),
})

// 2. Compose a template — just a tagged template literal
const template = prompt`You are an infrastructure agent.

Project: ${project}

${cacheBreakpoint()}

Active alerts: ${alerts}

User question: ${userMessage}`

// 3. Assemble → SDK-ready output
const client = createContextClient()
const result = await client.assemble({ template, sink: anthropicSink() })

// result.system, result.messages, result.tools → pass directly to anthropic.messages.create()
```

The static portion (`project`) is placed before the cache breakpoint with `cache_control` markers so the LLM provider can cache it across turns. The dynamic portion (`alerts`) goes after, regenerated each time. You pay for the full prompt once, then only the dynamic tail on subsequent calls.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Framework integrations (optional)                 │
│  @livectx/react                                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Sink adapters (output format)                     │
│  @livectx/sink-anthropic, sink-openai, sink-vercel-ai       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Source adapters (input transport)                  │
│  @livectx/mcp (consumer + server)                           │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: ContextClient (core engine)                       │
│  Cache, resolver, assembler, invalidation, subscriptions    │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Primitives (core)                                 │
│  source(), tool(), prompt`…`, key system, duration parser   │
└─────────────────────────────────────────────────────────────┘
```

Layers 1–2 live in `@livectx/core` with **zero runtime dependencies**. Everything above is an opt-in package. The library works in Node, Bun, Deno, Cloudflare Workers, and browsers.

### Packages

| Package | Description |
|---------|-------------|
| `@livectx/core` | Primitives, ContextClient, assembly pipeline, in-memory cache |
| `@livectx/sink-anthropic` | Formats output for `anthropic.messages.create()` |
| `@livectx/sink-openai` | Formats output for OpenAI Chat Completions API |
| `@livectx/sink-vercel-ai` | Formats output for Vercel AI SDK |
| `@livectx/mcp` | MCP consumer (connect to servers) + MCP provider (expose bindings as a server) |
| `@livectx/otel` | OpenTelemetry integration (traces, metrics, warning spans) |
| `@livectx/react` | React hooks: `useAssemble`, `useBinding`, `LivectxProvider` |

### Assembly Pipeline (7 steps)

1. **Extract** — walk the template, collect bindings and their dependency graphs
2. **Topological sort** — arrange into parallel resolution waves
3. **Resolve** — fetch all bindings (SWR from cache, parallel within each wave, retries)
4. **Render** — stringify each resolved value (custom `render()` or JSON)
5. **Segment** — split at `cacheBreakpoint()` into static prefix + dynamic suffix
6. **Lint** — emit warnings for misuse patterns (e.g. dynamic binding before breakpoint)
7. **Format** — pass segments + tool specs to the sink adapter for final SDK-shaped output

---

## Key Design Decisions

### Two-layer caching model

LLM APIs like Anthropic's cache the *prefix* of the system prompt across turns. livectx exploits this by sorting stable data before a breakpoint (where the provider's cache kicks in) and volatile data after it. The library's own SWR cache avoids re-fetching stable bindings, while `cache_control` markers ensure the LLM provider caches the rendered prefix.

### Placement as a first-class property

Every binding declares `placement: "static" | "dynamic" | "tool"`:
- **static** — stable context (user profile, project config). Goes in the cached prefix.
- **dynamic** — volatile data (alerts, metrics). Goes after the breakpoint.
- **tool** — available on-demand via function calling. Never in the prompt text; only in the tool spec array.

This explicit model makes caching behavior predictable rather than emergent.

### Sink adapters decouple format from logic

The assembly pipeline produces a generic `{ staticBlocks, dynamicBlocks, tools }` structure. Sink adapters translate this to SDK-specific shapes. Adding a new provider (e.g. Google Gemini) is a single `format()` function — no changes to core.

### MCP as a native protocol

livectx can both **consume** MCP servers (pull resources/tools into bindings) and **expose** its own bindings as an MCP server. This means any livectx-powered agent can share its context graph with other tools in the ecosystem without custom plumbing.

### Tool bindings and the JIT pattern

Instead of stuffing everything into the system prompt, livectx supports declaring data as a tool. The model sees a brief description and calls the tool only when it needs detail. This keeps the context window small while maintaining full access to deep data.

### Zero runtime dependencies in core

`@livectx/core` has no `dependencies` — only optional peer deps (Zod for schema validation). This ensures it works in any JavaScript runtime without bundler configuration or polyfills.

### Dependency graphs between bindings

Bindings can declare `dependsOn: { project }` to receive resolved values from other bindings. The resolver topologically sorts the graph, detects cycles, and resolves independent bindings in parallel.

---

## Quickstart

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Install

```bash
# In a new or existing project
pnpm add @livectx/core @livectx/sink-anthropic
```

### Minimal usage

```typescript
import { createContextClient, source, prompt, cacheBreakpoint } from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"

const userProfile = source({
  key: ["user", "current"],
  placement: "static",
  staleTime: "30m",
  fetch: async () => ({ name: "Alice", role: "admin", plan: "enterprise" }),
})

const recentActivity = source({
  key: ["activity", "recent"],
  placement: "dynamic",
  fetch: async () => ["Deployed v2.1", "Scaled workers to 4"],
})

const template = prompt`You are a helpful assistant for ${userProfile}.

${cacheBreakpoint()}

Recent activity: ${recentActivity}

How can I help?`

const client = createContextClient()
const result = await client.assemble({ template, sink: anthropicSink() })

// Pass directly to Anthropic SDK:
// await anthropic.messages.create({ ...result, model: "claude-sonnet-4-20250514", max_tokens: 1024 })
```

### Add tools

```typescript
import { tool, toolList, zodToSchema } from "@livectx/core"
import { z } from "zod"

const getServiceLogs = tool({
  key: ["tools", "service_logs"],
  name: "get_service_logs",
  description: "Fetch recent log lines for a service",
  input: zodToSchema(z.object({
    serviceId: z.string(),
    lines: z.number().default(50),
  })),
  fetch: async ({ serviceId, lines }) => logger.tail(serviceId, lines),
})

const template = prompt`You are an infra agent.

${cacheBreakpoint()}

${toolList([getServiceLogs])}

Investigate the reported issue.`

const result = await client.assemble({
  template,
  sink: anthropicSink(),
  tools: [getServiceLogs],
})

// result.tools contains the tool spec; when the model calls it:
const output = await client.executeTool("get_service_logs", { serviceId: "api", lines: 20 })
```

### Use with OpenAI or Vercel AI SDK

```typescript
import { openaiSink } from "@livectx/sink-openai"
import { vercelAISink } from "@livectx/sink-vercel-ai"

// Same template, different output format
const openaiResult = await client.assemble({ template, sink: openaiSink() })
const vercelResult = await client.assemble({ template, sink: vercelAISink() })
```

### Connect to an MCP server

```typescript
import { mcpClient, mcpResource, mcpTools } from "@livectx/mcp"

const mcp = await mcpClient({ transport: { type: "stdio", command: "my-mcp-server" } })

const readme = mcpResource(mcp, "file:///project/README.md", { placement: "static" })
const tools = await mcpTools(mcp)

const template = prompt`Context: ${readme}
${cacheBreakpoint()}
${toolList(tools)}`
```

### Expose bindings as an MCP server

```typescript
import { exposeAsMcpServer } from "@livectx/mcp"

exposeAsMcpServer({
  bindings: [userProfile, recentActivity],
  tools: [getServiceLogs],
  transport: { type: "http", port: 3001 },
})
```

### Development (contributing)

```bash
git clone <repo-url> && cd livectx
pnpm install
pnpm build        # Build all packages
pnpm test         # Run all 173 tests
pnpm typecheck    # Full TypeScript check
pnpm lint         # Biome linter
```

Interactive demos are in the `demo/` folder:

```bash
pnpm --filter demo run demo:basics     # Binding + assembly basics
pnpm --filter demo run demo:cache      # SWR caching behavior
pnpm --filter demo run demo:tools      # Tool bindings & JIT pattern
pnpm --filter demo run demo:sinks      # Multi-sink output comparison
pnpm --filter demo run demo:mcp        # MCP bridge (consumer + server)
```

---

## License

MIT
