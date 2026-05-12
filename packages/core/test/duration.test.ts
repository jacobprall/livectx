import { describe, expect, it } from "vitest"
import { InvalidDurationError, parseDuration } from "../src/duration.js"
import type { Duration } from "../src/types.js"

/** Widens arbitrary strings so invalid durations can be type-checked only at runtime by {@link parseDuration}. */
function dur(raw: string): Duration {
	return raw as Duration
}

describe("parseDuration", () => {
	it('maps "Infinity" to positive infinity', () => {
		expect(parseDuration("Infinity")).toBe(Number.POSITIVE_INFINITY)
	})

	it("passes through non-negative finite numbers as milliseconds", () => {
		expect(parseDuration(0)).toBe(0)
		expect(parseDuration(200)).toBe(200)
		expect(parseDuration(3.5)).toBe(3.5)
	})

	it("passes through positive numeric infinity", () => {
		expect(parseDuration(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
	})

	it('parses millisecond suffix "ms"', () => {
		expect(parseDuration("200ms")).toBe(200)
		expect(parseDuration("0ms")).toBe(0)
		expect(parseDuration("1.5ms")).toBe(1.5)
	})

	it('parses second suffix "s"', () => {
		expect(parseDuration("1s")).toBe(1000)
		expect(parseDuration("2.5s")).toBe(2500)
	})

	it('parses minute suffix "m"', () => {
		expect(parseDuration("5m")).toBe(300_000)
		expect(parseDuration("0.5m")).toBe(30_000)
	})

	it('parses hour suffix "h"', () => {
		expect(parseDuration("1h")).toBe(3_600_000)
		expect(parseDuration("2h")).toBe(7_200_000)
	})

	it("trims surrounding whitespace on strings", () => {
		expect(parseDuration(dur("  10s  "))).toBe(10_000)
	})

	it("rejects NaN numbers", () => {
		expect(() => parseDuration(Number.NaN)).toThrow(InvalidDurationError)
	})

	it("rejects negative numbers", () => {
		expect(() => parseDuration(-1)).toThrow(InvalidDurationError)
	})

	it("rejects negative infinity", () => {
		expect(() => parseDuration(Number.NEGATIVE_INFINITY)).toThrow(InvalidDurationError)
	})

	it("rejects empty strings", () => {
		expect(() => parseDuration(dur("   "))).toThrow(InvalidDurationError)
	})

	it("rejects malformed strings", () => {
		expect(() => parseDuration(dur("soon"))).toThrow(InvalidDurationError)
		expect(() => parseDuration(dur("5"))).toThrow(InvalidDurationError)
		expect(() => parseDuration(dur("ms"))).toThrow(InvalidDurationError)
	})

	it("rejects unknown units", () => {
		expect(() => parseDuration(dur("5d"))).toThrow(InvalidDurationError)
	})

	it("rejects negative magnitudes in strings", () => {
		expect(() => parseDuration(dur("-5ms"))).toThrow(InvalidDurationError)
	})

	it("rejects scientific notation strings", () => {
		expect(() => parseDuration(dur("1e2ms"))).toThrow(InvalidDurationError)
	})

	it("sets InvalidDurationError name", () => {
		try {
			parseDuration(-3)
			expect.fail("expected throw")
		} catch (e) {
			expect(e).toBeInstanceOf(InvalidDurationError)
			expect((e as InvalidDurationError).name).toBe("InvalidDurationError")
		}
	})
})
