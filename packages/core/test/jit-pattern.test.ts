import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { source, tool } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import { serializeKey } from "../src/key.js"
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

describe("JIT pattern — summary binding + drill-down tool", () => {
	it("keeps summaries in dynamics while attaching detail tools beside them", async () => {
		const telemetryRecord = vi.fn()

		const serviceSummary = source({
			key: ["telemetry", "serviceSummary"],
			placement: "dynamic",
			staleTime: "30s",
			gcTime: "10m",
			fetch: async () => '{"services":["api","worker"]}',
		})

		const serviceDetails = tool({
			key: ["tools", "serviceDetails"],
			name: "serviceDetails",
			description: "Load full YAML for one service.",
			input: zodToSchema(z.object({ id: z.string() })),
			fetch: async ({ id }) => ({ kind: "Service", metadata: { name: id } }),
		})

		const client = createContextClient({
			telemetry: { recordAssemble: telemetryRecord, recordFetch: vi.fn(), recordWarning: vi.fn() },
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const out = await client.assemble({
			template: prompt`
Services (summary):
${serviceSummary}

${toolList([serviceDetails])}
`,
			sink: stubSink<Out>(),
		})

		const dynText = out.segments.dynamicBlocks.map((b) => b.text).join("\n")
		expect(dynText).toContain("api")
		expect(out.tools.some((t) => t.name === "serviceDetails")).toBe(true)
		expect(out.tools[0]?.inputSchema).toMatchObject({
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		})

		const metrics = telemetryRecord.mock.calls[0]?.[0]
		expect(metrics?.bindings?.[serializeKey(serviceSummary.__def.key)]).toBeDefined()
		expect(metrics?.bindings?.[serializeKey(serviceDetails.__def.key)]).toBeDefined()

		await expect(client.executeTool("serviceDetails", { id: "api" })).resolves.toEqual({
			kind: "Service",
			metadata: { name: "api" },
		})

		await client.dispose()
	})
})
