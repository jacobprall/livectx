import type { ToolBinding } from "@livectx/core"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import { z } from "zod"
import type { LivectxMcpRuntime } from "./server-runtime.js"

function looksLikeAnySchema(candidate: unknown): candidate is AnySchema {
	if (candidate === null || typeof candidate !== "object") return false
	const c = candidate as Record<string, unknown>
	return typeof c.safeParse === "function" && typeof c.safeParseAsync === "function"
}

function registerToolBinding(
	mcp: McpServer,
	runtime: LivectxMcpRuntime,
	tb: ToolBinding<unknown, unknown>,
	schema: AnySchema,
): void {
	mcp.registerTool(
		tb.__tool.name,
		{
			description: tb.__tool.description,
			inputSchema: schema,
		},
		async (args: Record<string, unknown>) => {
			const out = await runtime.client.executeTool(tb.__tool.name, args)
			let text: string
			try {
				text =
					out !== undefined && typeof out !== "string" ? JSON.stringify(out) : String(out ?? "")
			} catch {
				text = String(out ?? "")
			}
			return { content: [{ type: "text" as const, text }] }
		},
	)
}

/**
 * Registers cached livectx bindings and tools onto a high-level MCP {@link McpServer}.
 * Used by {@link exposeAsMcpServer} transports and integration tests over {@link import("@modelcontextprotocol/sdk/inMemory.js").InMemoryTransport}.
 */
export function registerLivectxBindingsOnSdkServer(
	mcp: McpServer,
	runtime: LivectxMcpRuntime,
): void {
	for (const uri of runtime.urisOrdered) {
		const b = runtime.resourceUriToBinding.get(uri)
		if (!b) {
			continue
		}
		const nameKey = runtime.resourceName(uri)
		mcp.registerResource(
			nameKey,
			uri,
			{ description: b.__def.description, mimeType: "text/plain" },
			async () => {
				const { text, mimeType } = await runtime.readRendered(uri)
				return { contents: [{ uri, text, mimeType }] }
			},
		)
	}

	const openInput = z.object({}).passthrough() as unknown as AnySchema
	for (const tb of runtime.toolsByName.values()) {
		const cand = tb.__tool.input as unknown
		const schema = looksLikeAnySchema(cand) ? cand : openInput
		registerToolBinding(mcp, runtime, tb, schema)
	}
}

/**
 * Builds an SDK {@link McpServer} wired to cached livectx state.
 */
export function createConfiguredMcpServer(runtime: LivectxMcpRuntime): McpServer {
	const caps: {
		resources: { subscribe: true }
		tools?: Record<string, never>
	} = { resources: { subscribe: true } }
	if (runtime.toolsByName.size > 0) {
		caps.tools = {}
	}
	const server = new McpServer(
		{ name: runtime.serverOpts.name, version: runtime.serverOpts.version },
		{ capabilities: caps },
	)
	registerLivectxBindingsOnSdkServer(server, runtime)
	return server
}
