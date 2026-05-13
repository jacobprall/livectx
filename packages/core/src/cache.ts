import type { CacheEntry, StoreAdapter } from "./types.js"

export function createMemoryStore(): StoreAdapter & {
	__backingMap: Map<string, CacheEntry<unknown>>
} {
	const map = new Map<string, CacheEntry<unknown>>()

	async function pruneExpired(): Promise<void> {
		const now = Date.now()
		for (const [k, entry] of map) {
			if (now > entry.expiresAt) {
				map.delete(k)
			}
		}
	}

	return {
		__backingMap: map,

		async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
			const raw = map.get(key)
			if (!raw || Date.now() > raw.expiresAt) {
				if (raw) {
					map.delete(key)
				}
				return undefined
			}
			return raw as CacheEntry<T>
		},

		async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
			map.set(key, entry as CacheEntry<unknown>)
		},

		async delete(key: string): Promise<void> {
			map.delete(key)
		},

		async *keys(): AsyncIterable<string> {
			const now = Date.now()
			for (const [k, entry] of map) {
				if (now > entry.expiresAt) {
					map.delete(k)
				} else {
					yield k
				}
			}
		},

		async clear(): Promise<void> {
			map.clear()
		},
	}
}
