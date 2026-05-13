import type { BindingKey } from "./types.js"

export class CircularDependencyError extends Error {
	readonly cycle: BindingKey[]

	constructor(cycle: BindingKey[]) {
		super(`Circular dependency: ${cycle.map(String).join(" → ")}`)
		Object.setPrototypeOf(this, new.target.prototype)
		this.name = "CircularDependencyError"
		this.cycle = cycle
	}
}

export class AssemblyError extends Error {
	readonly failedBindings: Array<{ key: BindingKey; error: Error }>
	readonly partialResult?:
		| {
				staticText: string
				resolvedBindings: BindingKey[]
		  }
		| undefined

	constructor(
		message: string,
		failedBindings: Array<{ key: BindingKey; error: Error }>,
		options?: ErrorOptions & {
			partialResult?: AssemblyError["partialResult"]
		},
	) {
		super(message, options)
		Object.setPrototypeOf(this, new.target.prototype)
		this.name = "AssemblyError"
		this.failedBindings = failedBindings
		this.partialResult = options?.partialResult
	}
}

export class ToolDeniedError extends Error {
	readonly toolName: string
	readonly input: unknown

	constructor(toolName: string, input: unknown) {
		super(`Tool call denied: ${toolName}`)
		Object.setPrototypeOf(this, new.target.prototype)
		this.name = "ToolDeniedError"
		this.toolName = toolName
		this.input = input
	}
}

export class BudgetExceededError extends Error {
	readonly metric: "tokens" | "assemblies" | "fetches" | "cumulative"
	readonly limit: number
	readonly actual: number

	constructor(
		metric: "tokens" | "assemblies" | "fetches" | "cumulative",
		limit: number,
		actual: number,
	) {
		super(`Budget exceeded: ${metric} ${actual} > ${limit}`)
		Object.setPrototypeOf(this, new.target.prototype)
		this.name = "BudgetExceededError"
		this.metric = metric
		this.limit = limit
		this.actual = actual
	}
}
