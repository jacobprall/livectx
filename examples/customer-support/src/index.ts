/**
 * Customer support demo: OpenAI-shaped messages + JIT docs tool.
 * Run: `pnpm --filter @livectx/example-customer-support start`
 */
import { createContextClient, prompt, source, tool, zodToSchema } from "@livectx/core"
import { openaiSink } from "@livectx/sink-openai"
import { z } from "zod"

async function getCustomer(customerId: string) {
	return { id: customerId, name: "Jamie Doe", tier: "pro" as const }
}

async function getTickets(customerId: string) {
	return [
		{ id: "t1", customerId, title: "Billing question", status: "open" as const },
		{ id: "t2", customerId: "x", title: "Old", status: "closed" as const },
	].filter((t) => t.customerId === customerId)
}

const docsStore = new Map<string, string>([
	["refunds", "## Refunds\nPro customers get 30-day refunds."],
	["shipping", "## Shipping\nDomestic 3–5 business days."],
])

async function searchDocs(query: string) {
	const key = query.toLowerCase().includes("refund") ? "refunds" : "shipping"
	return { query, excerpt: docsStore.get(key) ?? "No article." }
}

const customerProfile = source({
	key: ["cs", "customer"],
	placement: "static",
	staleTime: "1h",
	gcTime: "2h",
	fetch: async () => {
		const id =
			typeof process.env.CUSTOMER_ID === "string" && process.env.CUSTOMER_ID
				? process.env.CUSTOMER_ID
				: "cust_1"
		return getCustomer(id)
	},
})

const recentTickets = source({
	key: ["cs", "tickets"],
	dependsOn: { customer: customerProfile },
	staleTime: "2m",
	gcTime: "15m",
	fetch: async ({ customer: c }) => getTickets(c.id),
})

/** JIT-style tool: pulls product docs only when the model asks. */
const productDocs = tool({
	key: ["cs", "tools", "product_docs"],
	name: "product_docs",
	description: "Search internal product documentation",
	input: zodToSchema(z.object({ query: z.string().min(1) })),
	fetch: async ({ query }) => searchDocs(query),
})

const template = prompt`You are a helpful support agent.

Customer:
${customerProfile}

Recent tickets:
${recentTickets}

If you need policy detail, call product_docs.
`

export async function main() {
	const client = createContextClient()
	const sink = openaiSink()
	try {
		const out = await client.assemble({ template, sink, tools: [productDocs] })
		console.log("--- OpenAI-shaped payload ---")
		console.log(JSON.stringify(out, null, 2))
	} finally {
		await client.dispose()
	}
}

main().catch((e) => {
	console.error(e)
	process.exitCode = 1
})
