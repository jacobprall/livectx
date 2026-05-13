import type { JsonSchema, Schema } from "./types.js"

const MAX_SCHEMA_UNWRAP_DEPTH = 48

interface ZodDef {
	typeName?: string
	shape?: () => Record<string, ZodLike<unknown>>
	innerType?: ZodLike<unknown>
	type?: ZodLike<unknown>
	schema?: ZodLike<unknown>
	description?: string
	values?: string[]
	defaultValue?: () => unknown
}

/** Structural subset of Zod schemas; avoids a hard dependency on `zod` at runtime. */
export interface ZodLike<T = unknown> {
	parse(input: unknown): T
	safeParse(
		input: unknown,
	): { success: true; data: T } | { success: false; error: { message: string } }
	_def?: ZodDef
	_toJSONSchema?: () => JsonSchema
	_toJsonSchema?: () => JsonSchema
}

function typeName(z: ZodLike<unknown>): string | undefined {
	return z._def?.typeName
}

function unwrapForSchema(z: ZodLike<unknown>): ZodLike<unknown> {
	let cur: ZodLike<unknown> = z
	for (let guard = 0; guard < MAX_SCHEMA_UNWRAP_DEPTH; guard++) {
		const tn = typeName(cur)
		if (tn === "ZodEffects" && cur._def?.schema) {
			cur = cur._def.schema
			continue
		}
		if (tn === "ZodBranded" && cur._def?.type) {
			cur = cur._def.type
			continue
		}
		if (tn === "ZodPipeline" || tn === "ZodCatch") {
			const inner =
				cur._def && "in" in cur._def
					? (cur._def as { in: ZodLike<unknown> }).in
					: cur._def && "schema" in (cur._def as object)
						? (cur._def as { schema: ZodLike<unknown> }).schema
						: undefined
			if (inner) {
				cur = inner
				continue
			}
		}
		break
	}
	return cur
}

function getShape(z: ZodLike<unknown>): Record<string, ZodLike<unknown>> | undefined {
	const raw = unwrapForSchema(z)
	if (typeName(raw) !== "ZodObject") {
		return undefined
	}
	const candidate = raw as unknown as { shape?: Record<string, ZodLike<unknown>> }
	const shaped =
		typeof candidate.shape === "object" && candidate.shape !== null ? candidate.shape : undefined
	if (shaped) {
		return shaped
	}
	const fnShape = raw._def?.shape
	if (typeof fnShape === "function") {
		return fnShape.call(raw) as Record<string, ZodLike<unknown>>
	}
	return undefined
}

function extractDescription(z: ZodLike<unknown>): string | undefined {
	const d = unwrapForSchema(z)._def?.description
	return typeof d === "string" && d.trim() ? d.trim() : undefined
}

/** Best-effort JSON Schema from commonly used Zod shapes (no npm zod dependency). */
export function zodToJsonSchema(zodSchema: ZodLike<unknown>): JsonSchema {
	const extra = zodSchema as unknown as { toJSONSchema?: () => JsonSchema }
	const delegate =
		zodSchema._toJsonSchema ??
		zodSchema._toJSONSchema ??
		(typeof extra.toJSONSchema === "function" ? extra.toJSONSchema : undefined)

	if (typeof delegate === "function") {
		return (delegate as () => JsonSchema).call(zodSchema)
	}

	return shapeToJsonSchema(zodSchema, new Set<string>())
}

function shapeToJsonSchema(zodSchema: ZodLike<unknown>, visiting: Set<string>): JsonSchema {
	const zod = unwrapForSchema(zodSchema)
	const tn = typeName(zod)

	if (!tn || tn === "ZodNever") {
		return { type: "object", additionalProperties: false }
	}

	if (tn === "ZodString") {
		const js: JsonSchema = { type: "string" }
		const desc = extractDescription(zod)
		if (desc) js.description = desc
		return js
	}

	if (tn === "ZodNumber" || tn === "ZodNaN") {
		const js: JsonSchema = { type: "number" }
		const desc = extractDescription(zod)
		if (desc) js.description = desc
		return js
	}

	if (tn === "ZodBoolean") {
		const js: JsonSchema = { type: "boolean" }
		const desc = extractDescription(zod)
		if (desc) js.description = desc
		return js
	}

	if (tn === "ZodEnum") {
		const vals = zod._def?.values
		const js: JsonSchema = {
			type: "string",
			enum: [...(vals ?? [])],
		}
		const desc = extractDescription(zod)
		if (desc) js.description = desc
		return js
	}

	if (tn === "ZodArray") {
		const el = zod._def?.type ?? (zod as { element?: ZodLike<unknown> }).element
		const items =
			el && typeof el.parse === "function"
				? shapeToJsonSchema(el, visiting)
				: ({ type: "string" } as JsonSchema)
		const js: JsonSchema = {
			type: "array",
			items,
		}
		const desc = extractDescription(zod)
		if (desc) js.description = desc
		return js
	}

	if (tn === "ZodObject") {
		const shape = getShape(zod)
		if (!shape) {
			return { type: "object", additionalProperties: true }
		}

		const properties: Record<string, JsonSchema> = {}
		const requiredSet = new Set(Object.keys(shape))

		for (const [key, child] of Object.entries(shape)) {
			const refKey = `_obj:${key}`
			let leaf: ZodLike<unknown> = child
			let defVal: unknown | undefined

			let cycleGuard = 0
			while (cycleGuard++ < MAX_SCHEMA_UNWRAP_DEPTH) {
				const ctn = typeName(leaf)

				if (ctn === "ZodOptional" || ctn === "ZodNullable" || ctn === "ZodReadonly") {
					requiredSet.delete(key)
					const next = leaf._def?.innerType
					if (next) leaf = next
					else break
					continue
				}

				if (ctn === "ZodDefault") {
					requiredSet.delete(key)
					try {
						defVal = leaf._def?.defaultValue?.()
					} catch {
						defVal = undefined
					}
					const inner = leaf._def?.innerType
					if (inner) leaf = inner
					else break
					continue
				}

				break
			}

			if (visiting.has(refKey)) {
				continue
			}
			const nextVisit = new Set(visiting)
			nextVisit.add(refKey)

			let propSchema = shapeToJsonSchema(leaf, nextVisit)

			if (defVal !== undefined) {
				propSchema = { ...propSchema, default: defVal }
			}

			properties[key] = propSchema
		}

		const required = [...requiredSet]
		const root: JsonSchema = {
			type: "object",
			properties,
			...(required.length ? { required } : {}),
		}
		const desc = extractDescription(zod)
		if (desc) root.description = desc
		return root
	}

	return { type: "object", additionalProperties: true }
}

export function zodToSchema<T>(zodSchema: ZodLike<T>): Schema<T> {
	return {
		parse: (input: unknown) => zodSchema.parse(input),
		safeParse: (input: unknown) => {
			const r = zodSchema.safeParse(input)
			if (r.success) {
				return { success: true as const, data: r.data }
			}
			const err = new Error(
				"message" in r.error && typeof r.error.message === "string"
					? r.error.message
					: "Validation failed",
			)
			return { success: false as const, error: err }
		},
		toJsonSchema: () => zodToJsonSchema(zodSchema as ZodLike<unknown>),
	}
}
