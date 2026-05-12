import type { Template, TemplateValue, ToolBinding } from "./types.js"

export function prompt(strings: TemplateStringsArray, ...values: TemplateValue[]): Template {
	return {
		strings: Array.from(strings),
		values,
	}
}

export function cacheBreakpoint(opts?: { ttl?: "5m" | "1h" }): TemplateValue {
	return { __marker: "cache-breakpoint", ...opts }
}

export function toolList(tools: readonly ToolBinding<any, any>[]): TemplateValue {
	return { __marker: "tool-list", tools }
}
