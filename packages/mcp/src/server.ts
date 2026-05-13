import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, Server } from "node:http"
import type { ContextClient, Unsubscribe } from "@livectx/core"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"

import { LivectxMcpRuntime } from "./server-runtime.js"
import { createConfiguredMcpServer } from "./server-sdk-register.js"
import type { McpServerHandle, McpServerOpts, McpServerTransportConfig } from "./server-types.js"

export type { McpServerHandle, McpServerOpts, McpServerTransportConfig } from "./server-types.js"
export { LivectxMcpRuntime } from "./server-runtime.js"

function poolAttach(transport: Transport, mcp: McpServer, pool: Set<McpServer>) {
	pool.add(mcp)
	const prev = transport.onclose
	transport.onclose = () => {
		try {
			prev?.()
		} catch {
			//
		}
		pool.delete(mcp)
	}
}

async function attachStdioRuntime(runtime: LivectxMcpRuntime, pool: Set<McpServer>) {
	const transport = new StdioServerTransport()
	const mcp = createConfiguredMcpServer(runtime)
	await mcp.connect(transport)
	poolAttach(transport, mcp, pool)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = []
	for await (const chunk of req) {
		chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk))
	}
	const raw = Buffer.concat(chunks).toString("utf8")
	if (!raw) {
		return undefined
	}
	return JSON.parse(raw) as unknown
}

function pathnameForRequest(url: string | undefined): string {
	if (!url) {
		return "/"
	}
	const q = url.indexOf("?")
	return q >= 0 ? url.slice(0, q) : url
}

/**
 * Bridges livectx bindings to MCP clients over stdio or streamable HTTP.
 */
export function exposeAsMcpServer(client: ContextClient, opts: McpServerOpts): McpServerHandle {
	const runtime = new LivectxMcpRuntime(client, opts)
	const sdkPool = new Set<McpServer>()

	let unsubForwarder: Unsubscribe | undefined

	let httpSrv: Server | undefined
	let httpSessions: Map<string, StreamableHTTPServerTransport> | undefined

	const unsubscribeForward = (): void => {
		unsubForwarder?.()
		unsubForwarder = undefined
	}

	const attachForwarder = (): void => {
		unsubscribeForward()
		unsubForwarder = runtime.onBindingInvalidated((uri) => {
			void Promise.all(
				[...sdkPool].map(async (mcp) => {
					try {
						await mcp.server.sendResourceUpdated({ uri })
					} catch {
						//
					}
				}),
			)
		})
	}

	async function teardown(): Promise<void> {
		unsubscribeForward()

		for (const t of [...(httpSessions?.values() ?? [])]) {
			try {
				await t.close()
			} catch {
				//
			}
		}
		httpSessions?.clear()
		httpSessions = undefined

		for (const inst of [...sdkPool]) {
			try {
				await inst.close()
			} catch {
				//
			}
			sdkPool.delete(inst)
		}

		if (httpSrv) {
			await new Promise<void>((resolve) => {
				httpSrv?.close(() => resolve())
			}).catch(() => {
				//
			})
			httpSrv = undefined
		}

		runtime.dispose()
	}

	return {
		async listen(config: McpServerTransportConfig) {
			attachForwarder()
			await runtime.prefetchExposed()

			if (config.type === "stdio") {
				await attachStdioRuntime(runtime, sdkPool)
				return
			}

			const sessionsMap = new Map<string, StreamableHTTPServerTransport>()
			httpSessions = sessionsMap

			httpSrv = createServer(async (req, res) => {
				if (pathnameForRequest(req.url) !== "/mcp") {
					res.statusCode = 404
					res.end()
					return
				}

				try {
					const sessions = httpSessions
					if (!sessions) {
						res.statusCode = 503
						res.end()
						return
					}

					if (req.method === "POST") {
						let body: unknown
						try {
							body = await readJsonBody(req)
						} catch {
							res.statusCode = 400
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									error: { code: -32700, message: "Parse error" },
									id: null,
								}),
							)
							return
						}

						const hdr = req.headers["mcp-session-id"]
						const incomingSession =
							hdr === undefined ? undefined : Array.isArray(hdr) ? hdr[0] : hdr

						let transport: StreamableHTTPServerTransport | undefined
						if (incomingSession !== undefined && sessions.has(incomingSession)) {
							transport = sessions.get(incomingSession)
						} else if (incomingSession === undefined && isInitializeRequest(body)) {
							const activeTransport = new StreamableHTTPServerTransport({
								sessionIdGenerator: () => randomUUID(),
								onsessioninitialized: (sid) => {
									sessions.set(sid, activeTransport)
								},
							})

							await activeTransport.start()

							const freshMcp = createConfiguredMcpServer(runtime)
							await freshMcp.connect(activeTransport)
							poolAttach(activeTransport, freshMcp, sdkPool)

							await activeTransport.handleRequest(req as never, res as never, body)
							return
						}

						if (!transport) {
							res.statusCode = 400
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: incomingSession
											? "Unknown MCP session ID"
											: "Initialization request required before subsequent JSON-RPC calls",
									},
									id: null,
								}),
							)
							return
						}

						await transport.handleRequest(req as never, res as never, body)
						return
					}

					if (req.method === "GET") {
						const hdr = req.headers["mcp-session-id"]
						const sid = hdr === undefined ? undefined : Array.isArray(hdr) ? hdr[0] : hdr
						const lift = sid !== undefined ? sessions.get(sid) : undefined

						if (!lift) {
							res.statusCode = 400
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: "GET requires `mcp-session-id` tied to POST initialize handshake",
									},
									id: null,
								}),
							)
							return
						}

						await lift.handleRequest(req as never, res as never)
						return
					}

					if (req.method === "DELETE") {
						const hdr = req.headers["mcp-session-id"]
						const sid = hdr === undefined ? undefined : Array.isArray(hdr) ? hdr[0] : hdr
						if (sid) {
							const transport = sessions.get(sid)
							if (transport) {
								sessions.delete(sid)
								void transport.close().catch(() => {})
							}
						}
						res.statusCode = 200
						res.end()
						return
					}

					res.statusCode = 405
					res.setHeader("Allow", "GET, POST, DELETE")
					res.end()
				} catch (err) {
					if (!res.headersSent) {
						res.statusCode = 500
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								error: {
									code: -32603,
									message: err instanceof Error ? err.message : String(err),
								},
								id: null,
							}),
						)
					}
				}
			})

			await new Promise<void>((resolve, reject) => {
				httpSrv?.listen(config.port, config.host ?? "127.0.0.1", () => resolve())
				httpSrv?.once("error", reject)
			})
		},

		close: teardown,

		notifyResourceUpdated(uri: string): void {
			runtime.emitResourceUpdated(uri)
		},
	}
}
