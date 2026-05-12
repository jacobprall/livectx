import type { Unsubscribe } from "@livectx/core"

export type NotifyFn = (method: string, params: unknown) => void

/** Per-session MCP resource.subscribe tracking and dispatch to subscribed clients only. */
export class ResourceSubscriptionHub {
	private nextId = 1
	private readonly sessions = new Map<number, NotifyFn>()
	private readonly uriSubsBySessionId = new Map<number, Set<string>>()
	private readonly globalListeners = new Set<NotifyFn>()

	onProtocolNotification(listener: NotifyFn): Unsubscribe {
		this.globalListeners.add(listener)
		return () => {
			this.globalListeners.delete(listener)
		}
	}

	/** Register a subscriber for outbound notifications routed by resources/subscribe. */
	createSession(send: NotifyFn): { id: number; dispose: () => void } {
		const id = this.nextId++
		this.sessions.set(id, send)
		this.uriSubsBySessionId.set(id, new Set())
		return {
			id,
			dispose: () => {
				this.sessions.delete(id)
				this.uriSubsBySessionId.delete(id)
			},
		}
	}

	subscribe(uri: string, sessionId: number): void {
		this.uriSubsBySessionId.get(sessionId)?.add(uri)
	}

	unsubscribe(uri: string, sessionId: number): void {
		this.uriSubsBySessionId.get(sessionId)?.delete(uri)
	}

	notify(uri: string): void {
		const params = { uri }
		const method = "notifications/resources/updated"
		for (const l of [...this.globalListeners]) {
			try {
				l(method, params)
			} catch {
				//
			}
		}
		for (const [id, send] of [...this.sessions]) {
			if (this.uriSubsBySessionId.get(id)?.has(uri)) {
				try {
					send(method, params)
				} catch {
					//
				}
			}
		}
	}
}
