import type { AnyBinding, Binding, BindingDef, ToolBinding, ToolBindingDef } from "./types.js"

const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function assertNonEmptyKey(key: readonly unknown[]): void {
	if (!Array.isArray(key) || key.length === 0) {
		throw new TypeError("Binding key must be a non-empty array")
	}
}

function shallowFreezeBindingDef<T, Deps extends Record<string, AnyBinding>>(
	def: BindingDef<T, Deps>,
): BindingDef<T, Deps> {
	const keyCopy = Object.freeze([...def.key])
	if (def.dependsOn) {
		Object.freeze(def.dependsOn)
	}
	return Object.freeze({
		...def,
		key: keyCopy,
	})
}

export function source<T, Deps extends Record<string, AnyBinding> = {}>(
	def: BindingDef<T, Deps>,
): Binding<T, Deps> {
	assertNonEmptyKey(def.key)
	if (typeof def.fetch !== "function") {
		throw new TypeError("Binding fetch must be a function")
	}

	const withDefaults: BindingDef<T, Deps> = {
		...def,
		placement: def.placement ?? "dynamic",
		staleTime: def.staleTime ?? 0,
		gcTime: def.gcTime ?? "5m",
	}

	const frozenDef = shallowFreezeBindingDef(withDefaults)

	return {
		__brand: "Binding",
		__def: frozenDef,
	} as Binding<T, Deps>
}

function shallowFreezeToolBindingDef<I, O>(def: ToolBindingDef<I, O>): ToolBindingDef<I, O> {
	const keyCopy = Object.freeze([...def.key])
	return Object.freeze({
		...def,
		key: keyCopy,
	})
}

export function tool<I, O>(def: ToolBindingDef<I, O>): ToolBinding<I, O> {
	assertNonEmptyKey(def.key)

	if (typeof def.name !== "string" || !def.name.trim()) {
		throw new TypeError("Tool name must be a non-empty string")
	}
	if (!TOOL_NAME_RE.test(def.name)) {
		throw new TypeError("Tool name must match ^[a-zA-Z_][a-zA-Z0-9_]*$")
	}

	if (typeof def.description !== "string" || !def.description.trim()) {
		throw new TypeError("Tool description must be a non-empty string")
	}

	if (typeof def.fetch !== "function") {
		throw new TypeError("Tool fetch must be a function")
	}

	if (
		def.input === null ||
		typeof def.input !== "object" ||
		typeof def.input.parse !== "function" ||
		typeof def.input.safeParse !== "function"
	) {
		throw new TypeError("Tool input must be a Schema implementing parse/safeParse")
	}

	const frozenTool = shallowFreezeToolBindingDef(def)

	const bindingDef: BindingDef<O, Record<string, never>> = Object.freeze({
		key: frozenTool.key,
		placement: "tool",
		staleTime: 0,
		gcTime: "5m",
		fetch: async () => undefined as O,
	})

	return {
		__brand: "Binding",
		__def: bindingDef,
		__tool: frozenTool,
	} as ToolBinding<I, O>
}
