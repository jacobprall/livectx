import type {
	AssembleMetrics,
	AssembledSegments,
	JsonSchema,
	ResolvedTool,
	SinkAdapter,
} from "@livectx/core"

export interface AnthropicSinkOutput {
	system: Array<{
		type: "text"
		text: string
		cache_control?: { type: "ephemeral" }
	}>
	messages: Array<{
		role: "user" | "assistant"
		content: Array<{ type: "text"; text: string }>
	}>
	tools: Array<{
		name: string
		description: string
		input_schema: JsonSchema
	}>
	metrics: AssembleMetrics
}

export function anthropicSink(): SinkAdapter<AnthropicSinkOutput> {
	return {
		name: "anthropic",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]): AnthropicSinkOutput {
			const system: AnthropicSinkOutput["system"] = []

			for (let i = 0; i < segments.staticBlocks.length; i++) {
				const block = segments.staticBlocks[i]
				if (!block || !block.text) continue
				const isLast = i === segments.staticBlocks.length - 1
				system.push({
					type: "text",
					text: block.text,
					...(isLast ? { cache_control: { type: "ephemeral" } } : {}),
				})
			}

			const messages: AnthropicSinkOutput["messages"] = []
			const dynamicText = segments.dynamicBlocks.map((b) => b.text).join("\n")
			if (dynamicText.trim()) {
				messages.push({
					role: "user",
					content: [{ type: "text", text: dynamicText }],
				})
			}

			const formattedTools: AnthropicSinkOutput["tools"] = tools.map((t) => ({
				name: t.name,
				description: t.description,
				input_schema: t.inputSchema,
			}))

			return {
				system,
				messages,
				tools: formattedTools,
				metrics: segments.metrics,
			}
		},
	}
}
