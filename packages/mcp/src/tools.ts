import type { BindingDef, ToolBinding, ToolBindingDef } from "@livectx/core"
import { jsonSchemaToSchema } from "./schema-adapter.js"
import type { McpClientHandle } from "./types.js"

const fallbackInputSchema = jsonSchemaToSchema({ type: "object" })

function normalizeCallToolResult(result: unknown): unknown {
	if (result !== null && typeof result === "object") {
		const r = result as Record<string, unknown>
		if ("structuredContent" in r && r.structuredContent !== undefined) {
			return r.structuredContent
		}
		if (Array.isArray(r.content)) {
			const texts = r.content
				.map((c) => {
					if (
						c !== null &&
						typeof c === "object" &&
						"type" in c &&
						c.type === "text" &&
						"text" in c
					) {
						return String((c as { text: unknown }).text)
					}
					return null
				})
				.filter((t): t is string => t !== null)
			if (texts.length > 0) {
				return texts.join("\n")
			}
		}
		if ("toolResult" in r) {
			return r.toolResult
		}
	}
	return result
}

export async function mcpTools(server: McpClientHandle): Promise<ToolBinding<unknown, unknown>[]> {
	const descriptors = await server.listTools()
	return descriptors.map((tool) => {
		const input = tool.inputSchema
			? jsonSchemaToSchema(tool.inputSchema as Record<string, unknown>)
			: fallbackInputSchema

		const toolDef: ToolBindingDef<unknown, unknown> = {
			key: ["mcp", server.serverId, "tool", tool.name],
			name: tool.name,
			description: tool.description ?? "",
			input,
			fetch: async (inputValue, _ctx) =>
				normalizeCallToolResult(await server.callTool(tool.name, inputValue)),
		}

		const bindingDef: BindingDef<unknown, Record<string, never>> = {
			key: toolDef.key,
			fetch: async () => undefined,
			placement: "tool",
		}

		return {
			__brand: "Binding",
			__def: bindingDef,
			__tool: toolDef,
		} as ToolBinding<unknown, unknown>
	})
}
