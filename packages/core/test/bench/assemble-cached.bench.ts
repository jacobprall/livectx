import { beforeAll, bench, describe } from "vitest"
import { createContextClient, rawSink, source } from "../../src/index.js"
import type { Template } from "../../src/types.js"

describe("assembly", () => {
	const client = createContextClient()
	const bindings = Array.from({ length: 10 }, (_, i) =>
		source({
			key: ["bench", "cached", i],
			placement: "static",
			staleTime: "1h",
			fetch: async () => `slot-${i}`,
			gcTime: "1h",
		}),
	)
	const strings = ["", ...Array.from({ length: 10 }, () => "|"), ""] as unknown as readonly string[]
	const template: Template = { strings, values: bindings }

	beforeAll(async () => {
		for (const b of bindings) {
			await client.prefetch(b)
		}
	})

	bench("10 cached bindings", async () => {
		await client.assemble({ template, sink: rawSink() })
	})
})
