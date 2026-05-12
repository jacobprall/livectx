import type { Binding } from "@livectx/core"
import type { Duration, Placement } from "@livectx/core"
import { mcpResource } from "./resource.js"
import type { McpClientHandle } from "./types.js"

export async function mcpResources(
	server: McpClientHandle,
	opts?: { placement?: Placement; staleTime?: Duration },
): Promise<Binding<string>[]> {
	const descriptors = await server.listResources()
	return descriptors.map((d) =>
		mcpResource(server, {
			uri: d.uri,
			placement: opts?.placement,
			staleTime: opts?.staleTime,
		}),
	)
}
