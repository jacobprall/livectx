import type { ContextClient } from "@livectx/core"
import { createContext, useContext } from "react"
import type { ReactNode } from "react"

const LivectxContext = createContext<ContextClient | null>(null)

export function LivectxProvider({
	client,
	children,
}: {
	client: ContextClient
	children: ReactNode
}) {
	return <LivectxContext.Provider value={client}>{children}</LivectxContext.Provider>
}

export function useLivectxClient(): ContextClient {
	const ctx = useContext(LivectxContext)
	if (!ctx) {
		throw new Error("useLivectxClient must be used within a LivectxProvider")
	}
	return ctx
}
