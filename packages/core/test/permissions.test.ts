import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { ToolDeniedError } from "../src/errors.js"
import {
	cacheBreakpoint,
	composeHooks,
	createContextClient,
	prompt,
	tool,
	toolList,
	zodToSchema,
} from "../src/index.js"
import type { AssembledSegments, ResolvedTool, SinkAdapter } from "../src/types.js"

const testToolKey = ["tools", "test_action"] as const

// Create a tool for testing
const testTool = tool({
	key: testToolKey,
	name: "test_action",
	description: "A test action",
	input: zodToSchema(z.object({ value: z.string() })),
	fetch: async ({ value }) => ({ result: `processed: ${value}` }),
})

// A template that registers the tool
const template = prompt`Test agent ${cacheBreakpoint()} ${toolList([testTool])}`

function stubSink<
	T extends { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] },
>(): SinkAdapter<T> {
	return {
		name: "stub-sink",
		format(segments, tools) {
			return { segments, tools } as T
		},
	}
}

type StubOut = { readonly segments: AssembledSegments; readonly tools: readonly ResolvedTool[] }

describe("permissions hook", () => {
	it("allows the tool when the hook returns true", async () => {
		const onToolCall = vi.fn().mockReturnValue(true)
		const client = createContextClient({
			permissions: { onToolCall },
		})
		await client.assemble({
			template,
			sink: stubSink<StubOut>(),
		})

		await expect(client.executeTool("test_action", { value: "x" })).resolves.toEqual({
			result: "processed: x",
		})
		expect(onToolCall).toHaveBeenCalledTimes(1)
		await client.dispose()
	})

	it("throws ToolDenied when denied with onDeny: throw", async () => {
		const client = createContextClient({
			permissions: {
				onToolCall: () => false,
				onDeny: "throw",
			},
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "y" })).rejects.toMatchObject({
			name: "ToolDeniedError",
			toolName: "test_action",
			input: { value: "y" },
		})
		await expect(client.executeTool("test_action", { value: "y" })).rejects.toBeInstanceOf(
			ToolDeniedError,
		)
		await client.dispose()
	})

	it("returns an error object when denied with onDeny: return-error", async () => {
		const client = createContextClient({
			permissions: {
				onToolCall: () => false,
				onDeny: "return-error",
			},
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "z" })).resolves.toEqual({
			error: 'Tool "test_action" was denied by permissions hook.',
		})
		await client.dispose()
	})

	it("defaults undefined onDeny to return-error", async () => {
		const client = createContextClient({
			permissions: {
				onToolCall: () => false,
			},
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "z" })).resolves.toEqual({
			error: 'Tool "test_action" was denied by permissions hook.',
		})
		await client.dispose()
	})

	it("supports async permission hooks", async () => {
		const client = createContextClient({
			permissions: {
				onToolCall: () =>
					new Promise<boolean>((resolve) => {
						setTimeout(() => resolve(true), 10)
					}),
			},
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "async" })).resolves.toEqual({
			result: "processed: async",
		})
		await client.dispose()
	})

	it("runs tools normally when permissions are not configured", async () => {
		const client = createContextClient()
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "plain" })).resolves.toEqual({
			result: "processed: plain",
		})
		await client.dispose()
	})

	it("passes name, input, description, and bindingKey to the hook", async () => {
		const onToolCall = vi.fn().mockReturnValue(true)
		const client = createContextClient({
			permissions: { onToolCall },
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		const payload = { value: "payload" }
		await client.executeTool("test_action", payload)

		expect(onToolCall).toHaveBeenCalledWith({
			name: "test_action",
			input: payload,
			description: "A test action",
			bindingKey: testToolKey,
		})
		await client.dispose()
	})
})

describe("composeHooks", () => {
	it("allows execution when every composed hook allows", async () => {
		const client = createContextClient({
			permissions: composeHooks({ onToolCall: () => true }, { onToolCall: async () => true }),
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "ok" })).resolves.toEqual({
			result: "processed: ok",
		})
		await client.dispose()
	})

	it("denies when any composed hook denies", async () => {
		const client = createContextClient({
			permissions: composeHooks(
				{ onToolCall: () => true },
				{ onToolCall: () => false, onDeny: "return-error" },
			),
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "no" })).resolves.toEqual({
			error: 'Tool "test_action" was denied by permissions hook.',
		})
		await client.dispose()
	})

	it("evaluates hooks in order and short-circuits on first deny", async () => {
		const second = vi.fn().mockReturnValue(true)
		const client = createContextClient({
			permissions: composeHooks(
				{ onToolCall: () => false, onDeny: "return-error" },
				{ onToolCall: second },
			),
		})
		await client.assemble({ template, sink: stubSink<StubOut>() })

		await expect(client.executeTool("test_action", { value: "x" })).resolves.toEqual({
			error: 'Tool "test_action" was denied by permissions hook.',
		})
		expect(second).not.toHaveBeenCalled()
		await client.dispose()
	})

	it("uses the first specified onDeny when the composed hook denies", async () => {
		const returnErr = createContextClient({
			permissions: composeHooks(
				{ onDeny: "return-error", onToolCall: () => false },
				{ onDeny: "throw" },
			),
		})
		await returnErr.assemble({ template, sink: stubSink<StubOut>() })
		await expect(returnErr.executeTool("test_action", { value: "x" })).resolves.toEqual({
			error: 'Tool "test_action" was denied by permissions hook.',
		})
		await returnErr.dispose()

		const shouldThrow = createContextClient({
			permissions: composeHooks(
				{ onDeny: "throw", onToolCall: () => false },
				{ onDeny: "return-error" },
			),
		})
		await shouldThrow.assemble({ template, sink: stubSink<StubOut>() })
		await expect(shouldThrow.executeTool("test_action", { value: "x" })).rejects.toBeInstanceOf(
			ToolDeniedError,
		)
		await shouldThrow.dispose()
	})
})
