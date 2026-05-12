import { createHash } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import type { McpTransportConfig } from "./transport.js"
import type {
	ServerCapabilities as LivectxServerCapabilities,
	McpClientHandle,
	McpResourceContent,
	McpResourceDescriptor,
	McpToolDescriptor,
} from "./types.js"

function stableServerId(config: McpTransportConfig): string {
	return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 32)
}

function mapServerCapabilities(
	sdkCaps: ReturnType<Client["getServerCapabilities"]>,
): LivectxServerCapabilities {
	const out: LivectxServerCapabilities = {}
	if (sdkCaps?.resources?.subscribe) {
		out.resources = { subscribe: true }
	}
	if (sdkCaps?.tools) {
		out.tools = {}
	}
	return out
}

export function createTransportForConfig(config: McpTransportConfig): Transport {
	if (config.type === "http") {
		const headers = config.headers ? new Headers(config.headers) : undefined
		return new StreamableHTTPClientTransport(new URL(config.url), {
			requestInit: headers ? { headers } : undefined,
		})
	}
	return new StdioClientTransport({
		command: config.command,
		args: config.args,
		env: config.env,
		stderr: "pipe",
	})
}

/**
 * Connect using an existing MCP {@link Transport} (for example InMemoryTransport in tests).
 */
export async function mcpClientWithTransport(
	transport: Transport,
	options?: { serverId?: string },
): Promise<McpClientHandle> {
	const serverId =
		options?.serverId ??
		createHash("sha256").update("livectx:mcp:anonymous").digest("hex").slice(0, 32)

	const client = new Client({ name: "livectx-mcp", version: "0.0.0" }, {})

	const subsByUri = new Map<string, Set<() => void>>()
	const subscribedUris = new Set<string>()

	client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
		const uri = notification.params.uri
		const set = subsByUri.get(uri)
		if (!set) {
			return
		}
		for (const cb of set) {
			try {
				cb()
			} catch {
				//
			}
		}
	})

	await client.connect(transport)

	const capabilities = mapServerCapabilities(client.getServerCapabilities())

	async function ensureSubscribed(uri: string): Promise<void> {
		if (!capabilities.resources?.subscribe) {
			return
		}
		if (subscribedUris.has(uri)) {
			return
		}
		await client.subscribeResource({ uri })
		subscribedUris.add(uri)
	}

	async function maybeUnsubscribe(uri: string): Promise<void> {
		if (!subscribedUris.has(uri)) {
			return
		}
		await client.unsubscribeResource({ uri })
		subscribedUris.delete(uri)
	}

	const handle: McpClientHandle = {
		serverId,
		capabilities,

		async listResources(): Promise<McpResourceDescriptor[]> {
			const out: McpResourceDescriptor[] = []
			let cursor: string | undefined
			do {
				const page = await client.listResources(cursor ? { cursor } : undefined)
				for (const r of page.resources) {
					out.push({
						uri: r.uri,
						name: r.name,
						description: r.description,
						mimeType: r.mimeType,
					})
				}
				cursor = page.nextCursor
			} while (cursor)
			return out
		},

		async readResource(uri: string): Promise<McpResourceContent> {
			const res = await client.readResource({ uri })
			const first = res.contents[0]
			if (!first) {
				return { uri }
			}
			const baseUri = first.uri ?? uri
			if ("text" in first) {
				return { uri: baseUri, text: first.text, mimeType: first.mimeType }
			}
			return { uri: baseUri, blob: first.blob, mimeType: first.mimeType }
		},

		async listTools(): Promise<McpToolDescriptor[]> {
			const out: McpToolDescriptor[] = []
			let cursor: string | undefined
			do {
				const page = await client.listTools(cursor ? { cursor } : undefined)
				for (const t of page.tools) {
					out.push({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema as Record<string, unknown>,
					})
				}
				cursor = page.nextCursor
			} while (cursor)
			return out
		},

		async callTool(name: string, args: unknown): Promise<unknown> {
			const argsObj =
				args !== null && typeof args === "object" && !Array.isArray(args)
					? (args as Record<string, unknown>)
					: args === undefined
						? {}
						: { value: args }
			const result = await client.callTool({ name, arguments: argsObj })
			return result
		},

		subscribe(uri: string, onUpdate: () => void): () => void {
			if (!capabilities.resources?.subscribe) {
				return () => {}
			}

			let set = subsByUri.get(uri)
			if (!set) {
				set = new Set()
				subsByUri.set(uri, set)
			}
			set.add(onUpdate)

			void ensureSubscribed(uri).catch(() => {
				//
			})

			let unsubscribed = false
			return () => {
				if (unsubscribed) {
					return
				}
				unsubscribed = true
				const s = subsByUri.get(uri)
				if (!s) {
					return
				}
				s.delete(onUpdate)
				if (s.size === 0) {
					subsByUri.delete(uri)
					void maybeUnsubscribe(uri).catch(() => {
						//
					})
				}
			}
		},

		async dispose(): Promise<void> {
			subsByUri.clear()
			subscribedUris.clear()
			await client.close()
		},
	}

	return handle
}

export async function mcpClient(config: McpTransportConfig): Promise<McpClientHandle> {
	const transport = createTransportForConfig(config)
	const serverId = stableServerId(config)
	return mcpClientWithTransport(transport, { serverId })
}
