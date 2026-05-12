import type { BindingDef, Schema, ToolBinding, ToolBindingDef } from "../src/types.js"

export function trivialSchema(): Schema<unknown> {
	return {
		parse: (input: unknown) => input,
		safeParse: (input: unknown) => ({ success: true as const, data: input }),
	}
}

/** Minimal {@link ToolBinding} for template tests (no runtime client wiring). */
export function dummyToolBinding(name = "demo"): ToolBinding<unknown, unknown> {
	const toolDef: ToolBindingDef<unknown, unknown> = {
		key: ["tools", name],
		name,
		description: `${name} tool`,
		input: trivialSchema(),
		fetch: async () => undefined,
	}
	const bindingDef: BindingDef<unknown, Record<string, never>> = {
		key: toolDef.key,
		fetch: async () => undefined,
		placement: "tool",
	}
	return {
		__brand: "Binding",
		__def: bindingDef,
		__tool: toolDef,
	} as ToolBinding<unknown, unknown>
}
