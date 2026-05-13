# Implementation Plan: Permissions & Cost Control

*Date: May 11, 2026*

## Motivation

Once agents can dynamically provision context for other agents (via `source()`, `tool()`, `exposeAsMcpServer()`), two problems immediately arise:

1. **Permissions** — A sub-agent should only access data and execute tools it's authorized for. Without guardrails, any agent with access to `client.executeTool()` can invoke anything registered.
2. **Cost control** — Unconstrained agents will burn through tokens and compute. A single runaway loop can generate thousands of assembly calls, each fetching fresh data and producing expensive prompts.

livectx sits at the perfect chokepoint: between data sources and the LLM SDK. Every binding resolution, tool execution, and assembly passes through the `ContextClient`. This makes it the natural enforcement layer.

---

## Design Principles

1. **Enforcement at the client, declaration at the binding.** Bindings can declare their requirements (scopes, cost weight). The client enforces policies based on its configured principal.
2. **Fail-closed by default.** If a policy is configured but a binding lacks scope annotations, deny access.
3. **Composable with MCP.** The MCP server boundary is already a natural permission edge — formalize it, don't fight it.
4. **Zero overhead when unused.** If no `policy` is configured on the client, all checks are skipped. No performance tax for simple use cases.
5. **Observable.** Every deny/budget event flows through `TelemetryAdapter` and `onWarning`.

---

## Sprint 9: Permissions (Hook-Based)

The permissions model is a **single hook** on the client. No scopes, no principals, no RBAC. Just a callback that receives what's about to happen and returns allow/deny. The consumer decides how to implement it — prompt the user via CLI, check against a policy file, call an API, or always return true.

### 9.1 — The Hook Type

Add to `packages/core/src/types.ts`:

```typescript
export interface ToolCallRequest {
  name: string
  input: unknown
  description: string
  bindingKey: BindingKey
}

export interface PermissionHook {
  onToolCall?: (request: ToolCallRequest) => boolean | Promise<boolean>
  onDeny?: "throw" | "return-error"
}
```

That's it. One hook, one decision point.

### 9.2 — Hook on ContextClientOptions

```typescript
export interface ContextClientOptions {
  // ... existing fields ...
  permissions?: PermissionHook
}
```

### 9.3 — Single Enforcement Point

The only gate is in `executeTool()` inside `client.ts`. This is the moment the agent tries to *act* — reading data (bindings) is always allowed, but executing side-effects requires approval.

```typescript
async executeTool(name: string, input: unknown): Promise<unknown> {
  const toolBinding = toolsByName.get(name)
  if (!toolBinding) throw new Error(`Unknown tool: ${name}`)

  if (permissions?.onToolCall) {
    const allowed = await permissions.onToolCall({
      name,
      input,
      description: toolBinding.__tool.description,
      bindingKey: toolBinding.__tool.key,
    })
    if (!allowed) {
      if (permissions.onDeny === "throw") {
        throw new ToolDeniedError(name, input)
      }
      return { error: `Tool "${name}" was denied by permissions hook.` }
    }
  }

  // ... proceed with execution
}
```

### 9.4 — Error Type

```typescript
export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly input: unknown,
  ) {
    super(`Tool call denied: ${toolName}`)
    this.name = "ToolDeniedError"
  }
}
```

### 9.5 — Example: CLI Confirmation

The power is in what consumers build on top of the hook:

```typescript
import readline from "node:readline"

const client = createContextClient({
  permissions: {
    onToolCall: async ({ name, input }) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve =>
        rl.question(`Allow "${name}" with ${JSON.stringify(input)}? [y/n] `, resolve)
      )
      rl.close()
      return answer.toLowerCase() === "y"
    },
    onDeny: "return-error",
  },
})
```

### 9.6 — Example: Allowlist

```typescript
const ALLOWED_TOOLS = new Set(["get_service_details", "list_deployments"])

const client = createContextClient({
  permissions: {
    onToolCall: ({ name }) => ALLOWED_TOOLS.has(name),
    onDeny: "throw",
  },
})
```

### 9.7 — Example: Agent provisioning a restricted sub-agent

