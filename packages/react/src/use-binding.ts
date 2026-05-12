import type { AnyBinding, Binding, CacheEntry } from "@livectx/core"
import { parseDuration } from "@livectx/core"
import { useCallback, useEffect, useState } from "react"
import { useLivectxClient } from "./provider.js"

export interface UseBindingResult<T> {
	data: T | undefined
	isLoading: boolean
	isStale: boolean
	error: Error | null
	refetch: () => Promise<void>
}

function readEntry<T>(binding: Binding<T>, get: () => CacheEntry<T> | undefined) {
	return get()
}

function entryIsStale<T>(binding: Binding<T>, entry: CacheEntry<T> | undefined): boolean {
	if (!entry) {
		return false
	}
	if (entry.state === "stale" || entry.state === "error") {
		return true
	}
	try {
		const staleMs = parseDuration(binding.__def.staleTime ?? 0)
		if (staleMs === Number.POSITIVE_INFINITY) {
			return false
		}
		return Date.now() - entry.fetchedAt >= staleMs
	} catch {
		return false
	}
}

export function useBinding<T>(binding: Binding<T>): UseBindingResult<T> {
	const client = useLivectxClient()

	const [data, setData] = useState<T | undefined>(
		() => readEntry(binding, () => client.getCacheEntry(binding))?.value,
	)
	const [isLoading, setIsLoading] = useState(true)
	const [isStale, setIsStale] = useState(() =>
		entryIsStale(
			binding,
			readEntry(binding, () => client.getCacheEntry(binding)),
		),
	)
	const [error, setError] = useState<Error | null>(() => {
		const e = readEntry(binding, () => client.getCacheEntry(binding))
		return e?.state === "error" && e.error ? e.error : null
	})

	const refetch = useCallback(async () => {
		setIsLoading(true)
		setError(null)
		try {
			await client.prefetch(binding as AnyBinding)
			const e = client.getCacheEntry(binding)
			setData(e?.value as T | undefined)
			setIsStale(entryIsStale(binding, e))
			if (e?.state === "error" && e.error) {
				setError(e.error)
			}
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)))
		} finally {
			setIsLoading(false)
		}
	}, [client, binding])

	useEffect(() => {
		let cancelled = false
		void (async () => {
			setIsLoading(true)
			setError(null)
			try {
				await client.prefetch(binding as AnyBinding)
				if (cancelled) {
					return
				}
				const e = client.getCacheEntry(binding)
				setData(e?.value as T | undefined)
				setIsStale(entryIsStale(binding, e))
				if (e?.state === "error" && e.error) {
					setError(e.error)
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err : new Error(String(err)))
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false)
				}
			}
		})()

		const stopMount = client.mount(binding as AnyBinding)
		const hasSubscribe = typeof binding.__def.subscribe === "function"
		const poll = hasSubscribe
			? globalThis.setInterval(() => {
					const e = client.getCacheEntry(binding)
					setData(e?.value as T | undefined)
					setIsStale(entryIsStale(binding, e))
					if (e?.state === "error" && e.error) {
						setError(e.error)
					}
				}, 300)
			: undefined

		return () => {
			cancelled = true
			stopMount()
			if (poll !== undefined) {
				globalThis.clearInterval(poll)
			}
		}
	}, [client, binding])

	return { data, isLoading, isStale, error, refetch }
}
