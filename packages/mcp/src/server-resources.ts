import type { ResourceSubscriptionHub } from "./server-notifications.js"
import type { LivectxMcpRuntime } from "./server-runtime.js"

/** resources/list shapes for JSON-RPC handlers. */
export function buildResourcesListResult(rt: LivectxMcpRuntime) {
	return {
		resources: rt.urisOrdered.map((uri) => {
			const b = rt.resourceUriToBinding.get(uri)
			return {
				uri,
				name: rt.resourceName(uri),
				description: b?.__def.description,
				mimeType: "text/plain",
			}
		}),
	}
}

export async function resourcesRead(
	runtime: LivectxMcpRuntime,
	uri: unknown,
): Promise<{
	contents: Array<{ uri: string; text: string; mimeType?: string }>
}> {
	if (typeof uri !== "string" || !uri) {
		throw new Error("resources/read: uri required")
	}
	const out = await runtime.readRendered(uri)
	return {
		contents: [{ uri, text: out.text, mimeType: out.mimeType }],
	}
}

/** resources/subscribe + resources/unsubscribe using session-bound subscription tracker. */
export function resourcesSubscribe(
	uri: unknown,
	hub: ResourceSubscriptionHub,
	sessionId: number,
): void {
	if (typeof uri !== "string" || !uri) {
		throw new Error("resources/subscribe: uri required")
	}
	hub.subscribe(uri, sessionId)
}

export function resourcesUnsubscribe(
	uri: unknown,
	hub: ResourceSubscriptionHub,
	sessionId: number,
): void {
	if (typeof uri !== "string" || !uri) {
		throw new Error("resources/unsubscribe: uri required")
	}
	hub.unsubscribe(uri, sessionId)
}
