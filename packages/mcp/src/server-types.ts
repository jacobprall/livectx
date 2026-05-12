import type { AnyBinding, ContextClient, ToolBinding } from "@livectx/core"

export interface McpServerOpts {
	name: string
	version: string
	resources?: AnyBinding[]
	// Concrete ToolBinding<I,O> is not assignable to ToolBinding<unknown,unknown> under strictFunctionTypes.
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool list
	tools?: readonly ToolBinding<any, any>[]
}

export type McpServerTransportConfig =
	| { type: "http"; port: number; host?: string }
	| { type: "stdio" }

export interface McpServerHandle {
	listen(config: McpServerTransportConfig): Promise<void>
	close(): Promise<void>
	notifyResourceUpdated(uri: string): void
}
