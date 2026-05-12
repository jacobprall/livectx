import type { JsonSchema, Schema } from "@livectx/core"

function typeOfValue(v: unknown): string {
	if (v === null) {
		return "null"
	}
	if (Array.isArray(v)) {
		return "array"
	}
	return typeof v
}

function validateAgainstSchema(
	schema: Record<string, unknown>,
	input: unknown,
	path: string,
): void {
	const t = schema.type
	if (t === undefined) {
		return
	}
	if (typeof t !== "string") {
		throw new TypeError(`Invalid schema at ${path}: type must be a string`)
	}

	const actual = typeOfValue(input)
	if (t === "array") {
		if (!Array.isArray(input)) {
			throw new TypeError(`Expected array at ${path}, got ${actual}`)
		}
		const itemSchema = schema.items as Record<string, unknown> | undefined
		if (itemSchema && typeof itemSchema === "object") {
			input.forEach((el, i) => {
				validateAgainstSchema(itemSchema, el, `${path}[${String(i)}]`)
			})
		}
		return
	}

	if (t === "object") {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new TypeError(`Expected object at ${path}, got ${actual}`)
		}
		const props = schema.properties as Record<string, Record<string, unknown>> | undefined
		const required = schema.required as string[] | undefined
		for (const key of required ?? []) {
			if (!Object.prototype.hasOwnProperty.call(input, key)) {
				throw new TypeError(`Missing required property ${path}.${key}`)
			}
		}
		if (props) {
			for (const [key, sub] of Object.entries(props)) {
				if (sub && typeof sub === "object" && Object.prototype.hasOwnProperty.call(input, key)) {
					validateAgainstSchema(sub, (input as Record<string, unknown>)[key], `${path}.${key}`)
				}
			}
		}
		return
	}

	const expectedPrimitive = t
	if (expectedPrimitive === "number" && actual !== "number") {
		throw new TypeError(`Expected number at ${path}, got ${actual}`)
	}
	if (expectedPrimitive === "string" && actual !== "string") {
		throw new TypeError(`Expected string at ${path}, got ${actual}`)
	}
	if (expectedPrimitive === "boolean" && actual !== "boolean") {
		throw new TypeError(`Expected boolean at ${path}, got ${actual}`)
	}
	if (expectedPrimitive === "null" && actual !== "null") {
		throw new TypeError(`Expected null at ${path}, got ${actual}`)
	}
	if (
		["number", "string", "boolean", "null"].includes(expectedPrimitive) &&
		actual !== expectedPrimitive
	) {
		throw new TypeError(`Expected ${expectedPrimitive} at ${path}, got ${actual}`)
	}
}

/**
 * Builds a minimal {@link Schema} from a JSON Schema–like object using shallow structural checks.
 */
export function jsonSchemaToSchema(js: Record<string, unknown>): Schema<unknown> {
	return {
		parse(input: unknown): unknown {
			validateAgainstSchema(js, input, "$")
			return input
		},
		safeParse(input: unknown): { success: true; data: unknown } | { success: false; error: Error } {
			try {
				return { success: true, data: this.parse(input) }
			} catch (e) {
				return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
			}
		},
		toJsonSchema(): JsonSchema {
			return js as JsonSchema
		},
	}
}
