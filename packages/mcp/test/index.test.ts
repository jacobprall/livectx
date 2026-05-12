import { describe, expect, it } from "vitest"
import * as pkg from "../src/index.js"

describe("@livectx/mcp", () => {
	it("exports a module object", () => {
		expect(pkg).toBeDefined()
	})
})
