import { defineConfig } from "tsup"
import { createLivectxPackageConfig } from "../../tsup.base.ts"

export default defineConfig(createLivectxPackageConfig({ bundleLivectx: true }))
