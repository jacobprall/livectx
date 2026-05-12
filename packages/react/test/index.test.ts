import { describe, expect, it } from "vitest"
import * as pkg from "../src/index.js"

describe("@livectx/react", () => {
	it("exports a module object", () => {
		expect(pkg).toBeDefined()
	})
})
