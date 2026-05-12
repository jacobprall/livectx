import { parseDuration } from "./duration.js"
import { serializeKey } from "./key.js"
import type {
	AnyBinding,
	AssembledSegments,
	JsonSchema,
	Schema,
	ToolBinding,
	Warning,
} from "./types.js"

function toolInputSchema(tool: ToolBinding<unknown, unknown>): Schema<unknown> | undefined {
	return tool.__tool?.input as Schema<unknown> | undefined
}

function hasToJsonSchema(input: Schema<unknown> | undefined): input is Schema<unknown> & {
	toJsonSchema: () => JsonSchema
} {
	return typeof input?.toJsonSchema === "function"
}

/**
 * Lint an assembled prompt. Pass `timings` as serialized binding key → last fetch latency (ms).
 */
export function lintAssembly(
	bindings: AnyBinding[],
	segments: AssembledSegments,
	timings: Record<string, number>,
): Warning[] {
	const warnings: Warning[] = []

	const SHORT_STALE_MS = 300_000
	const SLOW_FETCH_MS = 2000

	const dynamicBefore = new Set(
		(segments.segmentation?.dynamicBindingKeysBeforeBreakpoint ?? []).map((k) => serializeKey(k)),
	)

	for (const b of bindings) {
		const keySer = serializeKey(b.__def.key)
		let staleMs = 300_000 // default sentinel
		try {
			staleMs = parseDuration(
				(b.__def.staleTime !== undefined ? b.__def.staleTime : 0) as import("./types.js").Duration,
			)
		} catch {
			// ignore malformed staleTime for this rule
		}

		const placement = b.__def.placement ?? "dynamic"
		if (
			placement === "static" &&
			staleMs < SHORT_STALE_MS &&
			staleMs !== Number.POSITIVE_INFINITY
		) {
			warnings.push({
				code: "static-with-short-stale",
				message: `Static placement binding ${keySer} has staleTime shorter than five minutes (${staleMs}ms), which reduces cache effectiveness.`,
				bindingKey: b.__def.key,
				severity: "warn",
			})
		}

		if (placement === "dynamic" && dynamicBefore.has(keySer)) {
			warnings.push({
				code: "dynamic-in-prefix",
				message: `Dynamic binding ${keySer} appears before the cache breakpoint.`,
				bindingKey: b.__def.key,
				severity: "warn",
			})
		}

		if (placement === "tool") {
			const tb = b as ToolBinding<unknown, unknown>
			const input = toolInputSchema(tb)
			if (!hasToJsonSchema(input)) {
				warnings.push({
					code: "tool-without-schema",
					message: `Tool binding ${keySer} is missing input.toJsonSchema().`,
					bindingKey: b.__def.key,
					severity: "warn",
				})
			}
		}

		const fetchMs = timings[keySer]
		if (fetchMs !== undefined && fetchMs > SLOW_FETCH_MS) {
			warnings.push({
				code: "fetch-slow",
				message: `Binding ${keySer} fetch took ${Math.round(fetchMs)}ms.`,
				bindingKey: b.__def.key,
				severity: "warn",
			})
		}
	}

	return warnings
}
