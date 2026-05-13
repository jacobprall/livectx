import type { UsageSnapshot } from "@livectx/core"
import { useCallback, useEffect, useState } from "react"
import { useLivectxClient } from "./provider.js"

/**
 * Polls the client's usage stats on an interval.
 * Useful for dashboards showing agent cost in real-time.
 */
export function useUsage(intervalMs = 1000): UsageSnapshot {
	const client = useLivectxClient()
	const [usage, setUsage] = useState<UsageSnapshot>(() => client.getUsage())

	const refresh = useCallback(() => {
		setUsage(client.getUsage())
	}, [client])

	useEffect(() => {
		refresh()
		const id = setInterval(refresh, intervalMs)
		return () => clearInterval(id)
	}, [refresh, intervalMs])

	return usage
}
