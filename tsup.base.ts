import type { Options } from "tsup"

export type LivectxTsupOptions = {
	/** When true, do not externalize @livectx/* (used for @livectx/core). */
	bundleLivectx?: boolean
}

export function createLivectxPackageConfig(opts: LivectxTsupOptions = {}): Options {
	const { bundleLivectx = false } = opts
	return {
		entry: ["src/index.ts"],
		format: ["esm", "cjs"],
		dts: true,
		sourcemap: true,
		clean: true,
		treeshake: true,
		splitting: false,
		// Dual ESM + CJS: explicit extensions for correct resolution.
		outExtension({ format }) {
			return { js: format === "esm" ? ".mjs" : ".cjs" }
		},
		external: bundleLivectx ? [] : [/^@livectx\//],
	}
}
