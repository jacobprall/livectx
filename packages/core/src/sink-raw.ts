import type { AssembleMetrics, AssembledSegments, ResolvedTool, SinkAdapter } from "./types.js"

export interface RawSinkOutput {
	staticText: string
	dynamicText: string
	toolSpecs: ResolvedTool[]
	metrics: AssembleMetrics
}

/** Extract concatenated text from assembled segments, preserving original inter-block spacing. */
export function segmentsToText(segments: AssembledSegments): {
	staticText: string
	dynamicText: string
} {
	return {
		staticText: segments.staticBlocks.map((b) => b.text).join(""),
		dynamicText: segments.dynamicBlocks.map((b) => b.text).join(""),
	}
}

export function rawSink(): SinkAdapter<RawSinkOutput> {
	return {
		name: "raw",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]): RawSinkOutput {
			const { staticText, dynamicText } = segmentsToText(segments)
			return {
				staticText,
				dynamicText,
				toolSpecs: [...tools],
				metrics: segments.metrics,
			}
		},
	}
}
