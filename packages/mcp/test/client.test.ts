import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { mcpClientWithTransport } from "../src/client.js"

describe("mcpClient (in-memory transport)", () => {
	let mcp: McpServer | undefined

	afterEach(async () => {
		if (mcp) {
			await mcp.close()
			mcp = undefined
		}
	})

	it("connects and reports capabilities", async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		mcp = new McpServer(
			{ name: "test-server", version: "1.0.0" },
			{
				capabilities: {
					resources: { subscribe: true },
					tools: {},
				},
			},
		)
		await mcp.connect(serverSide)

		const handle = await mcpClientWithTransport(clientSide, { serverId: "mem-1" })
		expect(handle.serverId).toBe("mem-1")
		expect(handle.capabilities.resources?.subscribe).toBe(true)
		expect(handle.capabilities.tools).toEqual({})
		await handle.dispose()
	})

	it("lists resources, reads content, lists tools, calls tool", async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		mcp = new McpServer(
			{ name: "test-server", version: "1.0.0" },
			{
				capabilities: {
					resources: { subscribe: false },
					tools: {},
				},
			},
		)

		mcp.registerResource("readme", "file:///readme.md", { description: "README" }, async () => ({
			contents: [{ uri: "file:///readme.md", text: "# Hello", mimeType: "text/markdown" }],
		}))

		mcp.registerTool(
			"add",
			{
				description: "add numbers",
				inputSchema: { a: z.number(), b: z.number() },
			},
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		)

		await mcp.connect(serverSide)

		const handle = await mcpClientWithTransport(clientSide, { serverId: "mem-2" })

		const listed = await handle.listResources()
		expect(listed.some((r) => r.uri === "file:///readme.md" && r.name === "readme")).toBe(true)

		const content = await handle.readResource("file:///readme.md")
		expect(content.text).toBe("# Hello")

		const tls = await handle.listTools()
		const add = tls.find((t) => t.name === "add")
		expect(add?.name).toBe("add")

		const result = await handle.callTool("add", { a: 2, b: 3 })
		expect(result).toMatchObject({
			content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "5" })]),
		})

		await handle.dispose()
	})
})
