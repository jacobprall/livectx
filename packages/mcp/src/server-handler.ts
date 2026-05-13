import type { ContextClient, Unsubscribe } from "@livectx/core"
import {
	LATEST_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js"
import { ResourceSubscriptionHub } from "./server-notifications.js"
import type { NotifyFn } from "./server-notifications.js"
import {
	buildResourcesListResult,
	resourcesRead,
	resourcesSubscribe,
	resourcesUnsubscribe,
} from "./server-resources.js"
import { LivectxMcpRuntime } from "./server-runtime.js"
import { buildToolsListResult, toolsCall } from "./server-tools.js"
import type { McpServerOpts } from "./server-types.js"

export type McpSessionId = number

function extractParam<K extends string>(params: unknown, key: K): unknown {
	if (params !== null && typeof params === "object" && key in (params as Record<string, unknown>)) {
		return (params as Record<string, unknown>)[key]
	}
	return undefined
}

/** Test-centric JSON-RPC surface for MCP resources/tools (no network transports). */
export class McpServerHandler {
	private readonly hub = new ResourceSubscriptionHub()
	private readonly unsubInvalidate: Unsubscribe

	constructor(private readonly runtime: LivectxMcpRuntime) {
		this.unsubInvalidate = this.runtime.onBindingInvalidated((uri) => this.hub.notify(uri))
	}

	dispose(): void {
		this.unsubInvalidate()
	}

	onNotification(listener: NotifyFn): Unsubscribe {
		return this.hub.onProtocolNotification(listener)
	}

	createSession(send: NotifyFn): { readonly id: McpSessionId; dispose: () => void } {
		return this.hub.createSession(send)
	}

	async prefetchBindings(): Promise<void> {
		await this.runtime.prefetchExposed()
	}

	async handleRequest(
		method: string,
		params?: unknown,
		sessionContext?: McpSessionId | undefined,
	): Promise<unknown | undefined> {
		switch (method) {
			case "initialize":
				return this.handleInitialize(params)
			case "notifications/initialized":
				return undefined
			case "ping":
				return {}
			case "resources/list":
				return buildResourcesListResult(this.runtime)
			case "resources/read":
				return resourcesRead(this.runtime, extractParam(params, "uri"))
			case "resources/subscribe": {
				const uri = extractParam(params, "uri")
				const sid = this.requireSession(sessionContext, method)
				resourcesSubscribe(uri, this.hub, sid)
				return {}
			}
			case "resources/unsubscribe": {
				const uri = extractParam(params, "uri")
				const sid = this.requireSession(sessionContext, method)
				resourcesUnsubscribe(uri, this.hub, sid)
				return {}
			}
			case "tools/list":
				return buildToolsListResult(this.runtime)
			case "tools/call":
				return toolsCall(this.runtime, params as never)
			default:
				throw new Error(`Unknown method: ${method}`)
		}
	}

	getRuntime(): LivectxMcpRuntime {
		return this.runtime
	}

	private handleInitialize(params: unknown) {
		const requested = extractParam(params, "protocolVersion") as string | undefined
		const protocolVersion =
			requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested as never)
				? requested
				: LATEST_PROTOCOL_VERSION
		const caps: {
			resources?: { subscribe: boolean }
			tools?: Record<string, never>
		} = {
			resources: { subscribe: true },
		}
		if (this.runtime.toolsByName.size > 0) {
			caps.tools = {}
		}

		return {
			protocolVersion,
			capabilities: caps,
			serverInfo: { name: this.runtime.serverOpts.name, version: this.runtime.serverOpts.version },
		}
	}

	private requireSession(sessionContext: number | undefined, methodName: string): number {
		if (sessionContext === undefined) {
			throw new Error(`${methodName} requires a session identifier from createSession`)
		}
		return sessionContext
	}
}

export function createMcpServerHandler(
	client: ContextClient,
	opts: McpServerOpts,
): McpServerHandler {
	return new McpServerHandler(new LivectxMcpRuntime(client, opts))
}
