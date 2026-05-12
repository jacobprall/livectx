import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/source-sse",
		include: ["test/**/*.test.ts"],
	},
})
