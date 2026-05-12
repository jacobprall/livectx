import { describe, expect, it } from "vitest"
import { z } from "zod"
import { tool } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import { prompt } from "../src/template.js"
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

describe("client.executeTool", () => {
	it("routes to the assembled tool binding", async () => {
		const t = tool({
			key: ["tools", "x"],
			name: "double",
			description: "doubles input",
			input: zodToSchema(z.object({ n: z.number() })),
			fetch: async ({ n }) => n * 2,
		})
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		await client.assemble({
			template: prompt`(ctx)`,
			sink: stubSink<Out>(),
			tools: [t],
		})

		await expect(client.executeTool("double", { n: 21 })).resolves.toBe(42)
		await client.dispose()
	})

	it("rejects unknown tool names", async () => {
		const client = createContextClient()
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		await client.assemble({
			template: prompt`hi`,
			sink: stubSink<Out>(),
		})
		await expect(client.executeTool("missing", {})).rejects.toThrow(/Unknown tool/)
		await client.dispose()
	})

	it("propagates schema validation failures from invalid payloads", async () => {
		const t = tool({
			key: ["tools", "v"],
			name: "needsKey",
			description: "strict",
			input: zodToSchema(z.object({ id: z.string().min(1) })),
			fetch: async ({ id }) => id,
		})
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient()
		await client.assemble({
			template: prompt`ctx`,
			sink: stubSink<Out>(),
			tools: [t],
		})
		await expect(client.executeTool("needsKey", {})).rejects.toThrow()
		await client.dispose()
	})
})
