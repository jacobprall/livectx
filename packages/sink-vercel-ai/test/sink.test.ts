import type { AssembledSegments, ResolvedTool } from "@livectx/core"
import { describe, expect, it } from "vitest"
import { vercelAISink } from "../src/index.js"

function segmentsSample(): AssembledSegments {
	return {
		staticBlocks: [{ text: "system-text" }, { text: "more-static" }],
		dynamicBlocks: [{ text: "user-chunk" }],
		metrics: {
			bindings: {},
			durationMs: 3,
			warnings: [],
			prompt: {
				staticTokens: 8,
				dynamicTokens: 4,
				totalTokens: 12,
				expectedCacheHit: false,
				breakpointOffsetChars: 0,
			},
		},
	}
}

const demoTool: ResolvedTool = {
	name: "lookup",
	description: "look something up",
	inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
	async execute(input: unknown) {
		void input
		return "ok"
	},
}

describe("@livectx/sink-vercel-ai", () => {
	it("exposes system as a plain string, messages as an array, and tools as a Record by name", () => {
		const sink = vercelAISink()
		const out = sink.format(segmentsSample(), [demoTool])

		expect(typeof out.system).toBe("string")
		expect(out.system).toBe("system-textmore-static")

		expect(out.messages).toEqual([{ role: "user", content: "user-chunk" }])

		expect(out.tools).not.toBeInstanceOf(Array)
		expect(Object.keys(out.tools)).toEqual(["lookup"])
		expect(out.tools.lookup).toEqual({
			description: "look something up",
			parameters: {
				type: "object",
				properties: { q: { type: "string" } },
				required: ["q"],
			},
		})
	})

	it("omits user messages when there is no dynamic text", () => {
		const sink = vercelAISink()
		const segs: AssembledSegments = {
			...segmentsSample(),
			dynamicBlocks: [{ text: "  \t  " }],
		}
		const out = sink.format(segs, [])
		expect(out.messages).toEqual([])
	})

	it("includes metrics from segments", () => {
		const sink = vercelAISink()
		const segs = segmentsSample()
		const out = sink.format(segs, [])
		expect(out.metrics).toStrictEqual(segs.metrics)
	})
})
