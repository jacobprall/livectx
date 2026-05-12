import type { BindingKey } from "@livectx/core"
import { createContextClient } from "@livectx/core"
import { source } from "@livectx/core"
import { describe, expect, it } from "vitest"
import { createMcpServerHandler } from "../src/server-handler.js"
import { bindingKeyToUri } from "../src/uri.js"

describe("MCP resource notifications", () => {
	it("invalidate emits notifications only for subscribed MCP sessions", async () => {
		const ctx = createContextClient()

		let trigger: (() => void) | undefined
		const hello = source({
			key: ["note", "a"],
			staleTime: 0,
			fetch: async () => "one",
			subscribe: (onInv) => {
				trigger = onInv
				return () => {
					trigger = undefined
				}
			},
		})

		const uri = bindingKeyToUri(hello.__def.key as BindingKey)

		const handler = createMcpServerHandler(ctx, {
			name: "srv",
			version: "1",
			resources: [hello],
		})

		await handler.prefetchBindings()

		const unsubRoom: Array<{ method: string; params: unknown }> = []
		const quiet = handler.createSession((method, params) => {
			unsubRoom.push({ method, params })
		})

		const activeRoom: Array<{ method: string; params: unknown }> = []
		const active = handler.createSession((method, params) => {
			activeRoom.push({ method, params })
		})

		await handler.handleRequest("resources/subscribe", { uri }, active.id)
		trigger?.()

		expect(activeRoom).toHaveLength(1)
		expect(activeRoom[0]?.method).toBe("notifications/resources/updated")
		expect(activeRoom[0]?.params).toEqual({ uri })
		expect(unsubRoom).toEqual([])

		quiet.dispose()
		active.dispose()
		handler.dispose()
		await ctx.dispose()
	})

	it("unsubscribe stops MCP notifications until re-subscribed", async () => {
		const ctx = createContextClient()
		let trigger: (() => void) | undefined
		const b = source({
			key: ["n", "b"],
			staleTime: 0,
			fetch: async () => 1,
			subscribe: (onInv) => {
				trigger = onInv
				return () => {
					trigger = undefined
				}
			},
		})

		const uri = bindingKeyToUri(b.__def.key as BindingKey)

		const handler = createMcpServerHandler(ctx, { name: "s", version: "v", resources: [b] })
		await handler.prefetchBindings()

		const msgs: unknown[] = []
		const sess = handler.createSession((_m, p) => msgs.push(p))

		await handler.handleRequest("resources/subscribe", { uri }, sess.id)
		trigger?.()
		await handler.handleRequest("resources/unsubscribe", { uri }, sess.id)

		trigger?.()

		expect(msgs.filter((p) => p && typeof p === "object")).toHaveLength(1)

		await handler.handleRequest("resources/subscribe", { uri }, sess.id)
		trigger?.()
		expect(msgs.length).toBe(2)

		sess.dispose()
		handler.dispose()
		await ctx.dispose()
	})
})
