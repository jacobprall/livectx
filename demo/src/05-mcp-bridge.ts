/**
 * Demo 5: MCP Bridge — expose bindings as an MCP server, consume from another client.
 *
 * This demonstrates the bidirectional flywheel: write bindings once for your own
 * prompts, then expose them as an MCP server for other agents to consume.
 */
import {
	createContextClient,
	source,
	tool,
	zodToSchema,
} from "@livectx/core"
import {
	LivectxMcpRuntime,
	bindingKeyToUri,
	createConfiguredMcpServer,
	mcpClientWithTransport,
} from "@livectx/mcp"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"

console.log("╔══════════════════════════════════════════╗")
console.log("║  Demo 5: MCP Bridge (Bidirectional)      ║")
console.log("╚══════════════════════════════════════════╝\n")

// ── Server side: bindings + tools ──────────────────────────────────────────

const serverClient = createContextClient()

const deployStatus = source({
	key: ["deploy", "status"],
	staleTime: "30s",
	fetch: async () => ({
		environment: "production",
		version: "v2.4.1",
		deployedAt: "2025-06-01T14:00:00Z",
		healthy: true,
	}),
})

const rollback = tool({
	key: ["tools", "rollback"],
	name: "rollback",
	description: "Rollback to a previous deployment version",
	input: zodToSchema(
		z.object({
			targetVersion: z.string().describe("Version to rollback to"),
			reason: z.string().optional(),
		}),
	),
	fetch: async ({ targetVersion, reason }) => ({
		success: true,
		rolledBackTo: targetVersion,
		reason: reason ?? "No reason provided",
		timestamp: new Date().toISOString(),
	}),
})

// Create MCP server runtime and wire it up
const runtime = new LivectxMcpRuntime(serverClient, {
	name: "deploy-context-server",
	version: "1.0.0",
	resources: [deployStatus],
	tools: [rollback],
})

// In-memory transport (in production, use HTTP or stdio)
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const mcpServer = createConfiguredMcpServer(runtime)
await mcpServer.connect(serverTransport)

// Wire invalidation → MCP notifications
const unsub = runtime.onBindingInvalidated((uri) => {
	void mcpServer.server.sendResourceUpdated({ uri })
})

await runtime.prefetchExposed()

console.log("── Server started ──")
console.log("  Exposed resources:")
console.log(`    ${bindingKeyToUri(deployStatus.__def.key)}`)
console.log("  Exposed tools:")
console.log(`    rollback: ${rollback.__tool.description}`)

// ── Client side: consume from the MCP server ───────────────────────────────

console.log("\n── Client connecting ──")
const mcpHandle = await mcpClientWithTransport(clientTransport, {
	serverId: "deploy-context-demo",
})

// List resources
const resources = await mcpHandle.listResources()
console.log(`  Found ${resources.length} resource(s):`)
for (const r of resources) {
	console.log(`    ${r.uri} — ${r.name}`)
}

// Read a resource
const uri = bindingKeyToUri(deployStatus.__def.key)
const content = await mcpHandle.readResource(uri)
console.log(`\n── Read resource: ${uri} ──`)
console.log(`  ${content.text}`)

// List tools
const tools = await mcpHandle.listTools()
console.log(`\n── Available tools: ${tools.length} ──`)
for (const t of tools) {
	console.log(`  ${t.name}: ${t.description}`)
}

// Call a tool
console.log("\n── Call tool: rollback ──")
const result = await mcpHandle.callTool("rollback", {
	targetVersion: "v2.3.0",
	reason: "Elevated error rate in v2.4.1",
})
console.log(`  Result: ${JSON.stringify(result)}`)

// ── The flywheel ───────────────────────────────────────────────────────────

console.log("\n── The Flywheel ──")
console.log("  1. You declared bindings for your own prompts (source, tool)")
console.log("  2. exposeAsMcpServer() makes them available to other agents")
console.log("  3. Other agents consume via standard MCP protocol")
console.log("  4. Invalidation flows through → MCP notifications → consumers refetch")
console.log("  Same declaration, two consumers ✓\n")

// Cleanup
unsub()
await mcpHandle.dispose()
await mcpServer.close()
runtime.dispose()
await serverClient.dispose()
