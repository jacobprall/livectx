import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { assembleTemplate } from "../src/assemble.js"
import { tool } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import { prompt, toolList } from "../src/template.js"
import type { AssembledSegments, ResolvedTool, SinkAdapter } from "../src/types.js"
import { zodToSchema } from "../src/zod-adapter.js"

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

describe("tool assembly integration", () => {
	it("includes tools declared via template toolList()", async () => {
		const tb = tool({
			key: ["tools", "a"],
			name: "listed",
			description: "Listed in template.",
			input: zodToSchema(z.object({})),
			fetch: async () => null,
		})
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		const out = await client.assemble({
			template: prompt`>${toolList([tb])}<`,
			sink: stubSink<Out>(),
		})
		expect(out.tools.some((x) => x.name === "listed")).toBe(true)
		await client.dispose()
	})

	it("includes tools from assemble options", async () => {
		const tb = tool({
			key: ["tools", "opt"],
			name: "opted",
			description: "From options.",
			input: zodToSchema(z.object({})),
			fetch: async () => null,
		})
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		const out = await client.assemble({
			template: prompt`hi`,
			sink: stubSink<Out>(),
			tools: [tb],
		})
		expect(out.tools.some((x) => x.name === "opted")).toBe(true)
		await client.dispose()
	})

	it("dedupes tools by latest definition for the same logical name", async () => {
		const fetchA = vi.fn(async () => "from-a")
		const fetchB = vi.fn(async () => "from-b")

		const a = tool({
			key: ["t", "a"],
			name: "dupTool",
			description: "A",
			input: zodToSchema(z.object({})),
			fetch: fetchA,
		})
		const b = tool({
			key: ["t", "b"],
			name: "dupTool",
			description: "B",
			input: zodToSchema(z.object({})),
			fetch: fetchB,
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		await client.assemble({
			template: prompt`${toolList([a])}`,
			sink: stubSink<Out>(),
			tools: [b],
		})

		const res = await client.executeTool("dupTool", {})
		expect(fetchB).not.toHaveBeenCalled()
		expect(fetchA).toHaveBeenCalled()
		expect(res).toBe("from-a")

		await client.dispose()
	})

	it("validates ResolvedTool.execute input before invoking fetch", async () => {
		const fetch = vi.fn(async () => "ok")

		const tb = tool({
			key: ["t", "v"],
			name: "validated",
			description: "needs id",
			input: zodToSchema(z.object({ id: z.string() })),
			fetch,
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		const out = await client.assemble({
			template: prompt`${toolList([tb])}`,
			sink: stubSink<Out>(),
		})

		await expect(out.tools[0]?.execute({ id: "" })).resolves.toBe("ok")
		expect(fetch).toHaveBeenCalledTimes(1)

		await expect(out.tools[0]?.execute({})).rejects.toThrow()
		expect(fetch).toHaveBeenCalledTimes(1)

		await client.dispose()
	})

	it("registers opts-only tools for lint tool-without-schema", async () => {
		const warned: string[] = []
		const noJson = {
			parse: (x: unknown) => x,
			safeParse: (x: unknown) =>
				x === undefined
					? { success: false as const, error: new Error("no") }
					: { success: true as const, data: x },
		}
		const tb = tool({
			key: ["t", "noschema"],
			name: "noschemaTool",
			description: "no json schema helper",
			input: noJson as import("../src/types.js").Schema<unknown>,
			fetch: async () => 0,
		})

		const ctx = createContextClient()
		const sink = stubSink<{ segments: AssembledSegments; tools: ResolvedTool[] }>()
		await assembleTemplate(
			{
				registerBinding: vi.fn(),
				resolveAssemblyValue: async () => ({
					value: "x",
					metric: { source: "fetch", tokens: 1 },
				}),
				emitWarning: (w) => warned.push(w.code),
			},
			ctx,
			{ template: prompt`only opts`, sink, tools: [tb] },
		)
		await ctx.dispose()
		expect(warned).toContain("tool-without-schema")
	})
})
