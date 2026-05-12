import { createContextClient, prompt, rawSink, source } from "@livectx/core"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LivectxProvider, useAssemble, useBinding, useLivectxClient } from "../src/index.js"

function ThrowUnlessProvider() {
	useLivectxClient()
	return null
}

describe("LivectxProvider / useLivectxClient", () => {
	it("useLivectxClient throws outside provider", () => {
		expect(() => {
			render(<ThrowUnlessProvider />)
		}).toThrow("useLivectxClient must be used within a LivectxProvider")
	})

	it("Provider passes client through context", () => {
		const client = createContextClient()
		function Read() {
			const c = useLivectxClient()
			return <span data-testid="ok">{c === client ? "same" : "diff"}</span>
		}
		render(
			<LivectxProvider client={client}>
				<Read />
			</LivectxProvider>,
		)
		expect(screen.getByTestId("ok").textContent).toBe("same")
	})
})

describe("useAssemble", () => {
	it("returns data after assembly (mock client)", async () => {
		const assemble = vi.fn().mockResolvedValue({ segments: "mock" })
		const fakeClient = { assemble } as unknown as import("@livectx/core").ContextClient

		function Comp() {
			const { data, isLoading } = useAssemble({
				template: prompt`hi`,
				sink: rawSink(),
			})
			if (isLoading) {
				return <span data-testid="state">loading</span>
			}
			return <span data-testid="state">{JSON.stringify(data)}</span>
		}

		render(
			<LivectxProvider client={fakeClient}>
				<Comp />
			</LivectxProvider>,
		)

		expect(screen.getByTestId("state").textContent).toBe("loading")
		await vi.waitFor(() => {
			expect(screen.getByTestId("state").textContent).toContain("mock")
		})
		expect(assemble).toHaveBeenCalled()
	})
})

describe("useBinding", () => {
	it("loads binding value after prefetch", async () => {
		const client = createContextClient()
		const b = source({
			key: ["hook", "binding"],
			staleTime: "1h",
			fetch: async () => "hello",
			gcTime: "10m",
		})

		function Comp() {
			const { data, isLoading } = useBinding(b)
			if (isLoading) {
				return <span data-testid="v">loading</span>
			}
			return <span data-testid="v">{String(data ?? "none")}</span>
		}

		render(
			<LivectxProvider client={client}>
				<Comp />
			</LivectxProvider>,
		)

		await vi.waitFor(() => {
			expect(screen.getByTestId("v").textContent).toBe("hello")
		})

		await client.dispose()
	})
})
