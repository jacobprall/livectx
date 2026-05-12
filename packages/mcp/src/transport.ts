export type McpTransportConfig =
	| { type: "http"; url: string; headers?: Record<string, string> }
	| { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
