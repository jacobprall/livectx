import { describe, expect, it } from "vitest"
import { anthropicSink } from "../../sink-anthropic/src/index.js"
import { source } from "../src/binding.js"
import { createContextClient } from "../src/client.js"
import { prompt } from "../src/template.js"

describe("e2e livectx assemble + anthropic sink", () => {
	it("formats prompts with ephemeral cache control trailing static payloads", async () => {
		const policy = source({
			key: ["prompt", "policy"],
			placement: "static",
			staleTime: "1h",
			fetch: async () => "Be concise.",
			gcTime: "2h",
		})

		const userPref = source({
			key: ["prompt", "user"],
			placement: "dynamic",
			staleTime: "10m",
			fetch: async () => "Alice",
			gcTime: "30m",
		})

		const client = createContextClient()
		const payload = await client.assemble({
			template: prompt`SYS ${policy} DATA ${userPref}`,
			sink: anthropicSink(),
		})

		expect(payload.system.at(-1)?.cache_control?.type).toBe("ephemeral")

		expect(payload.messages[0]?.content.length ?? 0).toBeGreaterThan(0)

		await client.dispose()
	})
})
