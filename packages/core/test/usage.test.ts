import { describe, expect, it } from "vitest"
import { createContextClient, prompt, source } from "../src/index.js"
import type { AssembledSegments, ResolvedTool, SinkAdapter } from "../src/types.js"

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

type StubOut = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }

describe("getUsage()", () => {
	it("returns zeroed usage before any assembly", () => {
		const client = createContextClient()
		const usage = client.getUsage()
		expect(usage.cumulativeTokens).toBe(0)
		expect(usage.assembliesTotal).toBe(0)
		expect(usage.assembliesThisWindow).toBe(0)
		expect(usage.fetchesThisWindow).toBe(0)
		expect(usage.budgetRemaining.tokens).toBe("unlimited")
		expect(usage.budgetRemaining.assemblies).toBe("unlimited")
		client.dispose()
	})

	it("tracks cumulative tokens and assemblies after assemble calls", async () => {
		const b = source({
			key: ["usage", "test"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "hello world",
		})

		const client = createContextClient()
		await client.assemble({ template: prompt`${b}`, sink: stubSink<StubOut>() })

		const usage = client.getUsage()
		expect(usage.assembliesTotal).toBe(1)
		expect(usage.cumulativeTokens).toBeGreaterThan(0)
		await client.dispose()
	})

	it("reports budget remaining when budget is configured", async () => {
		const b = source({
			key: ["usage", "budget"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "x",
		})

		const client = createContextClient({
			budget: { maxCumulativeTokens: 1000, maxAssembliesPerMinute: 10 },
		})
		await client.assemble({ template: prompt`${b}`, sink: stubSink<StubOut>() })

		const usage = client.getUsage()
		expect(usage.budgetRemaining.tokens).toBeLessThan(1000)
		expect(typeof usage.budgetRemaining.tokens).toBe("number")
		expect(usage.budgetRemaining.assemblies).toBe(9)
		await client.dispose()
	})
})
