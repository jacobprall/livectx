import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/sink-openai",
		include: ["test/**/*.test.ts"],
	},
})
