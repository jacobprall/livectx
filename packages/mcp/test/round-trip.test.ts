import type { BindingKey } from "@livectx/core"
import { createContextClient, source, tool } from "@livectx/core"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { mcpClientWithTransport } from "../src/client.js"
import { LivectxMcpRuntime } from "../src/server-runtime.js"
import { createConfiguredMcpServer } from "../src/server-sdk-register.js"
import { bindingKeyToUri } from "../src/uri.js"

describe("MCP expose round-trip via SDK (in-memory transport)", () => {
	it("binds prefetch reads, notifies subscribers, executes tools across transport", async () => {
		const client = createContextClient()

		let invalidate: (() => void) | undefined
		let version = "v1"
		const doc = source({
			key: ["doc", "rt"],
			staleTime: 0,
			fetch: async () => ({ txt: version }),
			subscribe: (onInv) => {
				invalidate = onInv
				return () => {
					invalidate = undefined
				}
			},
		})

		const multiply = tool({
			key: ["tools", "rt_mul"],
			name: "multiply",
			description: "x*y",
			input: z.object({ a: z.number(), b: z.number() }),
			fetch: async ({ a, b }) => ({ product: a * b }),
		})

		const runtime = new LivectxMcpRuntime(client, {
			name: "bridge",
			version: "42",
			resources: [doc],
			tools: [multiply],
		})

		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

		const mcp = createConfiguredMcpServer(runtime)

		await mcp.connect(serverSide)

		const unsubForward = runtime.onBindingInvalidated((uri) => {
			void mcp.server.sendResourceUpdated({ uri })
		})

		const handle = await mcpClientWithTransport(clientSide, {
			serverId: "livectx-bridge-tests",
		})

		await runtime.prefetchExposed()

		const uri = bindingKeyToUri(doc.__def.key as BindingKey)
		expect(handle.capabilities.resources?.subscribe).toBe(true)

		const bumped: number[] = []
		handle.subscribe(uri, () => bumped.push(1))

		const afterRead = await handle.readResource(uri)
		expect(JSON.parse(afterRead.text ?? "null").txt).toBe("v1")

		version = "v2"
		invalidate?.()
		for (let step = 0; step < 50 && bumped.length === 0; step++) {
			await new Promise((r) => setTimeout(r, 10))
		}
		expect(bumped.length).toBeGreaterThan(0)

		const bumpedAfter = await handle.readResource(uri)
		expect(JSON.parse(bumpedAfter.text ?? "null").txt).toBe("v2")

		const toolOutcome = await handle.callTool("multiply", { a: 11, b: 2 })
		const textPieces = extractTextSnippet(toolOutcome)
		expect(JSON.parse(textPieces).product).toBe(22)

		unsubForward()
		await handle.dispose()
		await mcp.close()

		runtime.dispose()
		await client.dispose()
	})
})

function extractTextSnippet(result: unknown): string {
	if (result !== null && typeof result === "object") {
		const r = result as { content?: Array<{ text?: unknown }>; structuredContent?: unknown }
		if (Array.isArray(r.content)) {
			const merged = r.content
				.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
				.join("")
			if (merged) {
				return merged
			}
		}
		if ("structuredContent" in r && r.structuredContent !== undefined) {
			return JSON.stringify(r.structuredContent)
		}
	}
	return JSON.stringify(result ?? null)
}
