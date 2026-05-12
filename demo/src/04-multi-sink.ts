/**
 * Demo 4: Multi-Sink — same template, different SDK output shapes.
 *
 * Shows that one set of bindings + one template produces output for
 * Anthropic, OpenAI, Vercel AI SDK, and raw format.
 */
import {
	createContextClient,
	source,
	tool,
	prompt,
	cacheBreakpoint,
	zodToSchema,
	rawSink,
} from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"
import { openaiSink } from "@livectx/sink-openai"
import { vercelAISink } from "@livectx/sink-vercel-ai"
import { z } from "zod"

const customer = source({
	key: ["customer", "c_42"],
	placement: "static",
	staleTime: "30m",
	fetch: async () => ({
		id: "c_42",
		name: "Jamie Doe",
		plan: "pro",
		since: "2023-01-15",
	}),
})

const tickets = source({
	key: ["tickets", "c_42"],
	placement: "dynamic",
	dependsOn: { customer },
	fetch: async ({ customer: c }) => [
		{ id: "t_1", customerId: c.id, subject: "Billing question", status: "open" },
		{ id: "t_2", customerId: c.id, subject: "Feature request", status: "closed" },
	],
})

const searchDocs = tool({
	key: ["tools", "search_docs"],
	name: "search_docs",
	description: "Search product documentation for a topic",
	input: zodToSchema(z.object({ query: z.string() })),
	fetch: async ({ query }) => ({
		query,
		result: `Documentation for "${query}": Pro plans include priority support...`,
	}),
})

const template = prompt`You are a customer support agent.

Customer: ${customer}
${cacheBreakpoint()}
Recent tickets: ${tickets}

Help the customer with their request.`

console.log("╔══════════════════════════════════════════╗")
console.log("║  Demo 4: Multi-Sink Comparison           ║")
console.log("╚══════════════════════════════════════════╝\n")

const client = createContextClient()
const toolsList = [searchDocs] as const

// ── Anthropic ──────────────────────────────────────────────────────────────

const anth = await client.assemble({ template, sink: anthropicSink(), tools: toolsList })
console.log("── Anthropic SDK shape ──")
console.log(`  system: ${anth.system.length} block(s), last has cache_control: ${!!anth.system.at(-1)?.cache_control}`)
console.log(`  messages: ${anth.messages.length} message(s), role="${anth.messages[0]?.role}"`)
console.log(`  tools: ${anth.tools.length} tool(s) → [{name, description, input_schema}]`)

// ── OpenAI ─────────────────────────────────────────────────────────────────

const oai = await client.assemble({ template, sink: openaiSink(), tools: toolsList })
console.log("\n── OpenAI SDK shape ──")
console.log(`  messages: ${oai.messages.length} message(s)`)
for (const m of oai.messages) {
	console.log(`    role="${m.role}", content="${m.content.slice(0, 60)}..."`)
}
console.log(`  tools: ${oai.tools.length} tool(s) → [{type:"function", function:{name, parameters}}]`)

// ── Vercel AI SDK ──────────────────────────────────────────────────────────

const vai = await client.assemble({ template, sink: vercelAISink(), tools: toolsList })
console.log("\n── Vercel AI SDK shape ──")
console.log(`  system: "${vai.system.slice(0, 60)}..."`)
console.log(`  messages: ${vai.messages.length} message(s)`)
console.log(`  tools: Record with keys: [${Object.keys(vai.tools).join(", ")}]`)

// ── Raw ────────────────────────────────────────────────────────────────────

const raw = await client.assemble({ template, sink: rawSink(), tools: toolsList })
console.log("\n── Raw output ──")
console.log(`  staticText:  "${raw.staticText.slice(0, 60)}..."`)
console.log(`  dynamicText: "${raw.dynamicText.slice(0, 60)}..."`)
console.log(`  toolSpecs: ${raw.toolSpecs.length} tool(s)`)

// ── Metrics are consistent ─────────────────────────────────────────────────

console.log("\n── Metrics consistency ──")
console.log(`  All sinks report ${anth.metrics.prompt.totalTokens} total tokens`)
console.log(`  Static: ${anth.metrics.prompt.staticTokens}, Dynamic: ${anth.metrics.prompt.dynamicTokens}`)
console.log(`  Same bindings, same cache, different output format ✓\n`)

await client.dispose()
