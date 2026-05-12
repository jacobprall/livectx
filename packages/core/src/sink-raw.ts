import type { AssembleMetrics, AssembledSegments, ResolvedTool, SinkAdapter } from "./types.js"

export interface RawSinkOutput {
	staticText: string
	dynamicText: string
	toolSpecs: ResolvedTool[]
	metrics: AssembleMetrics
}

export function rawSink(): SinkAdapter<RawSinkOutput> {
	return {
		name: "raw",
		format(segments: AssembledSegments, tools: readonly ResolvedTool[]): RawSinkOutput {
			return {
				staticText: segments.staticBlocks.map((b) => b.text).join("\n"),
				dynamicText: segments.dynamicBlocks.map((b) => b.text).join("\n"),
				toolSpecs: [...tools],
				metrics: segments.metrics,
			}
		},
	}
}
