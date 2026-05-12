import type { LivectxMcpRuntime } from "./server-runtime.js"

export function buildToolsListResult(runtime: LivectxMcpRuntime) {
	return {
		tools: runtime.toolDescriptors(),
	}
}

export async function toolsCall(runtime: LivectxMcpRuntime, raw: unknown): Promise<unknown> {
	const p =
		raw !== null && typeof raw === "object"
			? (raw as { name?: unknown; arguments?: unknown })
			: undefined
	const name = p?.name
	if (typeof name !== "string" || !name) {
		throw new Error("tools/call: name required")
	}
	const args = ("arguments" in (p ?? {}) ? p.arguments : {}) as unknown
	return runtime.executeTool(name, args ?? {})
}
