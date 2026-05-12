import { defineConfig } from "vitest/config"
import { vitestWorkspaceProjectGlobs } from "./vitest.workspace.js"

export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [...vitestWorkspaceProjectGlobs],
	},
})
