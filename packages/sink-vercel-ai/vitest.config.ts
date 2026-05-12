import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/sink-vercel-ai",
		include: ["test/**/*.test.ts"],
	},
})
