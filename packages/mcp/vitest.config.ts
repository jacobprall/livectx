import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/mcp",
		include: ["test/**/*.test.ts"],
	},
})
