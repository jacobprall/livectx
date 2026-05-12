import type { BindingKey } from "@livectx/core"
import { createContextClient } from "@livectx/core"
import { source, tool } from "@livectx/core"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createMcpServerHandler } from "../src/server-handler.js"
import { exposeAsMcpServer } from "../src/server.js"
import { bindingKeyToUri } from "../src/uri.js"

describe("McpServerHandler", () => {
	it("exposeAsMcpServer creates a handle with expected methods", async () => {
		const ctx = createContextClient()
		const h = exposeAsMcpServer(ctx, { name: "x", version: "1", resources: [] })
		expect(typeof h.listen).toBe("function")
		expect(typeof h.close).toBe("function")
		expect(typeof h.notifyResourceUpdated).toBe("function")
		await ctx.dispose()
	})

	it("resources/list and resources/read return binding values after prefetch", async () => {
		const ctx = createContextClient()
		const greet = source({
			key: ["svc", "greet"],
			staleTime: 0,
			fetch: async () => ({ message: "hi" }),
		})
		const uri = bindingKeyToUri(greet.__def.key as BindingKey)

		const handler = createMcpServerHandler(ctx, {
			name: "srv",
			version: "9",
			resources: [greet],
		})
		await handler.prefetchBindings()

		const listed = (await handler.handleRequest("resources/list")) as {
			resources: unknown[]
		}
		expect(Array.isArray(listed.resources)).toBe(true)

		const read = (await handler.handleRequest("resources/read", { uri })) as {
			contents: Array<{ text: string }>
		}
		const first = read.contents[0]
		expect(first?.text).toContain('"message":"hi"')

		handler.dispose()
		await ctx.dispose()
	})

	it("tools/list describes tools and tools/call invokes fetch", async () => {
		const ctx = createContextClient()
		const multiply = tool({
			key: ["tools", "mul"],
			name: "multiply",
			description: "multiply two ints",
			input: z.object({ a: z.number(), b: z.number() }),
			fetch: async ({ a, b }) => a * b,
		})

		const handler = createMcpServerHandler(ctx, {
			name: "srv",
			version: "9",
			tools: [multiply],
		})

		const list = (await handler.handleRequest("tools/list")) as {
			tools: Array<{ name: string }>
		}
		expect(list.tools.some((t) => t.name === "multiply")).toBe(true)

		const ran = await handler.handleRequest("tools/call", {
			name: "multiply",
			arguments: { a: 3, b: 4 },
		})
		expect(ran).toBe(12)

		handler.dispose()
		await ctx.dispose()
	})
})
