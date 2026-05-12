/**
 * Demo 1: Basics — declare bindings, assemble a prompt, get SDK-ready output.
 *
 * This shows the core loop: source() → prompt`` → client.assemble() → SDK-shaped output.
 * No API keys needed — everything uses mock data.
 */
import {
	createContextClient,
	source,
	prompt,
	cacheBreakpoint,
} from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"

// ── Mock data (replace with real API calls in production) ──────────────────

const project = source({
	key: ["project", "acme"],
	placement: "static",
	staleTime: "1h",
	fetch: async () => ({
		id: "proj_1",
		name: "Acme Cloud",
		region: "us-east-1",
		owner: "alice@acme.io",
	}),
})

const services = source({
	key: ["services", "acme"],
	placement: "dynamic",
	dependsOn: { project },
	fetch: async ({ project: p }) => [
		{ name: "api-gateway", status: "healthy", projectId: p.id },
		{ name: "worker", status: "degraded", projectId: p.id },
		{ name: "database", status: "healthy", projectId: p.id },
	],
})

const alerts = source({
	key: ["alerts"],
	placement: "dynamic",
	fetch: async () => [
		{ severity: "warning", message: "Worker latency elevated (p99 > 2s)" },
	],
})

// ── Template — write it like you'd write the prompt ────────────────────────

const userQuestion = "Why is the worker slow?"

const template = prompt`You are an infrastructure management agent for cloud deployments.

Project info:
${project}

${cacheBreakpoint({ ttl: "5m" })}

Current services:
${services}

Active alerts:
${alerts}

User question: ${userQuestion}`

// ── Assemble and inspect ───────────────────────────────────────────────────

const client = createContextClient()

const result = await client.assemble({
	template,
	sink: anthropicSink(),
})

console.log("╔══════════════════════════════════════════╗")
console.log("║  Demo 1: Basic Binding + Assembly        ║")
console.log("╚══════════════════════════════════════════╝\n")

console.log("── System blocks (cached prefix) ──")
for (const block of result.system) {
	console.log(`  [${block.cache_control ? "CACHED" : "text"}] ${block.text.slice(0, 120)}...`)
}

console.log("\n── User message (dynamic) ──")
for (const msg of result.messages) {
	for (const c of msg.content) {
		console.log(`  ${c.text.slice(0, 200)}...`)
	}
}

console.log("\n── Prompt metrics ──")
const m = result.metrics.prompt
console.log(`  Static tokens:  ${m.staticTokens}`)
console.log(`  Dynamic tokens: ${m.dynamicTokens}`)
console.log(`  Total tokens:   ${m.totalTokens}`)
console.log(`  Cache hit expected: ${m.expectedCacheHit}`)
console.log(`  Assembly time:  ${result.metrics.durationMs}ms`)

console.log("\n── Per-binding breakdown ──")
for (const [key, bm] of Object.entries(result.metrics.bindings)) {
	console.log(`  ${key}: source=${bm.source}, tokens=${bm.tokens}, latency=${bm.latencyMs ?? "n/a"}ms`)
}

console.log("\n✓ This output is directly passable to anthropic.messages.create()")
console.log("  result.system → system parameter")
console.log("  result.messages → messages parameter\n")

await client.dispose()
