import { anthropicSink } from "@livectx/sink-anthropic"
import { openaiSink } from "@livectx/sink-openai"
import { vercelAISink } from "@livectx/sink-vercel-ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createContextClient, prompt, source, tool, toolList } from "../src/index.js"
import { rawSink } from "../src/sink-raw.js"
import type {
	AssembledSegments,
	ResolvedTool,
	SinkAdapter,
	Template,
	ToolBinding,
} from "../src/types.js"
import { zodToSchema } from "../src/zod-adapter.js"

const TEST_SINKS = [rawSink(), openaiSink(), anthropicSink(), vercelAISink()] as const

function toolFingerprintsFromResolved(tools: readonly ResolvedTool[]) {
	return [...tools]
		.map((t) => ({
			name: t.name,
			description: t.description,
			schemaJson: JSON.stringify(t.inputSchema),
		}))
		.sort((a, b) => a.name.localeCompare(b.name))
}

function toolFingerprintsFromFormatted(sinkName: string, out: unknown) {
	if (sinkName === "raw") {
		const o = out as { toolSpecs: ResolvedTool[] }
		return toolFingerprintsFromResolved(o.toolSpecs)
	}
	if (sinkName === "openai") {
		const o = out as {
			tools: Array<{ function: { name: string; description: string; parameters: unknown } }>
		}
		return o.tools
			.map((t) => ({
				name: t.function.name,
				description: t.function.description,
				schemaJson: JSON.stringify(t.function.parameters),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
	if (sinkName === "anthropic") {
		const o = out as { tools: Array<{ name: string; description: string; input_schema: unknown }> }
		return o.tools
			.map((t) => ({
				name: t.name,
				description: t.description,
				schemaJson: JSON.stringify(t.input_schema),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
	if (sinkName === "vercel-ai") {
		const o = out as { tools: Record<string, { description: string; parameters: unknown }> }
		return Object.entries(o.tools)
			.map(([name, v]) => ({
				name,
				description: v.description,
				schemaJson: JSON.stringify(v.parameters),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
	throw new Error(`unknown sink: ${sinkName}`)
}

function captureSink(): {
	sink: SinkAdapter<null>
	read: () => { segments: AssembledSegments; tools: readonly ResolvedTool[] }
} {
	let box: { segments: AssembledSegments; tools: readonly ResolvedTool[] } | undefined
	return {
		sink: {
			name: "capture",
			format(segments, tools) {
				box = { segments, tools }
				return null
			},
		},
		read: () => {
			if (!box) {
				throw new Error("capture sink did not run")
			}
			return box
		},
	}
}

function makeTool(name: string, description: string): ToolBinding<unknown, unknown> {
	return tool({
		key: ["tools", name],
		name,
		description,
		input: zodToSchema(z.object({ arg: z.string().optional() })),
		fetch: async () => null,
	}) as ToolBinding<unknown, unknown>
}

async function assertConformance(
	template: Template,
	extraTools: readonly ToolBinding<unknown, unknown>[] = [],
) {
	const { sink, read } = captureSink()
	const client = createContextClient()
	await client.assemble({ template, sink, tools: extraTools })
	const { segments, tools: resolvedTools } = read()
	await client.dispose()

	const expectedTools = toolFingerprintsFromResolved(resolvedTools)
	const metricsRef = segments.metrics

	for (const s of TEST_SINKS) {
		const formatted = s.format(segments, resolvedTools)
		expect(formatted).toBeDefined()
		expect((formatted as { metrics: typeof metricsRef }).metrics).toBe(metricsRef)
		expect(toolFingerprintsFromFormatted(s.name, formatted)).toEqual(expectedTools)
	}
}

describe("sink conformance", () => {
	it("static + dynamic bindings with tools", async () => {
		const sta = source({
			key: ["conf", "static"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "SYS",
		})
		const dyn = source({
			key: ["conf", "dyn"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "USER",
		})
		const tb = makeTool("conf_tool", "one tool")
		await assertConformance(prompt`Head ${sta} mid ${dyn} tail ${toolList([tb])}`)
	})

	it("tools from assemble options only", async () => {
		const sta = source({
			key: ["opt", "s"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "S",
		})
		const dyn = source({
			key: ["opt", "d"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "D",
		})
		const tb = makeTool("opted_tool", "from options")
		await assertConformance(prompt`${sta} ${dyn}`, [tb])
	})

	it("no tools", async () => {
		const sta = source({
			key: ["nt", "s"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "only-static",
		})
		const dyn = source({
			key: ["nt", "d"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "only-dyn",
		})
		await assertConformance(prompt`${sta} ${dyn}`)
	})

	it("only static content", async () => {
		const sta = source({
			key: ["os", "a"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "ALL_STATIC",
		})
		await assertConformance(prompt`PREFIX ${sta} SUFFIX`)
	})

	it("only dynamic content", async () => {
		const dyn = source({
			key: ["od", "a"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "ALL_DYNAMIC",
		})
		await assertConformance(prompt`${dyn}`)
	})

	it("multiple tools in toolList", async () => {
		const sta = source({
			key: ["mt", "s"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "s",
		})
		const a = makeTool("multi_a", "A")
		const b = makeTool("multi_b", "B")
		await assertConformance(prompt`${sta} ${toolList([a, b])}`)
	})
})
