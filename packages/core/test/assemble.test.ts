import { describe, expect, it, vi } from "vitest"
import { source } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import { cacheBreakpoint, prompt, toolList } from "../src/template.js"
import type { AssembledSegments, ResolvedTool, SinkAdapter, ToolBinding } from "../src/types.js"
import { dummyToolBinding, trivialSchema } from "./helpers.js"

function stubSink<
	T extends { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] },
>(): SinkAdapter<T> {
	return {
		name: "stub-sink",
		format(segments, tools) {
			return { segments, tools } as T
		},
	}
}

function weatherTool(): ToolBinding<{ q: string }, string> {
	return {
		__brand: "Binding",
		__tool: {
			key: ["tools", "weather"],
			name: "weather",
			description: "Lookup weather.",
			input: Object.assign(trivialSchema(), {
				toJsonSchema: () => ({
					type: "object",
					properties: { q: { type: "string" } },
					required: ["q"],
				}),
			}),
			fetch: async () => "sunny",
		},
		__def: {
			key: ["tools", "weather"],
			placement: "tool",
			staleTime: "1m",
			gcTime: "10m",
			fetch: async () => "",
		},
		__type: undefined as unknown as string,
	} as unknown as ToolBinding<{ q: string }, string>
}

describe("assemble", () => {
	it("inferred breakpoint separates static literals from trailing dynamics", async () => {
		const sta = source({
			key: ["st"],
			placement: "static",
			staleTime: "1h",
			fetch: vi.fn(async () => "SYSTEM"),
		})
		const dyn = source({
			key: ["dyn"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: vi.fn(async () => "BODY"),
		})

		const client = createContextClient()
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const res = await client.assemble({
			template: prompt` PREFIX ${sta} MID ${dyn} SUF `,
			sink: stubSink<Out>(),
		})

		const staticConcat = res.segments.staticBlocks.map((b) => b.text).join("")
		expect(staticConcat.includes("SYSTEM")).toBe(true)
		expect(staticConcat.includes("MID")).toBe(true)

		const dynConcat = res.segments.dynamicBlocks.map((x) => x.text).join("")
		expect(dynConcat).toContain("BODY")

		expect(res.segments.segmentation?.dynamicBindingKeysBeforeBreakpoint.length ?? 0).toBe(0)
		await client.dispose()
	})

	it("explicit cache breakpoint tags early dynamic placements", async () => {
		const earlyDyn = source({
			key: ["earlyDyn"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "before",
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		const out = await client.assemble({
			template: prompt`${earlyDyn}${cacheBreakpoint({ ttl: "5m" })}trail`,
			sink: stubSink<Out>(),
		})

		const keys = out.segments.segmentation?.dynamicBindingKeysBeforeBreakpoint ?? []
		expect(keys[0]?.[0]).toBe("earlyDyn")
		await client.dispose()
	})

	it("serializes primitives as dynamic pieces", async () => {
		const client = createContextClient()
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const out = await client.assemble({
			template: prompt`x ${42}`,
			sink: stubSink<Out>(),
		})

		expect(out.segments.dynamicBlocks.some((blk) => blk.text.includes("42"))).toBe(true)
		await client.dispose()
	})

	it("merges tools from template markers plus explicit option", async () => {
		const tb = dummyToolBinding("alpha")
		const client = createContextClient()
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const out = await client.assemble({
			template: prompt`>${toolList([tb])}<`,
			sink: stubSink<Out>(),
			tools: [weatherTool()],
		})

		expect(out.tools.some((t) => t.name === "alpha")).toBe(true)
		expect(out.tools.some((t) => t.name === "weather")).toBe(true)
		await client.dispose()
	})

	it("emits nonzero token metrics derived from assembled text length", async () => {
		const long = source({
			key: ["lng"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "abcd",
		})

		const telemetryRecord = vi.fn()
		const teleClient = createContextClient({
			telemetry: { recordAssemble: telemetryRecord, recordFetch: vi.fn(), recordWarning: vi.fn() },
		})
		await teleClient.assemble({
			template: prompt`${long}`,
			sink: stubSink<{ segments: AssembledSegments; tools: ResolvedTool[] }>(),
		})

		const metrics = telemetryRecord.mock.calls[0]?.[0]
		expect(metrics?.prompt.totalTokens ?? 0).toBeGreaterThan(0)

		await teleClient.dispose()
	})

	it("bustPromptCache merges static material into dynamics", async () => {
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }

		const bpClient = createContextClient()
		const out = await bpClient.assemble({
			template: prompt`${source({
				key: ["bp"],
				placement: "static",
				staleTime: "1h",
				fetch: async () => "cache-me",
			})}`,
			sink: stubSink<Out>(),
			bustPromptCache: true,
		})

		expect(out.segments.staticBlocks.length).toBe(0)
		expect(out.segments.dynamicBlocks.map((x) => x.text).join("")).toContain("cache-me")

		await bpClient.dispose()
	})
})
