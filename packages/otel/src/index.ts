import type { AssembleMetrics, BindingKey, TelemetryAdapter, Warning } from "@livectx/core"
import { serializeKey } from "@livectx/core"

export interface OtelOptions {
	tracer: Tracer
	meter?: Meter
}

// Use structural types for OTel API to avoid hard dependency
interface Tracer {
	startSpan(name: string, options?: SpanOptions): Span
}

interface Meter {
	createHistogram(name: string, options?: { description?: string; unit?: string }): Histogram
	createCounter(name: string, options?: { description?: string }): Counter
}

interface SpanOptions {
	attributes?: Record<string, string | number | boolean>
}

interface Span {
	setAttribute(key: string, value: string | number | boolean): void
	addEvent(name: string, attributes?: Record<string, string | number | boolean>): void
	end(): void
}

interface Histogram {
	record(value: number, attributes?: Record<string, string | number | boolean>): void
}

interface Counter {
	add(value: number, attributes?: Record<string, string | number | boolean>): void
}

export function otelTelemetry(opts: OtelOptions): TelemetryAdapter {
	const { tracer, meter } = opts

	const assembleHistogram = meter?.createHistogram("livectx.assemble.duration", {
		description: "Assembly duration in milliseconds",
		unit: "ms",
	})
	const fetchHistogram = meter?.createHistogram("livectx.fetch.duration", {
		description: "Fetch duration in milliseconds",
		unit: "ms",
	})
	const warningCounter = meter?.createCounter("livectx.warnings", {
		description: "Number of warnings emitted",
	})

	return {
		recordAssemble(metrics: AssembleMetrics): void {
			const span = tracer.startSpan("livectx.assemble", {
				attributes: {
					"livectx.duration_ms": metrics.durationMs,
				},
			})
			span.addEvent("assemble.complete", {
				"livectx.bindings.count": Object.keys(metrics.bindings).length,
				"livectx.tokens.static": metrics.prompt.staticTokens,
				"livectx.tokens.dynamic": metrics.prompt.dynamicTokens,
				"livectx.tokens.total": metrics.prompt.totalTokens,
				"livectx.cache_hit": metrics.prompt.expectedCacheHit,
				"livectx.warnings.count": metrics.warnings.length,
			})
			span.end()
			assembleHistogram?.record(metrics.durationMs)
		},

		recordFetch(key: BindingKey, latencyMs: number, success: boolean): void {
			const span = tracer.startSpan("livectx.fetch", {
				attributes: {
					"livectx.binding.key": serializeKey(key),
					"livectx.fetch.latency_ms": latencyMs,
					"livectx.fetch.success": success,
				},
			})
			span.end()
			fetchHistogram?.record(latencyMs, { success: success ? "true" : "false" })
		},

		// Permission checks can flow through `onWarning` on the client when the
		// permission hook is wired to emit warnings (no dedicated OTel hook path).
		recordWarning(warning: Warning): void {
			const span = tracer.startSpan("livectx.warning", {
				attributes: {
					"livectx.warning.code": warning.code,
					"livectx.warning.severity": warning.severity,
					"livectx.warning.message": warning.message,
					...(warning.code === "budget-exceeded" ? { "livectx.budget.exceeded": true } : {}),
				},
			})
			span.end()
			warningCounter?.add(1, { code: warning.code })
		},
	}
}
