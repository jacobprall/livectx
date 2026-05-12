import { describe, expect, it } from "vitest"
import { jsonSchemaToSchema } from "../src/schema-adapter.js"

describe("jsonSchemaToSchema", () => {
	it("parse validates basic object shapes", () => {
		const s = jsonSchemaToSchema({
			type: "object",
			properties: { a: { type: "string" }, b: { type: "number" } },
			required: ["a"],
		})
		expect(s.parse({ a: "x", b: 1 })).toEqual({ a: "x", b: 1 })
		expect(() => s.parse({ b: 1 })).toThrow(/Missing required/)
		expect(() => s.parse({ a: "x", b: "no" })).toThrow(/Expected number/)
	})

	it("safeParse catches errors", () => {
		const s = jsonSchemaToSchema({ type: "string" })
		expect(s.safeParse(3)).toMatchObject({ success: false })
		expect(s.safeParse("ok")).toMatchObject({ success: true, data: "ok" })
	})

	it("toJsonSchema returns original schema", () => {
		const raw = { type: "object", properties: { flag: { type: "boolean" } } } as const
		const s = jsonSchemaToSchema(raw as Record<string, unknown>)
		expect(s.toJsonSchema?.()).toEqual(raw)
	})
})
