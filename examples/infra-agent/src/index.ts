/**
 * Infra agent demo: bindings + Anthropic-shaped prompt + mock LLM loop.
 * Run: `pnpm --filter @livectx/example-infra-agent start`
 */
import {
	cacheBreakpoint,
	createContextClient,
	prompt,
	source,
	tool,
	toolList,
	zodToSchema,
} from "@livectx/core"
import { anthropicSink } from "@livectx/sink-anthropic"
import { z } from "zod"

async function getProject() {
	return { id: "proj_9", name: "Acme Cloud", region: "us-east-1" }
}

async function getServices(projectId: string) {
	return [
		{ id: "svc_web", projectId, name: "web", status: "ok" as const },
		{ id: "svc_worker", projectId, name: "worker", status: "degraded" as const },
	]
}

async function getAlerts(projectId: string) {
	return [{ id: "a1", projectId, severity: "warning" as const, text: "Worker elevated latency" }]
}

async function getLogs(_serviceId: string, tail: number) {
	return { lines: ["[info] health check ok", `[warn] p99 ${tail}ms`].join("\n") }
}

const projectBinding = source({
	key: ["demo", "project"],
	placement: "static",
	staleTime: "1h",
	gcTime: "2h",
	fetch: getProject,
})

const servicesBinding = source({
	key: ["demo", "services"],
	dependsOn: { project: projectBinding },
	staleTime: "5m",
	gcTime: "30m",
	fetch: async ({ project: p }) => getServices(p.id),
})

const alertsBinding = source({
	key: ["demo", "alerts"],
	dependsOn: { project: projectBinding },
	staleTime: "1m",
	gcTime: "10m",
	fetch: async ({ project: p }) => getAlerts(p.id),
})

const serviceLogs = tool({
	key: ["demo", "tools", "service_logs"],
	name: "service_logs",
	description: "Fetch recent logs for a service id",
	input: zodToSchema(
		z.object({ serviceId: z.string(), tail: z.number().min(1).max(500).optional() }),
	),
	fetch: async ({ serviceId, tail }) => getLogs(serviceId, tail ?? 50),
})

const template = prompt`You are an infra assistant.
Project: ${projectBinding}
---
Services:
${servicesBinding}
---
Alerts:
${alertsBinding}
${cacheBreakpoint({ ttl: "5m" })}
${toolList([serviceLogs])}
`

function mockLlmReply(systemSummary: string) {
	return `[mock LLM] Summarized ${systemSummary.length} chars of context; suggest checking worker logs via service_logs.`
}

export async function main() {
	const client = createContextClient()
	const sink = anthropicSink()

	try {
		const assembled = await client.assemble({ template, sink, tools: [serviceLogs] })
		const summary = [
			...assembled.system.map((b) => b.text),
			...assembled.messages.flatMap((m) => m.content.map((c) => c.text)),
		].join("\n")

		console.log("--- Assembled (Anthropic shape) ---")
		console.log(`${JSON.stringify(assembled, null, 2).slice(0, 1200)}…`)
		console.log("\n--- Mock LLM ---")
		console.log(mockLlmReply(summary))
	} finally {
		await client.dispose()
	}
}

main().catch((e) => {
	console.error(e)
	process.exitCode = 1
})
