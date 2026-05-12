import { describe, expect, it } from "vitest"
import { source } from "../src/binding.js"
import { CircularDependencyError } from "../src/errors.js"
import { detectCycles, topologicalSort } from "../src/resolver.js"
import type { AnyBinding, BindingKey } from "../src/types.js"

/** Mutable graph nodes for resolver edge cases (bindings from {@link source} freeze defs). */
function raw(key: BindingKey, deps: Record<string, AnyBinding> = {}): AnyBinding {
	return {
		__brand: "Binding",
		__def: {
			key: [...key],
			fetch: async () => 0,
			placement: "dynamic",
			staleTime: 0,
			gcTime: "5m",
			dependsOn: deps,
		},
	} as unknown as AnyBinding
}

describe("resolver", () => {
	const a = source({ key: ["a"], fetch: async () => 1 })
	const b = source({ key: ["b"], fetch: async () => 2, dependsOn: { a } })
	const c = source({ key: ["c"], fetch: async () => 3 })

	it("detectCycles returns a path when a mutual dependency exists", () => {
		const xa = raw(["xa-cycle"], {})
		const xb = raw(["xb-cycle"], { a: xa })
		;(xa.__def as { dependsOn?: Record<string, AnyBinding> }).dependsOn = { buddy: xb }
		const cycle = detectCycles([xa])
		expect(cycle && cycle.length >= 2).toBeTruthy()
	})

	it("detectCycles yields null when acyclic", () => {
		expect(detectCycles([c, b, a])).toBeNull()
	})

	it("topologicalSort layers independent roots together", () => {
		const waves = topologicalSort([c, b, a])
		const flat0 = (waves[0] ?? []).map((bb) => bb.__def.key[0])
		expect(flat0).toContain("a")
		expect(flat0).toContain("c")
		expect((waves[1] ?? []).map((bb) => bb.__def.key[0])).toContain("b")
	})

	it("preserves deterministic diamond layering", () => {
		const root = source({ key: ["r"], fetch: async () => 0 })
		const left = source({ key: ["L"], fetch: async () => 1, dependsOn: { root } })
		const right = source({ key: ["R"], fetch: async () => 2, dependsOn: { root } })
		const tip = source({ key: ["T"], fetch: async () => 3, dependsOn: { left, right } })

		const w = topologicalSort([tip])

		expect(w.flat().filter((bb) => bb.__def.key[0] === "T")).toHaveLength(1)
		expect(w[w.length - 1]?.some((bb) => bb.__def.key[0] === "T")).toBeTruthy()
	})

	it("throws CircularDependencyError for mutual deps", () => {
		const xa = raw(["x2-cycle"], {})
		const xb = raw(["y2-cycle"], { up: xa })
		;(xa.__def as { dependsOn?: Record<string, AnyBinding> }).dependsOn = { down: xb }

		expect(() => topologicalSort([xa])).toThrow(CircularDependencyError)
	})

	it("sorts chains by depth increasing", () => {
		const n1 = source({ key: ["n1"], fetch: async () => 1 })
		const n2 = source({ key: ["n2"], fetch: async () => 2, dependsOn: { n1 } })
		const n3 = source({ key: ["n3"], fetch: async () => 3, dependsOn: { n2 } })

		const w = topologicalSort([n3])
		expect(w).toHaveLength(3)
		expect(w.map((lane) => lane[0]?.__def.key[0])).toEqual(["n1", "n2", "n3"])
	})
})
