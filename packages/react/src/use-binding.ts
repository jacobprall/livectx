import type { AnyBinding, Binding, CacheEntry } from "@livectx/core"
import { parseDuration } from "@livectx/core"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useLivectxClient } from "./provider.js"

export interface UseBindingResult<T> {
	data: T | undefined
	isLoading: boolean
	isStale: boolean
	error: Error | null
	refetch: () => Promise<void>
}

function entryIsStale<T>(binding: Binding<T>, entry: CacheEntry<T> | undefined): boolean {
	if (!entry) return false
	if (entry.state === "stale" || entry.state === "error") return true
	try {
		const staleMs = parseDuration(binding.__def.staleTime ?? 0)
		if (staleMs === Number.POSITIVE_INFINITY) return false
		return Date.now() - entry.fetchedAt >= staleMs
	} catch {
		return false
	}
}

export function useBinding<T>(binding: Binding<T>): UseBindingResult<T> {
	const client = useLivectxClient()

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const unsub = client.mount(binding as AnyBinding)
			// For bindings without a subscribe function, poll to detect staleness
			const hasSubscribe = typeof binding.__def.subscribe === "function"
			let poll: ReturnType<typeof setInterval> | undefined
			if (!hasSubscribe) {
				poll = globalThis.setInterval(onStoreChange, 1000)
			}
			// Trigger initial fetch
			void client.prefetch(binding as AnyBinding).then(onStoreChange, onStoreChange)
			return () => {
				unsub()
				if (poll !== undefined) globalThis.clearInterval(poll)
			}
		},
		[client, binding],
	)

	const getSnapshot = useCallback(() => client.getCacheEntry(binding), [client, binding])

	const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

	const data = entry?.value as T | undefined
	const isLoading = entry === undefined
	const isStale = entryIsStale(binding, entry)
	const error = entry?.state === "error" ? (entry.error ?? new Error("Binding error")) : null

	const refetch = useCallback(async () => {
		await client.refetch(binding.__def.key)
	}, [client, binding])

	return useMemo(
		() => ({ data, isLoading, isStale, error, refetch }),
		[data, isLoading, isStale, error, refetch],
	)
}
