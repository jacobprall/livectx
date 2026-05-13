import { describe, expect, it, vi } from "vitest"
import { otelTelemetry } from "../src/index.js"

function createMockTracer() {
	const spans: Array<{
		name: string
		attributes?: Record<string, string | number | boolean>
		events: Array<{ name: string; attributes?: Record<string, string | number | boolean> }>
	}> = []
	return {
		spans,
		tracer: {
			startSpan(
				name: string,
				options?: { attributes?: Record<string, string | number | boolean> },
			) {
				const rec: (typeof spans)[number] = { name, ...options, events: [] }
				spans.push(rec)
				return {
					setAttribute: vi.fn(),
					addEvent: (evName: string, attrs?: Record<string, string | number | boolean>) => {
						rec.events.push({ name: evName, attributes: attrs })
					},
					end: vi.fn(),
				}
			},
		},
	}
}

describe("otelTelemetry", () => {
	it("recordAssemble creates span with correct attributes", () => {
		const { tracer, spans } = createMockTracer()
		const telemetry = otelTelemetry({ tracer })

		telemetry.recordAssemble({
			bindings: { a: { source: "cache-fresh", tokens: 1 } },
			prompt: {
				staticTokens: 10,
				dynamicTokens: 20,
				totalTokens: 30,
				expectedCacheHit: true,
				breakpointOffsetChars: 0,
			},
			warnings: [],
			durationMs: 42,
		})

		const assemble = spans.find((s) => s.name === "livectx.assemble")
		expect(assemble?.attributes).toMatchObject({
			"livectx.duration_ms": 42,
		})
		const ev = assemble?.events.find((e) => e.name === "assemble.complete")
		expect(ev?.attributes).toMatchObject({
			"livectx.bindings.count": 1,
			"livectx.tokens.static": 10,
			"livectx.tokens.dynamic": 20,
			"livectx.tokens.total": 30,
			"livectx.cache_hit": true,
			"livectx.warnings.count": 0,
		})
	})

	it("recordFetch creates span with key and latency", () => {
		const { tracer, spans } = createMockTracer()
		const telemetry = otelTelemetry({ tracer })

		telemetry.recordFetch(["user", 1], 99, false)

		expect(spans.some((s) => s.name === "livectx.fetch")).toBe(true)
		const fetchSpan = spans.find((s) => s.name === "livectx.fetch")
		expect(fetchSpan?.attributes?.["livectx.binding.key"]).toBeDefined()
		expect(fetchSpan?.attributes?.["livectx.fetch.latency_ms"]).toBe(99)
		expect(fetchSpan?.attributes?.["livectx.fetch.success"]).toBe(false)
	})

	it("recordWarning creates span with warning details", () => {
		const { tracer, spans } = createMockTracer()
		const telemetry = otelTelemetry({ tracer })

		telemetry.recordWarning({
			code: "fetch-slow",
			message: "slow",
			severity: "warn",
		})

		const w = spans.find((s) => s.name === "livectx.warning")
		expect(w?.attributes?.["livectx.warning.code"]).toBe("fetch-slow")
		expect(w?.attributes?.["livectx.warning.severity"]).toBe("warn")
		expect(w?.attributes?.["livectx.warning.message"]).toBe("slow")
	})

	it("works without meter (no errors)", () => {
		const { tracer } = createMockTracer()
		const telemetry = otelTelemetry({ tracer })

		expect(() => {
			telemetry.recordAssemble({
				bindings: {},
				prompt: {
					staticTokens: 0,
					dynamicTokens: 0,
					totalTokens: 0,
					expectedCacheHit: false,
					breakpointOffsetChars: 0,
				},
				warnings: [],
				durationMs: 1,
			})
			telemetry.recordFetch(["x"], 1, true)
			telemetry.recordWarning({
				code: "dynamic-in-prefix",
				message: "x",
				severity: "info",
			})
		}).not.toThrow()
	})

	it("mock tracer captures spans for all methods", () => {
		const { tracer, spans } = createMockTracer()
		const histogram = { record: vi.fn() }
		const counter = { add: vi.fn() }
		const meter = {
			createHistogram: vi.fn(() => histogram),
			createCounter: vi.fn(() => counter),
		}
		const telemetry = otelTelemetry({ tracer, meter })

		telemetry.recordAssemble({
			bindings: {},
			prompt: {
				staticTokens: 1,
				dynamicTokens: 2,
				totalTokens: 3,
				expectedCacheHit: false,
				breakpointOffsetChars: 0,
			},
			warnings: [],
			durationMs: 5,
		})
		telemetry.recordFetch(["k"], 7, true)
		telemetry.recordWarning({ code: "tool-without-schema", message: "m", severity: "warn" })

		expect(spans.map((s) => s.name)).toEqual(
			expect.arrayContaining(["livectx.assemble", "livectx.fetch", "livectx.warning"]),
		)
		expect(histogram.record).toHaveBeenCalled()
		expect(counter.add).toHaveBeenCalled()
	})
})
