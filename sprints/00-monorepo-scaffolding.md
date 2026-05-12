# Sprint 0: Monorepo Scaffolding & Tooling

> **Timeline:** Days 1–2
> **Milestone:** Pre-M1 (foundation for all subsequent work)
> **Goal:** A working monorepo with build, test, lint, and CI for all planned packages — even if they only contain stubs.

---

## Objectives

1. Initialize pnpm workspace monorepo with all planned package directories.
2. Configure shared tooling: TypeScript, tsup, vitest, biome, changesets.
3. Set up CI pipeline (GitHub Actions) for build + test + lint.
4. Establish package dependency graph and cross-package TypeScript references.

---

## Tasks

### 0.1 — Repository initialization

- [ ] `pnpm init` at root, create `pnpm-workspace.yaml` referencing `packages/*` and `examples/*`.
- [ ] Root `package.json` with workspace scripts: `build`, `test`, `lint`, `typecheck`, `bench`.
- [ ] Root `tsconfig.json` (base config) with strict mode, ESM target, path aliases.
- [ ] `.npmrc` with `shamefully-hoist=false`, `strict-peer-dependencies=true`.

### 0.2 — Package scaffolding (stubs)

Create each package directory with minimal `package.json`, `tsconfig.json`, `tsup.config.ts`, and `src/index.ts`:

| Package | npm name | Initial export |
|---------|----------|----------------|
| `packages/core` | `@livectx/core` | `export {}` stub |
| `packages/mcp` | `@livectx/mcp` | `export {}` stub |
| `packages/sink-anthropic` | `@livectx/sink-anthropic` | `export {}` stub |
| `packages/sink-openai` | `@livectx/sink-openai` | `export {}` stub |
| `packages/sink-vercel-ai` | `@livectx/sink-vercel-ai` | `export {}` stub |
| `packages/source-websocket` | `@livectx/source-websocket` | `export {}` stub |
| `packages/source-sse` | `@livectx/source-sse` | `export {}` stub |
| `packages/store-redis` | `@livectx/store-redis` | `export {}` stub |
| `packages/react` | `@livectx/react` | `export {}` stub |
| `packages/otel` | `@livectx/otel` | `export {}` stub |

Each package.json must specify:
- `"type": "module"`
- `"main"` → CJS output, `"module"` → ESM output, `"types"` → `.d.ts`
- `"exports"` field with `.` entry for ESM/CJS/types

### 0.3 — Build tooling (tsup)

- [ ] Shared `tsup.config.ts` base at root (or per-package extending a shared preset).
- [ ] Each package builds ESM + CJS dual output.
- [ ] `@livectx/core` must produce zero-dep bundle (verify with `bundlesize` or manual check).
- [ ] Root `pnpm build` builds packages in dependency order (topological sort — pnpm handles this natively).

### 0.4 — Test tooling (vitest)

- [ ] Root `vitest.config.ts` with workspace support.
- [ ] Per-package test directories: `packages/*/test/`.
- [ ] Add a single canary test per package (e.g., `import * as pkg from "../src"; expect(pkg).toBeDefined()`).
- [ ] Root `pnpm test` runs all workspace tests.

### 0.5 — Lint & format (Biome)

- [ ] `biome.json` at root with TypeScript + JSX rules.
- [ ] Import ordering, consistent quotes, trailing commas.
- [ ] Root `pnpm lint` and `pnpm format`.

### 0.6 — Changesets

- [ ] `pnpm add -Dw @changesets/cli @changesets/changelog-github`.
- [ ] `.changeset/config.json` with linked packages, `access: "public"`.
- [ ] Verify `pnpm changeset` workflow creates a changeset file.

### 0.7 — CI pipeline (GitHub Actions)

- [ ] `.github/workflows/ci.yml`:
  - Trigger on push to `main` and PRs.
  - Steps: checkout → pnpm install → typecheck → lint → build → test.
- [ ] Optional: matrix across Node 20 + Node 22.

### 0.8 — Example scaffolding

- [ ] Create `examples/infra-agent/`, `examples/customer-support/`, `examples/mcp-bridge/` with empty `package.json` and placeholder README.
- [ ] Each example depends on workspace packages (`"@livectx/core": "workspace:*"`).

---

## Definition of Done

- [ ] `pnpm install` succeeds with clean lockfile.
- [ ] `pnpm build` compiles all packages to `dist/` with ESM + CJS.
- [ ] `pnpm test` runs canary tests for all packages (all green).
- [ ] `pnpm lint` passes with zero errors.
- [ ] `pnpm typecheck` passes with strict mode.
- [ ] CI workflow runs end-to-end on a push.
- [ ] `@livectx/core` dist has zero runtime dependencies.

---

## Files Created / Modified

```
livectx/
├── .github/workflows/ci.yml
├── .changeset/config.json
├── .npmrc
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── vitest.config.ts
├── packages/
│   ├── core/           (package.json, tsconfig.json, tsup.config.ts, src/index.ts, test/index.test.ts)
│   ├── mcp/            (same structure)
│   ├── sink-anthropic/ (same structure)
│   ├── sink-openai/    (same structure)
│   ├── sink-vercel-ai/ (same structure)
│   ├── source-websocket/ (same structure)
│   ├── source-sse/     (same structure)
│   ├── store-redis/    (same structure)
│   ├── react/          (same structure)
│   └── otel/           (same structure)
└── examples/
    ├── infra-agent/    (package.json, README.md)
    ├── customer-support/ (package.json, README.md)
    └── mcp-bridge/     (package.json, README.md)
```

---

## Risks & Notes

- **pnpm workspace protocol** (`workspace:*`) requires all packages to exist before install. Stubs solve this.
- **tsup** should be configured to externalize all `@livectx/*` peer deps to avoid bundling sibling packages.
- Biome is preferred over ESLint+Prettier for speed; if team has existing ESLint configs, swap accordingly.
