import type {
	McpClientHandle,
	McpResourceContent,
	McpResourceDescriptor,
	McpToolDescriptor,
	ServerCapabilities,
} from "../src/types.js"

export interface MockMcpClientHandle extends McpClientHandle {
	/** Fire resource update listeners for a URI (tests only). */
	emitResourceUpdate(uri: string): void
}

export function createMockMcpClient(opts: {
	resources?: McpResourceDescriptor[]
	resourceContents?: Record<string, string>
	tools?: McpToolDescriptor[]
	toolResults?: Record<string, unknown>
	capabilities?: ServerCapabilities
	serverId?: string
}): MockMcpClientHandle {
	const resources = opts.resources ?? []
	const resourceContents = opts.resourceContents ?? {}
	const tools = opts.tools ?? []
	const toolResults = opts.toolResults ?? {}
	const capabilities: ServerCapabilities = opts.capabilities ?? {}

	const subs = new Map<string, Set<() => void>>()

	const handle: MockMcpClientHandle = {
		serverId: opts.serverId ?? "mock-server",
		capabilities,

		async listResources(): Promise<McpResourceDescriptor[]> {
			return resources.map((r) => ({ ...r }))
		},

		async readResource(uri: string): Promise<McpResourceContent> {
			const text = resourceContents[uri]
			if (text === undefined) {
				return { uri, text: "" }
			}
			return { uri, text, mimeType: "text/plain" }
		},

		async listTools(): Promise<McpToolDescriptor[]> {
			return tools.map((t) => ({ ...t }))
		},

		async callTool(name: string, args: unknown): Promise<unknown> {
			if (Object.prototype.hasOwnProperty.call(toolResults, name)) {
				return toolResults[name]
			}
			return { echo: name, args }
		},

		subscribe(uri: string, onUpdate: () => void): () => void {
			if (!capabilities.resources?.subscribe) {
				return () => {}
			}
			let set = subs.get(uri)
			if (!set) {
				set = new Set()
				subs.set(uri, set)
			}
			set.add(onUpdate)
			return () => {
				const s = subs.get(uri)
				if (!s) {
					return
				}
				s.delete(onUpdate)
				if (s.size === 0) {
					subs.delete(uri)
				}
			}
		},

		async dispose(): Promise<void> {
			subs.clear()
		},

		emitResourceUpdate(uri: string): void {
			const set = subs.get(uri)
			if (!set) {
				return
			}
			for (const cb of set) {
				cb()
			}
		},
	}

	return handle
}
