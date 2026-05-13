import type { PermissionHook, ToolCallRequest } from "./types.js"

/**
 * Chains multiple permission hooks. All hooks must return true for the call to proceed.
 * Hooks are evaluated in order; short-circuits on first deny.
 */
export function composeHooks(...hooks: PermissionHook[]): PermissionHook {
	return {
		onToolCall: async (request: ToolCallRequest) => {
			for (const hook of hooks) {
				if (hook.onToolCall) {
					const allowed = await hook.onToolCall(request)
					if (!allowed) return false
				}
			}
			return true
		},
		onDeny: hooks.find((h) => h.onDeny)?.onDeny ?? "return-error",
	}
}
