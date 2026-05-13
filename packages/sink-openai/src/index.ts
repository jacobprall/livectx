import type {
	AssembleMetrics,
	AssembledSegments,
	JsonSchema,
	ResolvedTool,
	SinkAdapter,
} from "@livectx/core"
import { segmentsToText } from "@livectx/core"

export interface OpenAISinkOutput {
	messages: Array<{
		role: "system" | "user" | "assistant"
		content: string
	}>
	tools: Array<{
		type: "function"
		function: {
			name: string
			description: string
			parameters: JsonSchema
		}
	}>
	metrics: AssembleMetrics
}

export function openaiSink(): SinkAdapter<OpenAISinkOutput> {
	return {
		name: "openai",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]): OpenAISinkOutput {
			const messages: OpenAISinkOutput["messages"] = []

			const { staticText, dynamicText } = segmentsToText(segments)
			if (staticText.trim()) {
				messages.push({ role: "system", content: staticText })
			}
			if (dynamicText.trim()) {
				messages.push({ role: "user", content: dynamicText })
			}

			if (messages.length === 0) {
				messages.push({ role: "system", content: "" })
			}

			const formattedTools: OpenAISinkOutput["tools"] = tools.map((t) => ({
				type: "function" as const,
				function: {
					name: t.name,
					description: t.description,
					parameters: t.inputSchema,
				},
			}))

			return { messages, tools: formattedTools, metrics: segments.metrics }
		},
	}
}
