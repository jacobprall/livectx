import type { AssembledSegments, ResolvedTool } from "@livectx/core"
import { describe, expect, it } from "vitest"
import { openaiSink } from "../src/index.js"

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

const demoTool: ResolvedTool = {
	name: "demo_tool",
	description: "demo",
	inputSchema: { type: "object", properties: { foo: { type: "number" } } },
	async execute(input: unknown) {
		void input
		return null
	},
}

describe("@livectx/sink-openai", () => {
	it("maps static to system and dynamic to user with OpenAI-shaped tools", () => {
		const sink = openaiSink()
		const out = sink.format(segmentsSample(), [demoTool])

		expect(out.messages.map((m) => m.role)).toEqual(["system", "user"])

		expect(out.messages[0]?.role).toBe("system")
		expect(out.messages[0]?.content).toBe("alpha\nbeta")

		expect(out.messages[1]?.role).toBe("user")
		expect(out.messages[1]?.content).toBe("user-line")

		expect(out.tools).toHaveLength(1)
		expect(out.tools[0]).toEqual({
			type: "function",
			function: {
				name: "demo_tool",
				description: "demo",
				parameters: { type: "object", properties: { foo: { type: "number" } } },
			},
		})
	})

	it("uses empty tools array when no tools", () => {
		const sink = openaiSink()
		const out = sink.format(segmentsSample(), [])
		expect(out.tools).toEqual([])
	})

	it("propagates metrics untouched", () => {
		const sink = openaiSink()
		const segs = segmentsSample()
		const out = sink.format(segs, [])
		expect(out.metrics).toStrictEqual(segs.metrics)
	})

	it("is byte-stable for identical inputs", () => {
		const sink = openaiSink()
		const segs = segmentsSample()
		const tools = [demoTool]
		const a = sink.format(segs, tools)
		const b = sink.format(segs, tools)
		expect(a).toEqual(b)
	})

	it("adds a single empty system message when both static and dynamic are blank", () => {
		const sink = openaiSink()
		const segs: AssembledSegments = {
			staticBlocks: [{ text: "  \n  " }],
			dynamicBlocks: [{ text: "" }],
			metrics: segmentsSample().metrics,
		}
		const out = sink.format(segs, [])
		expect(out.messages).toEqual([{ role: "system", content: "" }])
	})
})
