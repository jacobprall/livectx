import { describe, expect, expectTypeOf, it } from "vitest"
import { source } from "../src/binding.js"
import type { Binding, BindingDef, ContextClient, FetchContext } from "../src/types.js"

function mockFetchContext(): FetchContext {
	return {
		signal: new AbortController().signal,
		client: {} as ContextClient,
	}
}

describe("source", () => {
	it("constructs a binding from minimal definition", () => {
		const b = source({
			key: ["one"],
			fetch: async () => 42,
		})
		expect(b.__brand).toBe("Binding")
		expect(b.__def.key).toEqual(["one"])
		expect(typeof b.__def.fetch).toBe("function")
	})

	it("applies placement, staleTime, and gcTime defaults", () => {
		const b = source({
			key: ["x"],
			fetch: () => "ok",
		})
		expect(b.__def.placement).toBe("dynamic")
		expect(b.__def.staleTime).toBe(0)
		expect(b.__def.gcTime).toBe("5m")
	})

	it("preserves explicit placement and timings", () => {
		const def: BindingDef<string> = {
			key: ["custom"],
			fetch: async () => "v",
			placement: "static",
			staleTime: "10s",
			gcTime: "1h",
			description: "d",
			fallback: "fb",
		}
		const b = source(def)
		expect(b.__def.placement).toBe("static")
		expect(b.__def.staleTime).toBe("10s")
		expect(b.__def.gcTime).toBe("1h")
		expect(b.__def.description).toBe("d")
		expect(b.__def.fallback).toBe("fb")
	})

	it("freezes binding definitions including key tuples", () => {
		const b = source({
			key: ["frozen"],
			fetch: () => null,
		})
		expect(Object.isFrozen(b.__def)).toBe(true)
		expect(Object.isFrozen(b.__def.key)).toBe(true)
	})

	it("throws when key array is empty", () => {
		expect(() =>
			source({
				key: [],
				fetch: () => 1,
			}),
		).toThrow(TypeError)
	})

	it("throws when fetch is not a function", () => {
		expect(() =>
			source({
				key: ["bad"],
				fetch: "nope" as unknown as BindingDef<number>["fetch"],
			}),
		).toThrow(TypeError)
	})

	it("infers value type from synchronous fetch return", () => {
		const b = source({
			key: ["user"],
			fetch: () => ({ id: 1 }),
		})
		expectTypeOf(b).toMatchTypeOf<Binding<{ id: number }>>()
		expect(b.__def.fetch({}, mockFetchContext())).toEqual({ id: 1 })
	})

	it("supports dependency typing via BindingDef generics", async () => {
		const dep = source({
			key: ["dep"],
			fetch: () => 10,
		})
		const parent = source({
			key: ["parent"],
			dependsOn: { dep },
			fetch: ({ dep: n }) => n + 1,
		})
		expect(await Promise.resolve(parent.__def.fetch({ dep: 10 }, mockFetchContext()))).toBe(11)
	})

	it("freezes dependsOn maps when provided", () => {
		const dep = source({ key: ["d"], fetch: () => 0 })
		const b = source({
			key: ["p"],
			dependsOn: { dep },
			fetch: ({ dep: _ }) => _,
		})
		expect(Object.isFrozen(b.__def.dependsOn)).toBe(true)
	})
})
