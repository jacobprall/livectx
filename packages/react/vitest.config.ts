import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/react",
		environment: "jsdom",
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
	},
})
