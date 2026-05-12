import { describe, expect, it } from "vitest"
import { createMemoryStore } from "../src/cache.js"

describe("createMemoryStore", () => {
	it("supports get/set/delete/clear lifecycle", async () => {
		const store = createMemoryStore()
		const now = Date.now()
		await store.set("a", {
			value: "x",
			fetchedAt: now,
			expiresAt: now + 60_000,
			state: "fresh",
		})
		expect((await store.get<string>("a"))?.value).toBe("x")
		await store.delete("a")
		expect(await store.get<string>("a")).toBeUndefined()
		await store.set("a", {
			value: 1,
			fetchedAt: now,
			expiresAt: now + 60_000,
			state: "fresh",
		} as import("../src/types.js").CacheEntry<number>)
		await store.clear()
		expect(await store.get("a")).toBeUndefined()
	})

	it("yields keys() after pruning expired rows", async () => {
		const store = createMemoryStore()
		const now = Date.now()
		await store.set("fresh", {
			value: 1,
			fetchedAt: now,
			expiresAt: now + 60_000,
			state: "fresh",
		})
		await store.set("gone", {
			value: 2,
			fetchedAt: now - 120_000,
			expiresAt: now - 1,
			state: "stale",
		})
		expect(await store.get("gone")).toBeUndefined()
		const ks: string[] = []
		for await (const k of store.keys()) {
			ks.push(k)
		}
		expect(ks.sort()).toEqual(["fresh"])
	})

	it("prunes lazily on get", async () => {
		const store = createMemoryStore()
		const now = Date.now()
		await store.set("x", {
			value: null,
			fetchedAt: now,
			expiresAt: now - 1,
			state: "stale",
		})
		expect(await store.get("x")).toBeUndefined()
	})
})
