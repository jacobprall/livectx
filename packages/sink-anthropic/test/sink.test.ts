import type { AssembledSegments, ResolvedTool } from "@livectx/core"
import { describe, expect, it } from "vitest"
import { anthropicSink } from "../src/index.js"

function segmentsSample(): AssembledSegments {
	return {
		staticBlocks: [{ text: "alpha" }, { text: "beta" }],
		dynamicBlocks: [{ text: "user-line" }],
		breakpointTtl: "5m",
		metrics: {
			bindings: {},
			durationMs: 5,
			warnings: [],
			prompt: {
				staticTokens: 10,
				dynamicTokens: 5,
				totalTokens: 15,
				expectedCacheHit: true,
				breakpointOffsetChars: 7,
			},
		},
	}
}

const tool: ResolvedTool = {
	name: "demo_tool",
	description: "demo",
	inputSchema: { type: "object", properties: { foo: { type: "number" } } },
	async execute(input: unknown) {
		void input
		return null
	},
}

describe("@livectx/sink-anthropic", () => {
	it("anchors cache_control on closing static chunk only", () => {
		const sink = anthropicSink()
		const out = sink.format(segmentsSample(), [tool])

		expect(out.system).toHaveLength(2)

		expect(out.system[0]?.cache_control).toBeUndefined()

		expect(out.system[1]?.cache_control?.type).toBe("ephemeral")

		expect(out.messages[0]?.role).toBe("user")

		expect(out.tools[0]?.input_schema.type).toBe("object")

		expect(out.metrics.prompt.totalTokens).toBeGreaterThan(0)
	})

	it("propagates metrics untouched", () => {
		const sink = anthropicSink()
		const segs = segmentsSample()
		const out = sink.format(segs, [])
		expect(out.metrics).toStrictEqual(segs.metrics)
	})
})
