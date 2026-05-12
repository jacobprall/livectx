# Sprint 3: MCP Consumer Package

> **Timeline:** Days 17–24 (Weeks 4–5)
> **Milestone:** M2
> **Goal:** `@livectx/mcp` as a consumer — connect to MCP servers, bind resources and tools, handle subscriptions with polling fallback.

---

## Objectives

1. Implement MCP client transport layer (HTTP streamable + stdio).
2. Implement `mcpResource()` — sugar over `source()` that speaks MCP `resources/read` + `resources/subscribe`.
3. Implement `mcpTools()` — discover and wrap MCP server tools as `ToolBinding[]`.
4. Implement `mcpResources()` — bulk-bind all resources from a server.
5. Handle subscription lifecycle: subscribe, notification routing, fallback to polling.

---

## Tasks

### 3.1 — MCP client transport (`packages/mcp/src/transport.ts`)

- [ ] Define `McpTransportConfig`:
  ```ts
  type McpTransportConfig =
    | { type: "http"; url: string; headers?: Record<string, string> }
    | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> };
  ```
- [ ] **HTTP transport:** Use the official `@modelcontextprotocol/sdk` client or implement a minimal SSE/fetch-based transport that speaks the MCP JSON-RPC protocol.
- [ ] **Stdio transport:** Spawn child process, pipe JSON-RPC over stdin/stdout.
- [ ] Both transports must support:
  - `initialize` handshake (exchange capabilities).
  - Bidirectional JSON-RPC (requests + notifications).
  - Connection lifecycle (connect, disconnect, reconnect).
- [ ] Store server capabilities after `initialize` (needed for subscribe feature detection).

