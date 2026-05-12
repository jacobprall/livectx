import { source } from "@livectx/core"
import type { Binding } from "@livectx/core"
import type { McpClientHandle, McpResourceOpts } from "./types.js"

function resourceText(content: Awaited<ReturnType<McpClientHandle["readResource"]>>): string {
	if (content.text !== undefined) {
		return content.text
	}
	if (content.blob !== undefined && typeof Buffer !== "undefined") {
		return Buffer.from(content.blob, "base64").toString("utf8")
	}
	return ""
}

export function mcpResource(server: McpClientHandle, opts: McpResourceOpts): Binding<string> {
	return source({
		key: ["mcp", server.serverId, opts.uri],
		fetch: async () => {
			const content = await server.readResource(opts.uri)
			return resourceText(content)
		},
		placement: opts.placement,
		staleTime: opts.staleTime,
		gcTime: opts.gcTime,
		render: opts.render,
		subscribe: server.capabilities.resources?.subscribe
			? (onInvalidate) => server.subscribe(opts.uri, onInvalidate)
			: undefined,
	})
}
