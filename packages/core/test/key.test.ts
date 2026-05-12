import { describe, expect, it } from "vitest"
import { isKeyMatcher, keysEqual, matchKey, serializeKey } from "../src/key.js"
import type { BindingKey, KeyMatcher } from "../src/types.js"

describe("serializeKey", () => {
	it("round-trips structural intent for nested objects", () => {
		const key: BindingKey = [
			"svc",
			{
				z: 1,
				a: { nested: true, b: null },
			},
		]
		expect(serializeKey(key)).toBe(`["svc",{"a":{"b":null,"nested":true},"z":1}]`)
	})

	it("sorts object keys alphabetically at each nesting level", () => {
		const a: BindingKey = [{ z: 1, a: 2 }]
		const b: BindingKey = [{ a: 2, z: 1 }]
		expect(serializeKey(a)).toBe(serializeKey(b))
	})

	it("handles primitives including null", () => {
		const key: BindingKey = ["x", null, true, false, 0, -2]
		expect(serializeKey(key)).toBe(`["x",null,true,false,0,-2]`)
	})

	it("serializes an empty binding key", () => {
		expect(serializeKey([])).toBe("[]")
	})
})

describe("keysEqual", () => {
	it("returns true for deeply equivalent keys", () => {
		expect(keysEqual(["a", { x: 1 }], ["a", { x: 1 }])).toBe(true)
	})

	it("returns false when atoms differ", () => {
		expect(keysEqual(["a"], ["b"])).toBe(false)
	})

	it("returns false when object key ordering differs structurally but sorts equal", () => {
		expect(keysEqual([{ b: 2, a: 1 }], [{ a: 1, b: 2 }])).toBe(true)
	})
})

describe("matchKey", () => {
	it("matches exact keys", () => {
		expect(matchKey(["services", "p_42"], { exact: ["services", "p_42"] })).toBe(true)
		expect(matchKey(["services"], { exact: ["alerts"] })).toBe(false)
	})

	it("matches prefix segments", () => {
		expect(matchKey(["services", "p_42"], { prefix: ["services"] })).toBe(true)
		expect(matchKey(["alerts"], { prefix: ["services"] })).toBe(false)
	})

	it("returns false when key is shorter than prefix", () => {
		expect(matchKey(["svc"], { prefix: ["svc", "nested"] })).toBe(false)
	})

	it("treats empty prefix as matching every key including empty", () => {
		expect(matchKey([], { prefix: [] })).toBe(true)
		expect(matchKey(["anything"], { prefix: [] })).toBe(true)
	})

	it("uses structural equality for prefix atoms", () => {
		expect(matchKey([{ b: 1, a: 2 }, "tail"], { prefix: [{ a: 2, b: 1 }] })).toBe(true)
	})

	it("invokes predicate matchers", () => {
		expect(matchKey(["a"], { predicate: (k) => k.length === 1 })).toBe(true)
		expect(matchKey(["a", "b"], { predicate: (k) => k.length === 1 })).toBe(false)
	})

	it("propagates errors from predicate matchers", () => {
		expect(() =>
			matchKey([], {
				predicate: () => {
					throw new Error("boom")
				},
			}),
		).toThrow("boom")
	})
})

describe("isKeyMatcher", () => {
	it("narrows exact matchers", () => {
		const v: unknown = { exact: ["x"] }
		expect(isKeyMatcher(v)).toBe(true)
		if (isKeyMatcher(v)) {
			expect("exact" in v).toBe(true)
		}
	})

	it("narrows prefix matchers", () => {
		const v: unknown = { prefix: [] as const }
		expect(isKeyMatcher(v)).toBe(true)
	})

	it("narrows predicate matchers", () => {
		const v: unknown = { predicate: () => true }
		expect(isKeyMatcher(v)).toBe(true)
	})

	it("rejects non-objects", () => {
		expect(isKeyMatcher(null)).toBe(false)
		expect(isKeyMatcher(undefined)).toBe(false)
		expect(isKeyMatcher("exact")).toBe(false)
	})

	it("rejects plain objects without matcher keys", () => {
		expect(isKeyMatcher({ foo: 1 })).toBe(false)
	})

	it("treats malformed exact as non-matcher when not an array", () => {
		expect(isKeyMatcher({ exact: "nope" })).toBe(false)
	})

	it("prefers exact when multiple properties exist (structural heuristic)", () => {
		const hybrid: unknown = {
			exact: ["a"],
			predicate: () => false,
		}
		expect(isKeyMatcher(hybrid)).toBe(true)
		if (isKeyMatcher(hybrid)) {
			const m = hybrid as KeyMatcher
			expect(matchKey(["a"], m)).toBe(true)
		}
	})
})
