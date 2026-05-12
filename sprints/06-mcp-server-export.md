# Sprint 6: MCP Server Export

> **Timeline:** Days 39–48 (Weeks 9–10)
> **Milestone:** M5
> **Goal:** `exposeAsMcpServer()` — expose bindings as MCP resources and tools as MCP tools, completing the bidirectional MCP story.

---

## Objectives

1. Implement `exposeAsMcpServer()` that maps bindings → MCP resources and tools → MCP tools.
2. Support HTTP and stdio MCP server transports.
3. Emit `notifications/resources/updated` when bindings are invalidated.
4. Validate interoperability with MCP Inspector and Claude Desktop.

---

## Tasks

### 6.1 — MCP server core (`packages/mcp/src/server.ts`)

- [ ] `exposeAsMcpServer(client: ContextClient, opts: McpServerOpts): McpServerHandle`
- [ ] Options:
  ```ts
  interface McpServerOpts {
    name: string;
    version: string;
    resources?: AnyBinding[];
    tools?: ToolBinding<any, any>[];
  }
  ```
- [ ] `McpServerHandle` exposes:
  - `listen(config: McpServerTransportConfig): Promise<void>`
  - `close(): Promise<void>`
  - `notifyResourceUpdated(uri: string): void` (programmatic notification trigger)

### 6.2 — Binding → MCP resource mapping (`packages/mcp/src/server-resources.ts`)

- [ ] For each `source()` binding in `opts.resources`:
  - **`resources/list`:** Return a resource descriptor:
    ```ts
    {
      uri: bindingKeyToUri(binding.key),   // e.g. "livectx://project/p_42"
      name: binding.description || serializeKey(binding.key),
      description: binding.description,
      mimeType: "application/json"
    }
    ```
  - **`resources/read`:** Resolve the binding via `client` (respects cache), render value, return as resource content.
  - **`resources/subscribe`** capability: advertised if binding has `subscribe()`.
  - **`notifications/resources/updated`:** Emitted when:
    - The binding is invalidated (via `client.invalidate()`).
    - The binding's subscription fires `onInvalidate()`.
    - Programmatic `notifyResourceUpdated()` call.

- [ ] URI scheme: `livectx://<key-segments-joined-by-/>`. E.g., key `["project", "p_42"]` → `livectx://project/p_42`.
- [ ] Handle key → URI and URI → key bidirectional mapping.

**Tests:**
- [ ] `resources/list` returns correct descriptors for all exposed bindings.
- [ ] `resources/read` returns the current binding value (cache hit or fresh fetch).
- [ ] Subscribe capability advertised when binding has `subscribe()`.
- [ ] Notification sent when binding invalidated via `client.invalidate()`.

### 6.3 — Tool → MCP tool mapping (`packages/mcp/src/server-tools.ts`)

- [ ] For each `tool()` binding in `opts.tools`:
  - **`tools/list`:** Return tool descriptor:
    ```ts
    {
      name: tool.__tool.name,
      description: tool.__tool.description,
      inputSchema: tool.__tool.input.toJsonSchema()
    }
    ```
  - **`tools/call`:** Parse input with tool's schema, call `tool.__tool.fetch()`, return result.

**Tests:**
- [ ] `tools/list` returns correct descriptors.
- [ ] `tools/call` with valid input → correct result.
- [ ] `tools/call` with invalid input → proper MCP error response.

### 6.4 — HTTP transport (`packages/mcp/src/server-transport-http.ts`)

- [ ] Implement MCP server over HTTP with SSE for server-to-client notifications.
- [ ] JSON-RPC request/response over POST endpoints.
- [ ] SSE stream for `notifications/*` messages.
- [ ] Configurable port, host, path prefix.
- [ ] Use `@modelcontextprotocol/sdk`'s server utilities if available, or implement minimal HTTP handler.
- [ ] CORS headers for browser-based MCP clients.

**Tests:**
- [ ] Server starts and responds to `initialize`.
- [ ] `resources/list` via HTTP returns correct response.
- [ ] SSE stream receives `notifications/resources/updated`.
- [ ] Multiple concurrent clients handled.
- [ ] Graceful shutdown on `close()`.

### 6.5 — Stdio transport (`packages/mcp/src/server-transport-stdio.ts`)

