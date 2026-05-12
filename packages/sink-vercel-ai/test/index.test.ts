import { describe, expect, it } from "vitest"
import * as pkg from "../src/index.js"

describe("@livectx/sink-vercel-ai", () => {
	it("exports a module object", () => {
		expect(pkg).toBeDefined()
	})
})
