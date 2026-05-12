import type {
	AssembleMetrics,
	AssembledSegments,
	JsonSchema,
	ResolvedTool,
	SinkAdapter,
} from "@livectx/core"

export interface VercelAIToolDefinition {
	description: string
	parameters: JsonSchema
}

export interface VercelAIMessage {
	role: "user" | "assistant" | "system"
	content: string
}

export interface VercelAISinkOutput {
	system: string
	messages: VercelAIMessage[]
	tools: Record<string, VercelAIToolDefinition>
	metrics: AssembleMetrics
}

export function vercelAISink(): SinkAdapter<VercelAISinkOutput> {
	return {
		name: "vercel-ai",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]): VercelAISinkOutput {
			const staticText = segments.staticBlocks.map((b) => b.text).join("\n")
			const dynamicText = segments.dynamicBlocks.map((b) => b.text).join("\n")

			const system = staticText.trim()

			const messages: VercelAIMessage[] = []
			if (dynamicText.trim()) {
				messages.push({ role: "user", content: dynamicText })
			}

			const toolsRecord: Record<string, VercelAIToolDefinition> = {}
			for (const t of tools) {
				toolsRecord[t.name] = {
					description: t.description,
					parameters: t.inputSchema,
				}
			}

			return { system, messages, tools: toolsRecord, metrics: segments.metrics }
		},
	}
}
