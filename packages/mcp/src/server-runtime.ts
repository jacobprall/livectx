import type {
	AnyBinding,
	BindingKey,
	CacheEntry,
	ContextClient,
	ToolBinding,
	Unsubscribe,
} from "@livectx/core"
import { serializeKey } from "@livectx/core"
import type { McpServerOpts } from "./server-types.js"
import { bindingKeyToUri } from "./uri.js"

/** Shared binding → URI maps, prefetch/read, invalidate wiring between handler and SDK bridges. */
export class LivectxMcpRuntime {
	readonly resourceUriToBinding = new Map<string, AnyBinding>()
	readonly toolsByName = new Map<string, ToolBinding<unknown, unknown>>()
	readonly urisOrdered: string[] = []

	readonly serverOpts: { readonly name: string; readonly version: string }

	private readonly unsubs: Unsubscribe[] = []
	private readonly invalidationListeners = new Set<(uri: string) => void>()

	constructor(
		readonly client: ContextClient,
		private readonly opts: McpServerOpts,
	) {
		this.serverOpts = { name: opts.name, version: opts.version }
		const resources = opts.resources ?? []
		const tools = opts.tools ?? []

		for (const b of resources) {
			const uri = bindingKeyToUri(b.__def.key as BindingKey)
			if (!this.resourceUriToBinding.has(uri)) {
				this.resourceUriToBinding.set(uri, b)
				this.urisOrdered.push(uri)
			}
		}

		for (const tb of tools) {
			this.toolsByName.set(tb.__tool.name, tb as ToolBinding<unknown, unknown>)
		}

		this.bindInvalidations(resources)
	}

	clearInvalidationHooks(): void {
		for (const u of this.unsubs) {
			try {
				u()
			} catch {
				//
			}
		}
		this.unsubs.length = 0
	}

	dispose(): void {
		this.clearInvalidationHooks()
		this.invalidationListeners.clear()
	}

	onBindingInvalidated(fn: (uri: string) => void): Unsubscribe {
		this.invalidationListeners.add(fn)
		return () => {
			this.invalidationListeners.delete(fn)
		}
	}

	emitResourceUpdated(uri: string): void {
		for (const fn of [...this.invalidationListeners]) {
			try {
				fn(uri)
			} catch {
				//
			}
		}
	}

	private bindInvalidations(resources: Iterable<AnyBinding>): void {
		for (const b of resources) {
			const sub = b.__def.subscribe
			if (!sub) {
				continue
			}
			const uri = bindingKeyToUri(b.__def.key as BindingKey)
			const u = sub(() => {
				this.emitResourceUpdated(uri)
				void this.client.invalidate(b.__def.key as BindingKey)
			})
			this.unsubs.push(u)
		}
	}

	resourceName(uri: string): string {
		const bk = this.resourceUriToBinding.get(uri)?.__def.key
		return bk?.length ? serializeKey(bk as BindingKey) : uri.slice("livectx://".length) || uri
	}

	async prefetchExposed(): Promise<void> {
		await Promise.all([...this.resourceUriToBinding.values()].map((b) => this.client.prefetch(b)))
	}

	async readRendered(uri: string): Promise<{ text: string; mimeType: string }> {
		const b = this.resourceUriToBinding.get(uri)
		if (!b) {
			throw new Error(`Unknown resource URI: ${uri}`)
		}
		await this.client.prefetch(b)
		const entry = this.client.getCacheEntry(b as never) as CacheEntry<unknown> | undefined
		if (!entry) {
			throw new Error(`No cache entry for ${uri}`)
		}
		if (entry.state === "error") {
			throw entry.error ?? new Error(`Binding error at ${uri}`)
		}

		let text: string
		try {
			text =
				typeof b.__def.render === "function"
					? b.__def.render(entry.value as never)
					: JSON.stringify(entry.value ?? null)
		} catch (e) {
			throw e instanceof Error ? e : new Error(String(e))
		}
		return { text, mimeType: "text/plain" }
	}

	toolDescriptors(): Array<{
		name: string
		description?: string
		inputSchema?: Record<string, unknown>
	}> {
		return [...this.toolsByName.values()].map((tb) => ({
			name: tb.__tool.name,
			description: tb.__tool.description,
			inputSchema: tb.__tool.input.toJsonSchema?.() as Record<string, unknown> | undefined,
		}))
	}

	async executeTool(name: string, rawInput: unknown): Promise<unknown> {
		const tb = this.toolsByName.get(name)
		if (!tb) {
			throw new Error(`Unknown tool: ${name}`)
		}
		const parsed = tb.__tool.input.parse(rawInput)
		return tb.__tool.fetch(parsed as never, {
			signal: new AbortController().signal,
			client: this.client,
		})
	}
}
