import { describe, expect, it, vi } from "vitest"
import { mcpResource } from "../src/resource.js"
import { createMockMcpClient } from "./mock-server.js"

describe("mcpResource", () => {
	it("creates binding with correct key and fetch uses readResource", async () => {
		const server = createMockMcpClient({
			serverId: "srv1",
			resourceContents: { "file:///a": "body" },
		})
		const b = mcpResource(server, { uri: "file:///a" })
		expect(b.__def.key).toEqual(["mcp", "srv1", "file:///a"])
		await expect(
			b.__def.fetch({}, { signal: new AbortController().signal, client: null as never }),
		).resolves.toBe("body")
	})

	it("routes subscribe when server supports subscriptions", async () => {
		const server = createMockMcpClient({
			capabilities: { resources: { subscribe: true } },
			resourceContents: { "file:///x": "x" },
		})
		const b = mcpResource(server, { uri: "file:///x" })
		expect(b.__def.subscribe).toBeDefined()
		const onInv = vi.fn()
		const unsub = b.__def.subscribe?.(onInv)
		expect(unsub).toBeTypeOf("function")
		server.emitResourceUpdate("file:///x")
		expect(onInv).toHaveBeenCalledOnce()
		unsub?.()
	})

	it("omits subscribe when not supported", () => {
		const server = createMockMcpClient({
			capabilities: {},
			resourceContents: {},
		})
		const b = mcpResource(server, { uri: "file:///y" })
		expect(b.__def.subscribe).toBeUndefined()
	})
})
