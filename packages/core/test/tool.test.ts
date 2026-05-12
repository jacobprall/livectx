import { describe, expect, it } from "vitest"
import { tool } from "../src/binding.js"
import { trivialSchema } from "./helpers.js"

describe("tool()", () => {
	it("constructs ToolBinding from a valid ToolBindingDef", () => {
		const tb = tool({
			key: ["tools", "x"],
			name: "get_x",
			description: "Fetches something.",
			input: trivialSchema(),
			fetch: async () => 7,
		})
		expect(tb.__brand).toBe("Binding")
		expect("__tool" in tb).toBe(true)
		expect(tb.__tool.name).toBe("get_x")
		expect(tb.__tool.description).toBe("Fetches something.")
		expect(tb.__def.placement).toBe("tool")
	})

	it("forces placement tool on __def", () => {
		const tb = tool({
			key: ["tools", "a"],
			name: "alpha",
			description: "d",
			input: trivialSchema(),
			fetch: async () => "out",
		})
		expect(tb.__def.placement).toBe("tool")
	})

	it.each([
		["", "empty"],
		["bad name", "spaces"],
		["1bad", "leading digit"],
		["bad-name", "hyphen"],
	])("throws on invalid tool name (%s)", (name, _label) => {
		expect(() =>
			tool({
				key: ["k"],
				name,
				description: "ok",
				input: trivialSchema(),
				fetch: async () => 0,
			}),
		).toThrow(TypeError)
	})

	it("throws when description missing or blank", () => {
		expect(() =>
			tool({
				key: ["k"],
				name: "ok",
				description: "",
				input: trivialSchema(),
				fetch: async () => 0,
			}),
		).toThrow(TypeError)
		expect(() =>
			tool({
				key: ["k"],
				name: "ok",
				description: "  ",
				input: trivialSchema(),
				fetch: async () => 0,
			}),
		).toThrow(TypeError)
	})

	it("throws when binding key empty", () => {
		expect(() =>
			tool({
				key: [],
				name: "x",
				description: "d",
				input: trivialSchema(),
				fetch: async () => 0,
			}),
		).toThrow(TypeError)
	})

	it("freezes embedded tool definitions", () => {
		const tb = tool({
			key: ["tools", "f"],
			name: "froze",
			description: "d",
			input: trivialSchema(),
			fetch: async () => 0,
		})
		expect(Object.isFrozen(tb.__tool)).toBe(true)
		expect(Object.isFrozen(tb.__tool.key)).toBe(true)
	})
})
