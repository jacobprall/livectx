import type { Duration } from "./types.js"

export class InvalidDurationError extends Error {
	override readonly name = "InvalidDurationError"

	/** Supports optional {@link ErrorOptions} such as `cause` for chaining. */
	// biome-ignore lint/complexity/noUselessConstructor: forwards ErrorOptions to Error
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
	}
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/u

/** Parses a {@link Duration} into milliseconds, or `Infinity` / `0` where applicable. */
export function parseDuration(d: Duration): number {
	if (d === "Infinity") {
		return Number.POSITIVE_INFINITY
	}

	if (typeof d === "number") {
		if (Number.isNaN(d)) {
			throw new InvalidDurationError("Duration cannot be NaN")
		}
		if (d === Number.NEGATIVE_INFINITY) {
			throw new InvalidDurationError("Duration cannot be negative infinity")
		}
		if (d < 0) {
			throw new InvalidDurationError(`Duration cannot be negative: ${String(d)}`)
		}
		return d
	}

	const raw = typeof d === "string" ? d.trim() : ""
	if (raw === "") {
		throw new InvalidDurationError("Duration string cannot be empty")
	}

	const match = DURATION_RE.exec(raw)
	if (!match) {
		throw new InvalidDurationError(`Invalid duration format: ${JSON.stringify(raw)}`)
	}

	const n = Number(match[1])
	const unit = match[2]

	if (!Number.isFinite(n) || n < 0) {
		throw new InvalidDurationError(`Invalid numeric magnitude in duration: ${JSON.stringify(raw)}`)
	}

	if (unit === "ms") {
		return n
	}
	if (unit === "s") {
		return n * 1000
	}
	if (unit === "m") {
		return n * 60 * 1000
	}
	return n * 60 * 60 * 1000
}
