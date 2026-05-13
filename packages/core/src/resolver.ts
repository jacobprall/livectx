import { CircularDependencyError } from "./errors.js"
import { serializeKey } from "./key.js"
import type { AnyBinding, BindingKey } from "./types.js"

/** Deterministic stable id used for indexing and lookups. */
function bindingId(b: AnyBinding): string {
	return serializeKey(b.__def.key)
}

function depsOf(b: AnyBinding): AnyBinding[] {
	const d = b.__def.dependsOn
	if (!d) {
		return []
	}
	return Object.values(d)
}

function uniqByKeyOrdered(bindings: AnyBinding[]): AnyBinding[] {
	const seen = new Set<string>()
	const out: AnyBinding[] = []
	for (const b of bindings) {
		const id = bindingId(b)
		if (seen.has(id)) {
			continue
		}
		seen.add(id)
		out.push(b)
	}
	return out
}

/**
 * Finds a dependency cycle (`dependsOn` edges: follow dependencies from binding to dep).
 */
export function detectCycles(bindings: AnyBinding[]): BindingKey[] | null {
	const roots = uniqByKeyOrdered(bindings)
	const subgraph = collectWithDeps(roots)

	const visited = new Set<string>()
	const onPath = new Set<string>()
	const stack: AnyBinding[] = []

	function dfs(node: AnyBinding): BindingKey[] | null {
		const id = bindingId(node)

		if (visited.has(id)) {
			return null
		}

		if (onPath.has(id)) {
			const stackIdx = stack.findIndex((b) => bindingId(b) === id)
			const cycleKeys = [...stack.slice(stackIdx).map((b) => b.__def.key as BindingKey)]
			cycleKeys.push(node.__def.key as BindingKey)
			return cycleKeys
		}

		onPath.add(id)
		stack.push(node)

		for (const dep of depsOf(node)) {
			if (!subgraph.has(bindingId(dep))) {
				continue
			}
			const c = dfs(dep)
			if (c) {
				return c
			}
		}

		stack.pop()
		onPath.delete(id)
		visited.add(id)
		return null
	}

	for (const b of subgraph.values()) {
		if (!visited.has(bindingId(b))) {
			const c = dfs(b)
			if (c?.length) {
				return c
			}
		}
	}

	return null
}

function collectWithDeps(roots: AnyBinding[]): Map<string, AnyBinding> {
	const out = new Map<string, AnyBinding>()
	const stack = [...roots]
	while (stack.length) {
		const b = stack.pop()
		if (!b) {
			break
		}
		const id = bindingId(b)
		if (out.has(id)) {
			continue
		}
		out.set(id, b)
		for (const d of depsOf(b)) {
			stack.push(d)
		}
	}
	return out
}

/**
 * Topological layers for parallel execution: wave 0 has no deps in graph, etc.
 * Self-loops and cycles throw {@link CircularDependencyError}.
 */
export function topologicalSort(bindings: AnyBinding[]): AnyBinding[][] {
	const cycle = detectCycles(bindings)
	if (cycle) {
		throw new CircularDependencyError(cycle as BindingKey[])
	}

	const order = uniqByKeyOrdered(bindings)
	const subgraph = collectWithDeps(order)
	const subgraphList = [...subgraph.values()].sort((a, b) =>
		bindingId(a).localeCompare(bindingId(b)),
	)

	const depsInGraph = new Map<string, AnyBinding[]>()

	for (const b of subgraphList) {
		const id = bindingId(b)
		const inner: AnyBinding[] = []
		for (const dep of depsOf(b)) {
			const did = bindingId(dep)
			if (!subgraph.has(did)) {
				continue
			}
			inner.push(dep)
		}
		depsInGraph.set(id, inner)
	}

	const levelMemo = new Map<string, number>()

	function bindingLevel(id: string): number {
		const hit = levelMemo.get(id)
		if (hit !== undefined) {
			return hit
		}
		const deps = depsInGraph.get(id) ?? []
		if (deps.length === 0) {
			levelMemo.set(id, 0)
			return 0
		}
		let m = -1
		for (const d of deps) {
			const did = bindingId(d)
			const lv = bindingLevel(did)
			m = Math.max(m, lv)
		}
		const lvOut = m + 1
		levelMemo.set(id, lvOut)
		return lvOut
	}

	const byLevel = new Map<number, AnyBinding[]>()
	let maxLv = 0
	for (const b of subgraphList) {
		const id = bindingId(b)
		const lv = bindingLevel(id)
		maxLv = Math.max(maxLv, lv)
		let arr = byLevel.get(lv)
		if (!arr) {
			arr = []
			byLevel.set(lv, arr)
		}
		arr.push(b)
	}

	const orderIndex = new Map<string, number>()
	for (let i = 0; i < order.length; i++) {
		orderIndex.set(bindingId(order[i]), i)
	}

	const waves: AnyBinding[][] = []
	for (let lv = 0; lv <= maxLv; lv++) {
		const wave = byLevel.get(lv)
		if (wave?.length) {
			wave.sort(
				(a, b) =>
					(orderIndex.get(bindingId(a)) ?? Number.MAX_SAFE_INTEGER) -
					(orderIndex.get(bindingId(b)) ?? Number.MAX_SAFE_INTEGER),
			)
			waves.push(wave)
		}
	}

	return waves
}