**Decision: Build vs. depend on `@modelcontextprotocol/sdk`:**
- Prefer wrapping `@modelcontextprotocol/sdk` (maintained, protocol-complete) over reimplementing the wire protocol.
- `@livectx/mcp` has this as a `dependency` (it's an optional package, so it doesn't affect `@livectx/core`'s zero-dep goal).

### 3.2 — `mcpClient()` factory (`packages/mcp/src/client.ts`)

- [ ] `mcpClient(config: McpTransportConfig): Promise<McpClientHandle>`
- [ ] `McpClientHandle` exposes:
  - `capabilities: ServerCapabilities` (from initialize)
  - `listResources(): Promise<McpResourceDescriptor[]>`
  - `readResource(uri: string): Promise<McpResourceContent>`
  - `listTools(): Promise<McpToolDescriptor[]>`
  - `callTool(name: string, args: unknown): Promise<unknown>`
  - `subscribe(uri: string, onUpdate: () => void): Unsubscribe`
  - `dispose(): Promise<void>`
- [ ] Auto-reconnect with configurable backoff for HTTP transport.
- [ ] Graceful shutdown for stdio transport (SIGTERM child process).

**Tests:**
- [ ] Mock MCP server (in-process JSON-RPC handler) for both HTTP and stdio.
- [ ] Initialize handshake exchanges capabilities.
- [ ] `listResources` returns expected descriptors.
- [ ] `readResource` returns content for a known URI.
- [ ] `callTool` sends correct request and returns result.
- [ ] Connection error → reconnect attempt.

### 3.3 — `mcpResource()` binding factory (`packages/mcp/src/resource.ts`)

- [ ] `mcpResource(server: McpClientHandle, opts: McpResourceOpts): Binding<string>`
- [ ] Options:
  ```ts
  interface McpResourceOpts {
    uri: string;
    placement?: Placement;        // default: "dynamic"
    staleTime?: Duration;         // polling fallback interval
    gcTime?: Duration;
    render?: (value: string) => string;
  }
  ```
- [ ] Key generation: `["mcp", serverId, uri]` — serverId derived from transport URL or command.
- [ ] `fetch` implementation: calls `server.readResource(uri)`.
- [ ] `subscribe` implementation:
  - If server capabilities include `resources.subscribe: true`:
    - Call `resources/subscribe` with the URI.
    - Route `notifications/resources/updated` for this URI to `onInvalidate()`.
    - Return unsubscribe that calls `resources/unsubscribe`.
  - If server lacks subscribe capability:
    - Return `undefined` for subscribe (falls back to staleTime polling by ContextClient).

**Tests:**
- [ ] Resource with subscribe-capable server: updates route to invalidation.
- [ ] Resource with non-subscribe server: polling fallback at staleTime.
- [ ] Subscription drop → `subscription-dropped` warning emitted → polling fallback engages within 1s.
- [ ] Multiple resources on same server share one transport.

### 3.4 — `mcpTools()` tool discovery (`packages/mcp/src/tools.ts`)

- [ ] `mcpTools(server: McpClientHandle): Promise<ToolBinding<unknown, unknown>[]>`
- [ ] For each tool from `server.listTools()`:
  - Create a `ToolBinding` with:
    - `key: ["mcp", serverId, "tool", toolName]`
    - `name`: from MCP tool descriptor
    - `description`: from MCP tool descriptor
    - `input`: JSON schema from MCP → wrap in `Schema<T>` adapter
    - `fetch`: calls `server.callTool(name, input)`

**Tests:**
- [ ] Tools listed from mock server become `ToolBinding[]`.
- [ ] Tool execution routes through `callTool` correctly.
- [ ] JSON schema from MCP tool descriptor preserved in `inputSchema`.

### 3.5 — `mcpResources()` bulk binding (`packages/mcp/src/resources.ts`)

- [ ] `mcpResources(server: McpClientHandle, opts?: BulkOpts): Promise<Binding<string>[]>`
- [ ] Calls `listResources()`, creates a `mcpResource()` for each.
- [ ] Shared placement/staleTime defaults from `opts`.

**Tests:**
- [ ] Bulk bind 5 resources → 5 bindings with correct keys.
- [ ] Each resource subscribable independently.

### 3.6 — JSON Schema → Schema adapter (`packages/mcp/src/schema-adapter.ts`)

- [ ] `jsonSchemaToSchema(js: JsonSchema): Schema<unknown>` — wraps a JSON schema object into the `Schema<T>` contract.
- [ ] `parse()`: basic runtime validation using JSON schema (use `ajv` as optional peer dep, or a lightweight inline validator).
- [ ] `safeParse()`: wraps parse in try/catch.
- [ ] `toJsonSchema()`: returns the original schema.

**Tests:**
- [ ] Simple object schema validates correctly.
- [ ] Invalid input caught by `safeParse`.
- [ ] `toJsonSchema()` round-trips.

### 3.7 — Integration test: MCP resource lifecycle

- [ ] Stand up a mock MCP server (HTTP transport) with 2 resources and 1 tool.
- [ ] `mcpClient()` → `mcpResource()` → assemble with Anthropic sink.
- [ ] Server sends `notifications/resources/updated` → binding invalidated → next assemble fetches fresh.
- [ ] `mcpTools()` → tool appears in assembled output.
- [ ] Subscription drop (kill server) → warning emitted → polling fallback.
- [ ] Reconnect server → subscription re-established.

---

## Definition of Done

- [ ] `mcpClient()` connects over HTTP and stdio transports.
- [ ] `mcpResource()` binds to MCP resources with subscribe/poll semantics.
- [ ] `mcpTools()` discovers and wraps MCP tools as `ToolBinding[]`.
- [ ] Subscription notifications route to correct binding invalidation.
- [ ] Polling fallback engages within 1s of subscription drop.
- [ ] All MCP tool specs appear correctly in assembled sink output.
- [ ] **40+ tests** covering transports, resource binding, tool discovery, subscription lifecycle.

---

## Files Created / Modified

```
packages/mcp/
├── src/
│   ├── index.ts           # public exports
│   ├── transport.ts       # HTTP + stdio transport
│   ├── client.ts          # mcpClient() factory
│   ├── resource.ts        # mcpResource()
│   ├── resources.ts       # mcpResources() bulk
│   ├── tools.ts           # mcpTools()
│   ├── schema-adapter.ts  # JSON Schema → Schema<T>
│   └── types.ts           # McpTransportConfig, McpClientHandle, etc.
├── test/
│   ├── mock-server.ts     # reusable mock MCP server
│   ├── transport.test.ts
│   ├── client.test.ts
│   ├── resource.test.ts
│   ├── tools.test.ts
│   └── integration.test.ts
└── package.json           # depends on @modelcontextprotocol/sdk
```

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation (runtime dep of `@livectx/mcp`).
- `ajv` (optional peer dep) — for JSON schema validation in `schema-adapter.ts`. Could also use a lightweight inline approach for basic schemas.

---

## Risks & Notes

- **MCP protocol version:** Target the 2025-03-26 spec revision. The `@modelcontextprotocol/sdk` should handle wire compatibility.
- **Stdio transport** requires Node.js `child_process`. This won't work in browsers/workers. The package should tree-shake this away or error clearly.
- **Subscription re-establishment** on reconnect needs to re-subscribe to all previously subscribed URIs. Track them in the client handle.
- **Server ID derivation** must be deterministic — hash of transport config. This ensures `BindingKey` stability across reconnections.
