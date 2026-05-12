/**
 * Demo 3: Tool Bindings & JIT Pattern — declare tools the model can call on demand.
 *
 * Shows tool() with Zod schemas, the "small inline summary + tool for detail" pattern,
 * and client.executeTool() for running tool calls.
 */
import {
	createContextClient,
	source,
	tool,
	prompt,
	cacheBreakpoint,
	toolList,
	zodToSchema,
} from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"
import { z } from "zod"

// ── Inline summary (always in context, small) ──────────────────────────────

const serviceSummary = source({
	key: ["service-summary"],
	placement: "dynamic",
	fetch: async () => ({
		total: 12,
		healthy: 10,
		degraded: 1,
		down: 1,
	}),
	render: (s) =>
		`${s.total} services: ${s.healthy} healthy, ${s.degraded} degraded, ${s.down} down`,
})

// ── Tool for detail (model calls when it needs depth) ──────────────────────

const serviceDetails = tool({
	key: ["tools", "service_details"],
	name: "get_service_details",
	description:
		"Get detailed info for a specific service including health, deployments, and recent logs",
	input: zodToSchema(
		z.object({
			serviceId: z.string().describe("The service identifier"),
			includeLog: z
				.boolean()
				.default(false)
				.describe("Whether to include recent log lines"),
		}),
	),
	fetch: async ({ serviceId, includeLog }) => ({
		id: serviceId,
		name: serviceId === "svc_api" ? "api-gateway" : "worker",
		status: serviceId === "svc_api" ? "healthy" : "down",
		lastDeployed: "2025-06-01T14:30:00Z",
		logs: includeLog
			? ["[INFO] Request handled", "[ERROR] Connection timeout"]
			: undefined,
	}),
})

const restartService = tool({
	key: ["tools", "restart_service"],
	name: "restart_service",
	description: "Restart a service by ID. Use when the service is unhealthy.",
	input: zodToSchema(
		z.object({
			serviceId: z.string(),
			force: z.boolean().default(false),
		}),
	),
	fetch: async ({ serviceId, force }) => ({
		success: true,
		serviceId,
		message: force
			? `Force-restarted ${serviceId}`
			: `Gracefully restarted ${serviceId}`,
	}),
})

// ── Template: summary inline, tools available on demand ────────────────────

const template = prompt`You are an infrastructure assistant.

Service overview: ${serviceSummary}

${cacheBreakpoint()}

Available tools for detailed investigation:
${toolList([serviceDetails, restartService])}

The user has reported an issue. Investigate using available tools.`

console.log("╔══════════════════════════════════════════╗")
console.log("║  Demo 3: Tool Bindings & JIT Pattern     ║")
console.log("╚══════════════════════════════════════════╝\n")

const client = createContextClient()

const result = await client.assemble({
	template,
	sink: anthropicSink(),
	tools: [serviceDetails, restartService],
})

console.log("── Inline context (always present) ──")
for (const msg of result.messages) {
	for (const c of msg.content) {
		const lines = c.text.split("\n").filter((l) => l.trim())
		for (const line of lines.slice(0, 3)) {
			console.log(`  ${line}`)
		}
	}
}

console.log("\n── Tools available to the model ──")
for (const t of result.tools) {
	console.log(`  ${t.name}: ${t.description}`)
	console.log(`    input_schema: ${JSON.stringify(t.input_schema).slice(0, 100)}...`)
}

// Simulate the model calling a tool
console.log("\n── Simulating tool execution ──")

console.log("  Model calls: get_service_details({ serviceId: 'svc_worker', includeLogs: true })")
const detailResult = await client.executeTool("get_service_details", {
	serviceId: "svc_worker",
	includeLog: true,
})
console.log(`  Result: ${JSON.stringify(detailResult)}`)

console.log("\n  Model calls: restart_service({ serviceId: 'svc_worker' })")
const restartResult = await client.executeTool("restart_service", {
	serviceId: "svc_worker",
	force: false,
})
console.log(`  Result: ${JSON.stringify(restartResult)}`)

console.log("\n── JIT advantage ──")
console.log("  Summary is always in context (tiny: ~20 tokens)")
console.log("  Full service details only fetched when the model asks")
console.log("  This saves context window space while keeping the model grounded\n")

await client.dispose()
