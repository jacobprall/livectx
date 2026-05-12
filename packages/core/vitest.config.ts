import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/core",
		include: ["test/**/*.test.ts"],
		exclude: ["test/bench/**"],
		benchmark: {
			include: ["test/bench/**/*.bench.ts"],
		},
	},
})
