import type {
	AnyBinding,
	AssembleMetrics,
	SinkAdapter,
	SinkOutput,
	Template,
	ToolBinding,
} from "@livectx/core"
import { serializeKey } from "@livectx/core"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLivectxClient } from "./provider.js"

export interface UseAssembleOpts<F extends SinkAdapter> {
	template: Template
	sink: F
	// biome-ignore lint/suspicious/noExplicitAny: matches TemplateValue tool arity in core
	tools?: readonly ToolBinding<any, any>[]
	enabled?: boolean
}

export interface UseAssembleResult<F extends SinkAdapter> {
	data: SinkOutput<F> | undefined
	isLoading: boolean
	error: Error | null
	metrics: AssembleMetrics | undefined
	refetch: () => Promise<void>
}

function templateSignature(
	template: Template,
	// biome-ignore lint/suspicious/noExplicitAny: signature string for heterogeneous tools
	tools?: readonly ToolBinding<any, any>[],
): string {
	const toolNames = tools?.map((t) => t.__tool.name).join("\0") ?? ""
	const valuePart = template.values
		.map((v) => {
			if (typeof v === "object" && v !== null) {
				if ("__def" in v && (v as AnyBinding).__def?.key) {
					return `b:${serializeKey((v as AnyBinding).__def.key)}`
				}
				if ("__tool" in v) {
					const tb = v as ToolBinding<unknown, unknown>
					return `t:${tb.__tool.name}`
				}
				if ("__marker" in v) {
					const m = v as { __marker: string; ttl?: string }
					return `m:${m.__marker}:${m.ttl ?? ""}`
				}
			}
			return `p:${String(v)}`
		})
		.join("|")
	return `${template.strings.join("\0")}@@${valuePart}@@${toolNames}`
}

export function useAssemble<F extends SinkAdapter>(opts: UseAssembleOpts<F>): UseAssembleResult<F> {
	const client = useLivectxClient()
	const enabled = opts.enabled !== false
	const sig = `${templateSignature(opts.template, opts.tools)}:${opts.sink.name}`

	const templateRef = useRef(opts.template)
	const sinkRef = useRef(opts.sink)
	const toolsRef = useRef(opts.tools)
	templateRef.current = opts.template
	sinkRef.current = opts.sink
	toolsRef.current = opts.tools

	const gen = useRef(0)
	const [data, setData] = useState<SinkOutput<F> | undefined>(undefined)
	const [metrics, setMetrics] = useState<AssembleMetrics | undefined>(undefined)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const run = useCallback(async () => {
		const g = ++gen.current
		setIsLoading(true)
		setError(null)
		try {
			const out = await client.assemble({
				template: templateRef.current,
				sink: sinkRef.current,
				tools: toolsRef.current,
			})
			if (g !== gen.current) {
				return
			}
			setData(out)
			if (out && typeof out === "object" && out !== null && "metrics" in out) {
				setMetrics((out as { metrics: AssembleMetrics }).metrics)
			} else {
				setMetrics(undefined)
			}
		} catch (e) {
			if (g === gen.current) {
				setError(e instanceof Error ? e : new Error(String(e)))
			}
		} finally {
			if (g === gen.current) {
				setIsLoading(false)
			}
		}
	}, [client])

	const refetch = useCallback(async () => {
		await run()
	}, [run])

	// biome-ignore lint/correctness/useExhaustiveDependencies: `sig` must re-run assembly when template/sink inputs change while `run` only depends on `client`
	useEffect(() => {
		if (!enabled) {
			setIsLoading(false)
			return
		}
		void run()
	}, [enabled, run, sig])

	return { data, isLoading, error, metrics, refetch }
}