```typescript
const subAgentClient = createContextClient({
  permissions: {
    onToolCall: ({ name, input }) => {
      if (name === "restart_service" && input.force) return false
      if (name.startsWith("delete_")) return false
      return true
    },
  },
})
```

### 9.8 — Tests

- `packages/core/test/permissions.test.ts`
  - Hook returning `true` → tool executes normally
  - Hook returning `false` + `onDeny: "throw"` → `ToolDeniedError`
  - Hook returning `false` + `onDeny: "return-error"` → returns error object
  - Async hook (simulating user prompt) works correctly
  - No `permissions` configured → all tools execute (zero overhead)
  - Hook receives correct `name`, `input`, `description`, `bindingKey`

### Design Rationale

Why a hook instead of scopes/RBAC:

1. **Scopes are premature abstraction.** We don't know what permission model users actually need. A hook lets them bring their own.
2. **User confirmation is the killer use case.** The most common need is "ask the human before doing something destructive." That's a 3-line hook, not a policy engine.
3. **Composable.** Users can layer any logic they want — allowlists, role checks, LLM-as-judge, rate limiting per tool — all in userland.
4. **Read vs. write distinction is natural.** Binding fetches (reads) don't need permission — they're just populating context. Tool execution (writes/side-effects) is where the gate belongs.

---

## Sprint 10: Cost Control

### 10.1 — Budget Types

```typescript
export interface Budget {
  maxTokensPerAssembly?: number
  maxCumulativeTokens?: number
  maxAssembliesPerMinute?: number
  maxFetchesPerMinute?: number
  minStaleTime?: Duration           // floor on freshness — forces cache use
  onExceeded?: "throw" | "warn" | "truncate"
}
```

### 10.2 — Budget on ContextClientOptions

```typescript
export interface ContextClientOptions {
  // ... existing fields ...
  policy?: Policy
  budget?: Budget
}
```

### 10.3 — Accounting State in Client

Inside `createContextClient`, add budget tracking:

```typescript
const accounting = {
  cumulativeTokens: 0,
  assembliesThisWindow: 0,
  fetchesThisWindow: 0,
  windowStart: Date.now(),
}
```

Rate windows reset every 60s via a lightweight interval (cleared on `dispose()`).

### 10.4 — Enforcement Points

| Location | Check | On Exceeded |
|----------|-------|-------------|
| `assemble` — after metrics computed | `totalTokens > maxTokensPerAssembly` | Throw `BudgetExceededError` / warn / truncate dynamic blocks |
| `assemble` — pre-flight | `assembliesThisWindow > maxAssembliesPerMinute` | Throw / warn |
| `fetchWithRetry` — pre-flight | `fetchesThisWindow > maxFetchesPerMinute` | Throw / use stale cache |
| `staleMs()` helper | `max(binding.staleTime, budget.minStaleTime)` | Forces longer cache TTL silently |
| `assemble` — post-return | `cumulativeTokens += totalTokens` | Throw on next call if over `maxCumulativeTokens` |

### 10.5 — `minStaleTime` Override (Compute Control)

The simplest cost lever: override freshness at the client level.

```typescript
function staleMs(binding: AnyBinding): number {
  const bindingStale = parseDuration(binding.__def.staleTime ?? opts.defaultStaleTime ?? 0)
  const budgetFloor = budget?.minStaleTime ? parseDuration(budget.minStaleTime) : 0
  return Math.max(bindingStale, budgetFloor)
}
```

A meta-agent provisioning a low-priority sub-agent sets `budget: { minStaleTime: "5m" }` — the sub-agent thinks it's getting fresh data, but the client silently serves from cache unless data is >5m old.

### 10.6 — Truncation Strategy

