import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/otel",
		include: ["test/**/*.test.ts"],
	},
})
