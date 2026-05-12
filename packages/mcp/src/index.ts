export type {
	McpClientHandle,
	McpResourceContent,
	McpResourceDescriptor,
	McpResourceOpts,
	McpToolDescriptor,
	McpTransportConfig,
	ServerCapabilities,
} from "./types.js"

export { mcpClient, mcpClientWithTransport, createTransportForConfig } from "./client.js"
export { mcpResource } from "./resource.js"
export { mcpResources } from "./resources.js"
export { mcpTools } from "./tools.js"
export { jsonSchemaToSchema } from "./schema-adapter.js"

export { bindingKeyToUri, uriToBindingKey } from "./uri.js"

export type {
	McpServerHandle,
	McpServerOpts,
	McpServerTransportConfig,
} from "./server-types.js"
export type { NotifyFn } from "./server-notifications.js"

export { exposeAsMcpServer, LivectxMcpRuntime } from "./server.js"

export type { McpSessionId } from "./server-handler.js"
export { createMcpServerHandler, McpServerHandler } from "./server-handler.js"

export {
	createConfiguredMcpServer,
	registerLivectxBindingsOnSdkServer,
} from "./server-sdk-register.js"
