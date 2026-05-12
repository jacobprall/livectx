/**
 * Demo 2: Caching & Invalidation — SWR semantics, dedup, and prefix stability.
 *
 * Shows that assembling twice with the same bindings uses cached values,
 * and that invalidation triggers re-fetches.
 */
import {
	createContextClient,
	source,
	prompt,
	cacheBreakpoint,
	rawSink,
} from "@livectx/core"

let fetchCount = 0

const config = source({
	key: ["config"],
	placement: "static",
	staleTime: "10m",
	fetch: async () => {
		fetchCount++
		return { version: "3.2.1", environment: "production" }
	},
})

const liveMetrics = source({
	key: ["metrics"],
	placement: "dynamic",
	staleTime: 0,
	fetch: async () => {
		fetchCount++
		return {
			requestsPerSec: Math.floor(Math.random() * 1000),
			errorRate: (Math.random() * 2).toFixed(2) + "%",
			timestamp: new Date().toISOString(),
		}
	},
})

const template = prompt`System config: ${config}
${cacheBreakpoint()}
Live metrics: ${liveMetrics}`

console.log("╔══════════════════════════════════════════╗")
console.log("║  Demo 2: Caching & Invalidation          ║")
console.log("╚══════════════════════════════════════════╝\n")

const client = createContextClient()
const sink = rawSink()

// First assembly — cold cache, both bindings fetched
fetchCount = 0
const first = await client.assemble({ template, sink })
console.log(`── Assembly 1 (cold cache) ──`)
console.log(`  Fetches triggered: ${fetchCount}`)
for (const [key, bm] of Object.entries(first.metrics.bindings)) {
	console.log(`  ${key}: source=${bm.source}`)
}

// Second assembly — config is fresh (10m staleTime), metrics is stale (0 staleTime)
fetchCount = 0
const second = await client.assemble({ template, sink })
console.log(`\n── Assembly 2 (warm cache) ──`)
console.log(`  Fetches triggered: ${fetchCount}`)
for (const [key, bm] of Object.entries(second.metrics.bindings)) {
	console.log(`  ${key}: source=${bm.source}`)
}
console.log("  → config served from cache (still fresh)")
console.log("  → metrics re-fetched (staleTime=0)")

// Invalidate config and reassemble
console.log(`\n── Invalidate ["config"] ──`)
await client.invalidate(["config"])
fetchCount = 0
const third = await client.assemble({ template, sink })
console.log(`  Fetches triggered: ${fetchCount}`)
for (const [key, bm] of Object.entries(third.metrics.bindings)) {
	console.log(`  ${key}: source=${bm.source}`)
}
console.log("  → config re-fetched after invalidation")

// Demonstrate static text stability for prefix caching
console.log("\n── Prefix stability ──")
console.log(`  Static text (first):  "${first.staticText.slice(0, 60)}..."`)
console.log(`  Static text (second): "${second.staticText.slice(0, 60)}..."`)
const prefixStable = first.staticText === second.staticText
console.log(`  Byte-identical: ${prefixStable} → LLM prefix cache hit ✓`)

// Dedup demo — fire 5 concurrent assemblies
console.log("\n── Concurrent dedup ──")
fetchCount = 0
await client.invalidate({ prefix: [] })
const concurrent = await Promise.all(
	Array.from({ length: 5 }, () => client.assemble({ template, sink })),
)
console.log(`  5 concurrent assemblies triggered ${fetchCount} fetches (deduped)`)
console.log(`  All returned valid output: ${concurrent.every((r) => r.staticText.length > 0)}\n`)

await client.dispose()