When `onExceeded: "truncate"`, the assembly pipeline should:
1. Compute full metrics (all bindings resolved).
2. If over budget, drop dynamic blocks from the end until under `maxTokensPerAssembly`.
3. Emit a `budget-exceeded` warning with details on what was truncated.
4. Never truncate static blocks (they're the cached prefix; removing them would invalidate the prompt cache).

### 10.7 — New Error Type

```typescript
export class BudgetExceededError extends Error {
  constructor(
    public readonly metric: "tokens" | "assemblies" | "fetches" | "cumulative",
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(`Budget exceeded: ${metric} ${actual} > ${limit}`)
    this.name = "BudgetExceededError"
  }
}
```

### 10.8 — Telemetry Integration

Extend `TelemetryAdapter`:

```typescript
export interface TelemetryAdapter {
  // ... existing ...
  recordBudgetCheck?(metric: string, actual: number, limit: number, allowed: boolean): void
  recordPermissionCheck?(key: BindingKey | string, principal: Principal, allowed: boolean): void
}
```

### 10.9 — Tests

- `packages/core/test/budget.test.ts`
  - Assembly exceeding `maxTokensPerAssembly` throws `BudgetExceededError`
  - `onExceeded: "truncate"` drops dynamic blocks
  - `onExceeded: "warn"` allows assembly but emits warning
  - `minStaleTime` forces cache use even when binding declares short stale
  - Rate limiting resets after window
  - `maxCumulativeTokens` blocks after sustained use
  - No budget configured → no overhead

---

## Sprint 11: Observability & DX for Governance

### 11.1 — `client.getUsage()` API

```typescript
interface UsageSnapshot {
  cumulativeTokens: number
  assembliesTotal: number
  assembliesThisWindow: number
  fetchesThisWindow: number
  deniedBindings: string[]
  deniedTools: string[]
  budgetRemaining: {
    tokens: number | "unlimited"
    assemblies: number | "unlimited"
  }
}

export interface ContextClient {
  // ... existing ...
  getUsage(): UsageSnapshot
}
```

### 11.2 — OpenTelemetry Spans

In `@livectx/otel`, add spans for:
- `livectx.permission.check` — scope evaluation result
- `livectx.budget.check` — budget evaluation result
- `livectx.budget.exceeded` — event when a limit is hit

### 11.3 — React Hook: `useUsage()`

In `@livectx/react`:
```typescript
export function useUsage(): UsageSnapshot
```

Polls `client.getUsage()` on an interval, useful for dashboards showing agent cost in real-time.

---

## Execution Order & Dependencies

```
Sprint 9 (Permissions Hook)    Sprint 10 (Cost Control)
    │                              │
    ├── 9.1 Hook type              ├── 10.1 Types
    ├── 9.2 ClientOptions          ├── 10.2 ClientOptions
    ├── 9.3 executeTool gate       ├── 10.3 Accounting state
    ├── 9.4 Error type             ├── 10.4 Enforcement points
    └── 9.5 Tests                  ├── 10.5 minStaleTime
                                   ├── 10.6 Truncation
                                   ├── 10.7 Error types
                                   ├── 10.8 Telemetry
                                   └── 10.9 Tests
                                          │
                                   Sprint 11 (Observability)
                                          │
                                          ├── 11.1 getUsage()
                                          ├── 11.2 OTel spans
                                          └── 11.3 React hook
```

Sprint 9 is now ~1 day of work (one hook, one gate, one error type). Sprint 10 is the heavier lift. They remain independent and parallelizable. Sprint 11 depends on both.

---

## Migration & Backward Compatibility

- All new fields are **optional**. Zero breaking changes to existing API.
- If `policy` is undefined, permission checks are skipped entirely (no perf cost).
- If `budget` is undefined, accounting state is never allocated.
- New errors (`PermissionDeniedError`, `BudgetExceededError`) extend `Error` — existing catch blocks still work.
- `scopes` on `BindingDef` / `ToolBindingDef` are optional arrays — existing bindings continue to work unchanged.

---

## Decisions

1. **Budget sharing** — No shared pools. Each client gets its own budget. Callers are responsible for calculating and allocating budgets to sub-agents. This keeps the library simple and pushes orchestration decisions to the consumer where they belong.

2. **Hook composition** — Yes, ship a `composeHooks(...hooks)` utility. Chains multiple permission hooks (e.g. allowlist + user confirmation for anything not on the list). Small, useful, easy to implement.

3. **Binding-level gates** — No. Don't gate reads at all. If you don't want an agent to see something, don't put it in the template. The permission hook is *only* for tool execution (side-effects). Keep it minimal.

4. **Audit log** — Not needed as a separate concern. The `onToolCall` hook gives consumers full control to log inside it. OTel integration captures denied calls as spans automatically.
