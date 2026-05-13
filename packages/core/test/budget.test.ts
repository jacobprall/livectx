import { anthropicSink } from "@livectx/sink-anthropic"
import { describe, expect, it, vi } from "vitest"
import { source } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import type { BudgetExceededError } from "../src/errors.js"
import { serializeKey } from "../src/key.js"
import { prompt } from "../src/template.js"
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

describe("Budget / Cost Control", () => {
	it("respects no budget overhead for normal assembly", async () => {
		const fetchFn = vi.fn(async () => "ok")
		const b = source({
			key: ["budget", "none"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: fetchFn,
		})

		const client = createContextClient()

		await client.assemble({
			template: prompt`Hello ${b}`,
			sink: anthropicSink(),
		})

		expect(fetchFn).toHaveBeenCalledTimes(1)
		await client.dispose()
	})

	it("throws BudgetExceededError for tokens when maxTokensPerAssembly exceeded and onExceeded is throw", async () => {
		const longText = "x".repeat(201)
		const b = source({
			key: ["budget", "long"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => longText,
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { maxTokensPerAssembly: 50, onExceeded: "throw" },
		})

		await expect(
			client.assemble({
				template: prompt`${b}`,
				sink: stubSink<Out>(),
			}),
		).rejects.toMatchObject({
			name: "BudgetExceededError",
			metric: "tokens",
		} satisfies Partial<BudgetExceededError>)

		await client.dispose()
	})

	it("warns but completes assembly when maxTokensPerAssembly exceeded and onExceeded is warn", async () => {
		const longText = "y".repeat(201)
		const b = source({
			key: ["budget", "long-warn"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => longText,
		})

		const onWarning = vi.fn()
		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { maxTokensPerAssembly: 50, onExceeded: "warn" },
			onWarning,
		})

		const out = await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})

		expect(out.segments.metrics.prompt.totalTokens).toBeGreaterThan(50)
		expect(onWarning).toHaveBeenCalled()
		expect(onWarning.mock.calls.some((c) => c[0]?.code === "budget-exceeded")).toBe(true)

		await client.dispose()
	})

	it("enforces maxCumulativeTokens across repeated assemblies", async () => {
		const body = "z".repeat(200)
		const b = source({
			key: ["budget", "cumulative"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => body,
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { maxCumulativeTokens: 99, onExceeded: "throw" },
		})

		await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})

		await expect(
			client.assemble({
				template: prompt`${b}`,
				sink: stubSink<Out>(),
			}),
		).rejects.toMatchObject({
			name: "BudgetExceededError",
			metric: "cumulative",
		})

		await client.dispose()
	})

	it("throws BudgetExceededError for assemblies when maxAssembliesPerMinute exceeded", async () => {
		const b = source({
			key: ["budget", "apm"],
			placement: "dynamic",
			staleTime: "1h",
			fetch: async () => "v",
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { maxAssembliesPerMinute: 2, onExceeded: "throw" },
		})

		await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})
		await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})

		await expect(
			client.assemble({
				template: prompt`${b}`,
				sink: stubSink<Out>(),
			}),
		).rejects.toMatchObject({
			name: "BudgetExceededError",
			metric: "assemblies",
		})

		await client.dispose()
	})

	it("applies minStaleTime so cached value is served fresh on second assemble", async () => {
		const fetchFn = vi.fn(async () => "only-once")
		const b = source({
			key: ["budget", "stale-floor"],
			placement: "dynamic",
			staleTime: 0,
			gcTime: "1h",
			fetch: fetchFn,
		})

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { minStaleTime: "1h" },
		})

		await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})
		const out = await client.assemble({
			template: prompt`${b}`,
			sink: stubSink<Out>(),
		})

		const bk = serializeKey(b.__def.key)
		expect(out.segments.metrics.bindings[bk]?.source).toBe("cache-fresh")
		expect(fetchFn).toHaveBeenCalledTimes(1)

		await client.dispose()
	})

	it("throws BudgetExceededError for fetches when maxFetchesPerMinute exceeded", async () => {
		const fetchSpy = vi.fn(async () => 1)

		const bindings = [0, 1, 2, 3].map((i) =>
			source({
				key: ["budget", "multi", i],
				placement: "dynamic",
				staleTime: "1h",
				fetch: fetchSpy,
			}),
		)

		type Out = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }
		const client = createContextClient({
			budget: { maxFetchesPerMinute: 3, onExceeded: "throw" },
		})

		await expect(
			client.assemble({
				template: prompt`${bindings[0]!}${bindings[1]!}${bindings[2]!}${bindings[3]!}`,
				sink: stubSink<Out>(),
			}),
		).rejects.toMatchObject({
			name: "BudgetExceededError",
			metric: "fetches",
		})

		expect(fetchSpy).toHaveBeenCalledTimes(3)

		await client.dispose()
	})
})
