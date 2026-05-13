import type { BindingKey } from "@livectx/core"
import { createContextClient, ToolDeniedError } from "@livectx/core"
import { source, tool } from "@livectx/core"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createMcpServerHandler } from "../src/server-handler.js"
import { LivectxMcpRuntime } from "../src/server-runtime.js"
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

describe("MCP PermissionHook enforcement", () => {
	it("LivectxMcpRuntime.executeTool respects PermissionHook onToolCall", async () => {
		const onToolCall = vi.fn().mockReturnValue(false)
		const ctx = createContextClient({
			permissions: { onToolCall, onDeny: "return-error" },
		})

		const multiply = tool({
			key: ["tools", "perm_mul"],
			name: "perm_multiply",
			description: "multiply",
			input: z.object({ a: z.number(), b: z.number() }),
			fetch: async ({ a, b }) => a * b,
		})

		const runtime = new LivectxMcpRuntime(ctx, {
			name: "perm-test",
			version: "1",
			tools: [multiply],
		})

		const result = await runtime.executeTool("perm_multiply", { a: 3, b: 4 })
		expect(result).toEqual({ error: 'Tool "perm_multiply" was denied by permissions hook.' })
		expect(onToolCall).toHaveBeenCalledTimes(1)

		runtime.dispose()
		await ctx.dispose()
	})

	it("LivectxMcpRuntime.executeTool throws ToolDeniedError when onDeny is throw", async () => {
		const ctx = createContextClient({
			permissions: { onToolCall: () => false, onDeny: "throw" },
		})

		const echo = tool({
			key: ["tools", "perm_echo"],
			name: "perm_echo",
			description: "echo",
			input: z.object({ msg: z.string() }),
			fetch: async ({ msg }) => msg,
		})

		const runtime = new LivectxMcpRuntime(ctx, {
			name: "perm-throw",
			version: "1",
			tools: [echo],
		})

		await expect(runtime.executeTool("perm_echo", { msg: "hi" })).rejects.toBeInstanceOf(
			ToolDeniedError,
		)

		runtime.dispose()
		await ctx.dispose()
	})

	it("MCP handler tools/call path respects permissions", async () => {
		const onToolCall = vi.fn().mockReturnValue(false)
		const ctx = createContextClient({
			permissions: { onToolCall, onDeny: "return-error" },
		})

		const multiply = tool({
			key: ["tools", "handler_mul"],
			name: "handler_multiply",
			description: "multiply",
			input: z.object({ a: z.number(), b: z.number() }),
			fetch: async ({ a, b }) => a * b,
		})

		const handler = createMcpServerHandler(ctx, {
			name: "perm-handler",
			version: "1",
			tools: [multiply],
		})

		const result = await handler.handleRequest("tools/call", {
			name: "handler_multiply",
			arguments: { a: 5, b: 6 },
		})

		expect(result).toEqual({ error: 'Tool "handler_multiply" was denied by permissions hook.' })
		expect(onToolCall).toHaveBeenCalledTimes(1)

		handler.dispose()
		await ctx.dispose()
	})

	it("MCP tools are allowed when PermissionHook returns true", async () => {
		const onToolCall = vi.fn().mockReturnValue(true)
		const ctx = createContextClient({
			permissions: { onToolCall },
		})

		const multiply = tool({
			key: ["tools", "allowed_mul"],
			name: "allowed_multiply",
			description: "multiply",
			input: z.object({ a: z.number(), b: z.number() }),
			fetch: async ({ a, b }) => a * b,
		})

		const runtime = new LivectxMcpRuntime(ctx, {
			name: "perm-allow",
			version: "1",
			tools: [multiply],
		})

		const result = await runtime.executeTool("allowed_multiply", { a: 7, b: 8 })
		expect(result).toBe(56)
		expect(onToolCall).toHaveBeenCalledTimes(1)

		runtime.dispose()
		await ctx.dispose()
	})
})
