import { defineProject } from "vitest/config"

export default defineProject({
	test: {
		name: "@livectx/source-websocket",
		include: ["test/**/*.test.ts"],
	},
})
