import type { BindingKey, KeyAtom, KeyMatcher } from "./types.js"

function serializeAtom(atom: KeyAtom): string {
	if (atom === null) {
		return "null"
	}

	const t = typeof atom
	if (t === "string") {
		return JSON.stringify(atom)
	}
	if (t === "number" || t === "boolean") {
		return JSON.stringify(atom)
	}

	const obj = atom as { [k: string]: KeyAtom }
	const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	let out = "{"
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i]
		if (k === undefined) {
			throw new Error("serializeAtom invariant violated: missing object key")
		}
		if (i > 0) {
			out += ","
		}
		const child = obj[k]
		out += `${JSON.stringify(k)}:${serializeAtom(child)}`
	}
	out += "}"
	return out
}

/** Deterministic serialization for binding keys (sorted object keys at every level). */
export function serializeKey(key: BindingKey): string {
	let out = "["
	for (let i = 0; i < key.length; i++) {
		if (i > 0) {
			out += ","
		}
		const atom = key[i]
		if (atom === undefined) {
			throw new Error("serializeKey invariant violated: missing segment")
		}
		out += serializeAtom(atom)
	}
	out += "]"
	return out
}

export function keysEqual(a: BindingKey, b: BindingKey): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		const ai = a[i]
		const bi = b[i]
		if (ai === bi) continue
		if (typeof ai !== typeof bi) return false
		if (typeof ai === "object" || typeof bi === "object") {
			return serializeKey(a) === serializeKey(b)
		}
		return false
	}
	return true
}

function prefixMatches(key: BindingKey, prefix: BindingKey): boolean {
	if (prefix.length > key.length) {
		return false
	}
	return keysEqual(key.slice(0, prefix.length), prefix)
}

export function matchKey(key: BindingKey, matcher: KeyMatcher): boolean {
	if ("exact" in matcher) {
		return keysEqual(key, matcher.exact)
	}
	if ("prefix" in matcher) {
		return prefixMatches(key, matcher.prefix)
	}
	return matcher.predicate(key)
}

export function isKeyMatcher(value: unknown): value is KeyMatcher {
	if (!value || typeof value !== "object") {
		return false
	}

	const v = value as Record<string, unknown>
	if ("exact" in v && Array.isArray(v.exact)) {
		return true
	}
	if ("prefix" in v && Array.isArray(v.prefix)) {
		return true
	}
	return "predicate" in v && typeof v.predicate === "function"
}
