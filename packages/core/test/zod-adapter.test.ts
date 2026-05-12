import { describe, expect, it } from "vitest"
import { z } from "zod"
import { zodToJsonSchema, zodToSchema } from "../src/zod-adapter.js"

describe("zodToSchema", () => {
	it("delegates parse and safeParse to the underlying schema", () => {
		const zod = z.object({ n: z.number() })
		const s = zodToSchema(zod)

		expect(s.parse({ n: 3 })).toEqual({ n: 3 })
		const ok = s.safeParse({ n: 3 })
		expect(ok.success).toBe(true)
		if (!ok.success) return
		expect(ok.data).toEqual({ n: 3 })

		const bad = s.safeParse({ n: "x" })
		expect(bad.success).toBe(false)
		if (bad.success) return
		expect(bad.error).toBeInstanceOf(Error)
	})

	it("emits JSON Schema for nested objects", () => {
		const zod = z.object({
			name: z.string().describe("user name"),
			age: z.number(),
			skips: z.string().optional(),
		})

		const json = zodToSchema(zod).toJsonSchema?.()
		expect(json).toMatchObject({
			type: "object",
			properties: {
				name: { type: "string", description: "user name" },
				age: { type: "number" },
				skips: { type: "string" },
			},
			required: ["name", "age"],
		})
		expect(json?.required).not.toContain("skips")
	})

	it("maps z.array(z.string())", () => {
		const s = zodToSchema(z.array(z.string()))
		const js = s.toJsonSchema?.()
		expect(js).toEqual({
			type: "array",
			items: { type: "string" },
		})
	})

	it("maps z.enum", () => {
		const s = zodToSchema(z.enum(["east", "west"]))
		expect(s.toJsonSchema?.()).toMatchObject({
			type: "string",
			enum: ["east", "west"],
		})
	})

	it("propagates description on primitives", () => {
		const s = zodToSchema(z.string().describe("A label"))
		expect(s.toJsonSchema?.()).toMatchObject({
			type: "string",
			description: "A label",
		})
	})

	it("treats .default as optional JSON-Schema-wise with default value", () => {
		const zod = z.object({
			level: z.number().describe("lvl").default(1),
		})
		const js = zodToSchema(zod).toJsonSchema?.()
		expect(js?.properties?.level).toMatchObject({
			type: "number",
			description: "lvl",
			default: 1,
		})
		expect(js?.required).toBeUndefined()
	})
})
