import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/sink-anthropic",
		include: ["test/**/*.test.ts"],
	},
})
