import type { BindingKey } from "./types.js"

export class CircularDependencyError extends Error {
	readonly cycle: BindingKey[]

	constructor(cycle: BindingKey[]) {
		super(`Circular dependency: ${cycle.map(String).join(" → ")}`)
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
		this.name = "AssemblyError"
		this.failedBindings = failedBindings
		this.partialResult = options?.partialResult
	}
}
