import { describe, expect, it } from "vitest"
import { source } from "../src/binding.js"
import { cacheBreakpoint, prompt, toolList } from "../src/template.js"
import { dummyToolBinding } from "./helpers.js"

describe("prompt", () => {
	it("captures literal segments and interpolated bindings", () => {
		const userCount = source({
			key: ["metrics", "users"],
			fetch: () => 3,
		})
		const tpl = prompt`Active users: ${userCount} today`
		expect(tpl.strings).toEqual(["Active users: ", " today"])
		expect(tpl.values).toHaveLength(1)
		expect(tpl.values[0]).toBe(userCount)
	})

	it("supports cache breakpoint markers", () => {
		const bp = cacheBreakpoint({ ttl: "5m" })
		const tpl = prompt`before${bp}after`
		expect(tpl.values[0]).toEqual({ __marker: "cache-breakpoint", ttl: "5m" })
	})

	it("supports mixed primitives with bindings", () => {
		const flag = source({
			key: ["flag"],
			fetch: () => true,
		})
		const tpl = prompt`name=${"ada"} count=${42} ok=${true} flag=${flag}`
		expect(tpl.values).toEqual(["ada", 42, true, flag])
	})

	it("handles empty templates", () => {
		const tpl = prompt``
		expect(tpl.strings).toEqual([""])
		expect(tpl.values).toEqual([])
	})

	it("preserves insertion order for interpolations", () => {
		const a = source({ key: ["a"], fetch: () => "A" })
		const b = source({ key: ["b"], fetch: () => "B" })
		const c = source({ key: ["c"], fetch: () => "C" })
		const tpl = prompt`${a}:${b}:${c}`
		expect(
			tpl.values.map((v) => (typeof v === "object" && v && "__def" in v ? v.__def.key[0] : v)),
		).toEqual(["a", "b", "c"])
	})

	it("records sequential literals between holes", () => {
		const mid = source({ key: ["mid"], fetch: () => 0 })
		const tpl = prompt`start-${mid}-end`
		expect(tpl.strings).toEqual(["start-", "-end"])
		expect(tpl.values).toEqual([mid])
	})
})

describe("cacheBreakpoint", () => {
	it("defaults ttl to undefined", () => {
		expect(cacheBreakpoint()).toEqual({ __marker: "cache-breakpoint" })
	})

	it("records ttl variants", () => {
		expect(cacheBreakpoint({ ttl: "5m" })).toEqual({ __marker: "cache-breakpoint", ttl: "5m" })
		expect(cacheBreakpoint({ ttl: "1h" })).toEqual({ __marker: "cache-breakpoint", ttl: "1h" })
	})
})

describe("toolList", () => {
	it("wraps tools for template emission", () => {
		const tools = [dummyToolBinding("echo"), dummyToolBinding("lint")] as const
		expect(toolList(tools)).toEqual({ __marker: "tool-list", tools })
	})

	it("allows empty tool collections", () => {
		expect(toolList([])).toEqual({ __marker: "tool-list", tools: [] })
	})
})
