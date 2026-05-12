import type { Duration, Placement, Unsubscribe } from "@livectx/core"

export type { McpTransportConfig } from "./transport.js"

export interface McpClientHandle {
	readonly serverId: string
	readonly capabilities: ServerCapabilities
	listResources(): Promise<McpResourceDescriptor[]>
	readResource(uri: string): Promise<McpResourceContent>
	listTools(): Promise<McpToolDescriptor[]>
	callTool(name: string, args: unknown): Promise<unknown>
	subscribe(uri: string, onUpdate: () => void): Unsubscribe
	dispose(): Promise<void>
}

export interface ServerCapabilities {
	resources?: { subscribe?: boolean }
	/** Present when the server advertises a tools capability (shape intentionally loose). */
	tools?: Record<string, never>
}

export interface McpResourceDescriptor {
	uri: string
	name: string
	description?: string
	mimeType?: string
}

export interface McpResourceContent {
	uri: string
	text?: string
	blob?: string
	mimeType?: string
}

export interface McpToolDescriptor {
	name: string
	description?: string
	inputSchema?: Record<string, unknown>
}

export interface McpResourceOpts {
	uri: string
	placement?: Placement
	staleTime?: Duration
	gcTime?: Duration
	render?: (value: string) => string
}
