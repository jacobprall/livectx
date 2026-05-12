import { bench, describe } from "vitest"
import { serializeKey } from "../../src/key.js"

describe("key serialization", () => {
	const keys = Array.from({ length: 1000 }, (_, i) => ["livectx", "bench", "key", i] as const)

	bench("10k key serializations", () => {
		for (let r = 0; r < 10; r++) {
			for (const k of keys) {
				serializeKey(k)
			}
		}
	})
})
