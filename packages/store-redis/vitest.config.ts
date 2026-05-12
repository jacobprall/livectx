import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/store-redis",
		include: ["test/**/*.test.ts"],
	},
})
