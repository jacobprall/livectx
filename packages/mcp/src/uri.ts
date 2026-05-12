import type { BindingKey, KeyAtom } from "@livectx/core"

/**
 * Canonical JSON for object atoms (deterministic sorted keys) so URIs remain stable.
 */
function canonicalJsonForAtom(atom: Exclude<KeyAtom, string | number | boolean | null>): string {
	function sortKeysDeep(v: unknown): unknown {
		if (v !== null && typeof v === "object" && !Array.isArray(v)) {
			const o = v as Record<string, unknown>
			const keys = Object.keys(o).sort()
			const out: Record<string, unknown> = {}
			for (const k of keys) {
				out[k] = sortKeysDeep(o[k])
			}
			return out
		}
		if (Array.isArray(v)) {
			return v.map(sortKeysDeep)
		}
		return v
	}
	return JSON.stringify(sortKeysDeep(atom))
}

/** Key atom → encoded single path segment (slashes become %2F). */
function slugPathSegment(atom: KeyAtom): string {
	if (atom === null) {
		return "null"
	}
	if (typeof atom === "string") {
		return encodeURIComponent(atom)
	}
	if (typeof atom === "number" || typeof atom === "boolean") {
		return encodeURIComponent(String(atom))
	}
	return encodeURIComponent(
		canonicalJsonForAtom(atom as Exclude<KeyAtom, string | number | boolean | null>),
	)
}

/** Key to URI: `["project", "p_42"]` → `livectx://project/p_42` */
export function bindingKeyToUri(key: BindingKey): string {
	const segments = key.map((atom: KeyAtom) => slugPathSegment(atom))
	return `livectx://${segments.join("/")}`
}

function parseUriSegment(seg: string): KeyAtom {
	if (seg === "null") {
		return null
	}
	let decoded = seg
	try {
		decoded = decodeURIComponent(seg)
	} catch {
		decoded = seg
	}

	try {
		const parsed = JSON.parse(decoded) as unknown
		if (
			parsed === null ||
			typeof parsed === "number" ||
			typeof parsed === "boolean" ||
			(typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed) &&
				Object.keys(parsed as object).every((k) => typeof k === "string"))
		) {
			return parsed as KeyAtom
		}
	} catch {
		//
	}
	return decoded
}

/** URI to key: `livectx://project/p_42` → `["project", "p_42"]` */
export function uriToBindingKey(uri: string): BindingKey {
	const prefix = "livectx://"
	if (!uri.startsWith(prefix)) {
		throw new Error(`Invalid livectx URI: ${uri}`)
	}
	const path = uri.slice(prefix.length)
	if (!path) {
		return []
	}
	return path.split("/").map(parseUriSegment)
}
