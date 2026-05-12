import { describe, expect, it } from "vitest"
import { mcpTools } from "../src/tools.js"
import { createMockMcpClient } from "./mock-server.js"

describe("mcpTools", () => {
	it("creates ToolBindings that call through to the server", async () => {
		const server = createMockMcpClient({
			serverId: "t1",
			tools: [
				{
					name: "echo",
					description: "echo tool",
					inputSchema: { type: "object", properties: { msg: { type: "string" } } },
				},
			],
			toolResults: { echo: { ok: true } },
		})
		const tools = await mcpTools(server)
		expect(tools).toHaveLength(1)
		const t0 = tools[0]
		expect(t0.__tool.key).toEqual(["mcp", "t1", "tool", "echo"])
		expect(t0.__tool.name).toBe("echo")
		const out = await t0.__tool.fetch(
			{ msg: "hi" },
			{ signal: new AbortController().signal, client: null as never },
		)
		expect(out).toEqual({ ok: true })
	})

	it("preserves input schema via toJsonSchema", async () => {
		const schema = {
			type: "object",
			properties: { n: { type: "number" } },
			required: ["n"],
		} as const
		const server = createMockMcpClient({
			tools: [{ name: "num", inputSchema: schema }],
			toolResults: { num: 1 },
		})
		const [tb] = await mcpTools(server)
		const js = tb.__tool.input.toJsonSchema?.()
		expect(js).toEqual(schema)
	})
})
