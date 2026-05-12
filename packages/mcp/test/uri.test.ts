import { describe, expect, it } from "vitest"
import { bindingKeyToUri, uriToBindingKey } from "../src/uri.js"

describe("binding URIs", () => {
	it("bindingKeyToUri converts simple string keys", () => {
		const uri = bindingKeyToUri(["project", "p_42"])
		expect(uri).toBe("livectx://project/p_42")
	})

	it("uriToBindingKey parses URIs back to atoms", () => {
		expect(uriToBindingKey("livectx://project/p_42")).toEqual(["project", "p_42"])
	})

	it("throws on invalid URIs", () => {
		expect(() => uriToBindingKey("https://example.invalid/x")).toThrow(/Invalid livectx URI/)
	})

	it("round-trips heterogeneous keys including encoded slashes inside string atoms", () => {
		const key = ["svc", "v1", true, false, null, -3, "-raw", "a/b"] as const
		expect(uriToBindingKey(bindingKeyToUri(key))).toEqual(key as never)
	})

	it("round-trips deterministic object atoms (canonical key order)", () => {
		const key = ["meta", { a: 2, b: 1 }] as const
		expect(uriToBindingKey(bindingKeyToUri(key))).toEqual(key as never)
	})
})
