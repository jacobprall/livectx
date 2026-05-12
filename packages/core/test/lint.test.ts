import { describe, expect, it } from "vitest"
import { source } from "../src/binding.js"
import { serializeKey } from "../src/key.js"
import { lintAssembly } from "../src/lint.js"
import type { AnyBinding, AssembledSegments } from "../src/types.js"
import { dummyToolBinding } from "./helpers.js"

function baseSegments(
	overrides: Partial<AssembledSegments> & Pick<AssembledSegments, "staticBlocks" | "dynamicBlocks">,
): AssembledSegments {
	return {
		metrics: {
			bindings: {},
			warnings: [],
			durationMs: 5,
			prompt: {
				staticTokens: 1,
				dynamicTokens: 2,
				totalTokens: 3,
				expectedCacheHit: false,
				breakpointOffsetChars: 0,
			},
		},
		breakpointTtl: undefined,
		...overrides,
	}
}

describe("lintAssembly", () => {
	it("reports static placements with dangerously short stale TTL", () => {
		const binder = source({
			key: ["snap"],
			placement: "static",
			staleTime: "1m",
			fetch: async () => "literal",
			gcTime: "10m",
		})

		const warns = lintAssembly(
			[binder],
			baseSegments({
				staticBlocks: [{ text: "x" }],
				dynamicBlocks: [],
			}),
			{},
		)

		expect(warns.some((w) => w.code === "static-with-short-stale")).toBe(true)
	})

	it("highlights dynamics rendered ahead of breakpoints", () => {
		const dyn = source({ key: ["ahead"], staleTime: "1h", fetch: async () => "v", gcTime: "10m" })

		const warns = lintAssembly(
			[dyn],
			baseSegments({
				staticBlocks: [{ text: "sys" }],
				dynamicBlocks: [],
				segmentation: {
					dynamicBindingKeysBeforeBreakpoint: [dyn.__def.key],
				},
			}),
			{},
		)

		expect(warns.some((w) => w.code === "dynamic-in-prefix")).toBe(true)
	})

	it("warns tools without input.toJsonSchema", () => {
		const warns = lintAssembly(
			[dummyToolBinding("no-schema") as unknown as AnyBinding],
			baseSegments({
				staticBlocks: [],
				dynamicBlocks: [],
			}),
			{},
		)

		expect(warns.some((w) => w.code === "tool-without-schema")).toBe(true)
	})

	it("captures painfully slow foreground fetches", () => {
		const slowBinding = source({
			key: ["metric"],
			staleTime: "1h",
			fetch: async () => "x",
			gcTime: "30m",
		})
		const ser = serializeKey(slowBinding.__def.key)

		const warns = lintAssembly(
			[slowBinding],
			baseSegments({ staticBlocks: [], dynamicBlocks: [] }),
			{
				[ser]: 2500,
			},
		)

		expect(warns.some((w) => w.code === "fetch-slow")).toBe(true)
	})

	it("does not warn when static staleTime is exactly five minutes", () => {
		const binder = source({
			key: ["edge", "5m"],
			placement: "static",
			staleTime: "5m",
			fetch: async () => "ok",
			gcTime: "10m",
		})
		const warns = lintAssembly(
			[binder],
			baseSegments({ staticBlocks: [{ text: "x" }], dynamicBlocks: [] }),
			{},
		)
		expect(warns.some((w) => w.code === "static-with-short-stale")).toBe(false)
	})

	it("does not warn for static placement with infinite staleTime", () => {
		const binder = source({
			key: ["edge", "inf"],
			placement: "static",
			staleTime: "Infinity",
			fetch: async () => "ok",
			gcTime: "10m",
		})
		const warns = lintAssembly(
			[binder],
			baseSegments({ staticBlocks: [{ text: "x" }], dynamicBlocks: [] }),
			{},
		)
		expect(warns.some((w) => w.code === "static-with-short-stale")).toBe(false)
	})

	it("skips dynamic-in-prefix when segmentation is absent", () => {
		const dyn = source({ key: ["noSeg"], staleTime: "1h", fetch: async () => "v", gcTime: "10m" })
		const warns = lintAssembly(
			[dyn],
			baseSegments({
				staticBlocks: [{ text: "sys" }],
				dynamicBlocks: [],
			}),
			{},
		)
		expect(warns.some((w) => w.code === "dynamic-in-prefix")).toBe(false)
	})

	it("does not warn tools whose schema exposes toJsonSchema", async () => {
		const { z } = await import("zod")
		const { tool } = await import("../src/binding.js")
		const { zodToSchema } = await import("../src/zod-adapter.js")
		const zt = tool({
			key: ["tools", "with-schema"],
			name: "with_schema",
			description: "has json schema",
			input: zodToSchema(z.object({ q: z.string() })),
			fetch: async () => ({ ok: true }),
		})
		const warns = lintAssembly(
			[zt as unknown as AnyBinding],
			baseSegments({ staticBlocks: [], dynamicBlocks: [] }),
			{},
		)
		expect(warns.some((w) => w.code === "tool-without-schema")).toBe(false)
	})

	it("does not flag fetch-slow at exactly the threshold", () => {
		const b = source({
			key: ["slow-edge"],
			staleTime: "1h",
			fetch: async () => "x",
			gcTime: "30m",
		})
		const ser = serializeKey(b.__def.key)
		const warns = lintAssembly([b], baseSegments({ staticBlocks: [], dynamicBlocks: [] }), {
			[ser]: 2000,
		})
		expect(warns.some((w) => w.code === "fetch-slow")).toBe(false)
	})
})
