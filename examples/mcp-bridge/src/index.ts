/**
 * MCP bridge: server exposes Livectx bindings; client consumes over MCP (in-memory transport).
 * Run: `pnpm --filter @livectx/example-mcp-bridge start`
 */
import { createContextClient, source, tool, zodToSchema } from "@livectx/core"
import {
	LivectxMcpRuntime,
	bindingKeyToUri,
	createConfiguredMcpServer,
	mcpClientWithTransport,
} from "@livectx/mcp"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"

async function main() {
	const client = createContextClient()

	const status = source({
		key: ["bridge", "status"],
		staleTime: "30s",
		gcTime: "5m",
		fetch: async () => ({ up: true, version: "7-demo" }),
	})

	const multiply = tool({
		key: ["bridge", "tools", "multiply"],
		name: "multiply",
		description: "Return a * b",
		input: zodToSchema(z.object({ a: z.number(), b: z.number() })),
		fetch: async ({ a, b }) => ({ product: a * b }),
	})

	const runtime = new LivectxMcpRuntime(client, {
		name: "livectx-example-bridge",
		version: "1.0.0",
		resources: [status],
		tools: [multiply],
	})

	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
	const mcp = createConfiguredMcpServer(runtime)
	await mcp.connect(serverSide)

	const unsub = runtime.onBindingInvalidated((uri) => {
		void mcp.server.sendResourceUpdated({ uri })
	})

	const handle = await mcpClientWithTransport(clientSide, {
		serverId: "livectx-mcp-bridge-example",
	})

	await runtime.prefetchExposed()

	const uri = bindingKeyToUri(status.__def.key)
	const snapshot = await handle.readResource(uri)
	console.log("Server published resource:", uri)
	console.log("Client read:", snapshot.text)

	const toolResult = await handle.callTool("multiply", { a: 6, b: 7 })
	console.log("Tool call:", toolResult)

	unsub()
	await handle.dispose()
	await mcp.close()
	runtime.dispose()
	await client.dispose()
}

main().catch((e) => {
	console.error(e)
	process.exitCode = 1
})