- [ ] Read JSON-RPC from stdin, write to stdout.
- [ ] Same handler as HTTP, different transport layer.
- [ ] Useful for local MCP clients (Claude Desktop, Cursor).

**Tests:**
- [ ] Pipe JSON-RPC messages through stdin/stdout.
- [ ] Notifications written to stdout.
- [ ] Clean exit on close.

### 6.6 — Notification pipeline

- [ ] Hook into `ContextClient`'s invalidation events.
- [ ] When a binding used in `exposeAsMcpServer` is invalidated:
  1. Map binding key → resource URI.
  2. Send `notifications/resources/updated` with `{ uri }` to all subscribed clients.
- [ ] Track which clients have subscribed to which resources.
- [ ] Handle client disconnect → remove subscriptions.

**Tests:**
- [ ] Invalidate binding → notification sent to subscribed client.
- [ ] Non-subscribed client doesn't receive notification.
- [ ] Client subscribes to specific resource → only gets updates for that resource.
- [ ] Client disconnects → no more notifications, no errors.
- [ ] Invalidation cascade: dep invalidated → dependent notified.

### 6.7 — Round-trip integration test

The flagship test for the bidirectional MCP story:

- [ ] **Setup:**
  1. Create `ContextClient A` with bindings (project, services, alerts) and tools (serviceLogs).
  2. `exposeAsMcpServer(clientA, { resources: [project, services, alerts], tools: [serviceLogs] })` → listen on HTTP.
  3. Create `ContextClient B`.
  4. `mcpClient({ type: "http", url: "..." })` → connect to server.
  5. `mcpResource(server, { uri: "livectx://project/p_42" })` → bind in client B.
  6. `mcpTools(server)` → get tools in client B.

- [ ] **Test flow:**
  1. Client B assembles → reads project from MCP server → correct value.
  2. Client A invalidates project → notification sent → Client B's binding marked stale.
  3. Client B assembles again → refetches from MCP server → fresh value.
  4. Client B calls `serviceLogs` tool via MCP → correct result.

- [ ] This test validates the entire flywheel: write bindings once, expose as MCP, consume from another client.

### 6.8 — MCP Inspector compatibility

- [ ] Manual test: run `exposeAsMcpServer()` and connect MCP Inspector.
- [ ] Verify:
  - Resources listed correctly.
  - Resources readable.
  - Tools listed correctly.
  - Tools callable.
  - Notifications visible in inspector.
- [ ] Document any protocol quirks or required config.

---

## Definition of Done

- [ ] `exposeAsMcpServer()` maps bindings → resources and tools → tools.
- [ ] HTTP and stdio transports work for server hosting.
- [ ] `notifications/resources/updated` emitted on binding invalidation.
- [ ] Subscription tracking per-client works correctly.
- [ ] Round-trip test passes: expose → consume → invalidate → re-read.
- [ ] MCP Inspector can list, read, and call exposed resources and tools.
- [ ] **40+ tests** covering mapping, transports, notifications, round-trip.

---

## Files Created / Modified

```
packages/mcp/src/
├── server.ts                   # exposeAsMcpServer()
├── server-resources.ts         # binding → MCP resource mapping
├── server-tools.ts             # tool → MCP tool mapping
├── server-transport-http.ts    # HTTP + SSE transport
├── server-transport-stdio.ts   # stdio transport
├── server-notifications.ts     # notification pipeline
├── uri.ts                      # key ↔ URI mapping
└── index.ts                    # updated exports

packages/mcp/test/
├── server.test.ts
├── server-resources.test.ts
├── server-tools.test.ts
├── server-transport.test.ts
├── notifications.test.ts
├── uri.test.ts
└── round-trip.test.ts
```

---

## Dependencies

Same as Sprint 3 — `@modelcontextprotocol/sdk` for protocol handling.

---

## Risks & Notes

- **URI scheme design** (`livectx://...`) needs to be documented and stable. Changing it later breaks MCP clients that cache URIs.
- **Concurrent MCP clients** connecting to the same server need proper session isolation for subscription tracking.
- **Resource content format:** MCP resources return `text` or `blob`. Binding values should be serialized to JSON text. Non-serializable values (functions, symbols) need handling.
- **Tool execution context:** When a remote MCP client calls a tool, the `FetchContext` should include signal propagation for cancellation.
- The round-trip test is the most valuable integration test in the entire project — it validates the core value proposition.
