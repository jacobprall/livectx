/**
 * Workspace project roots for Vitest are declared via `test.projects` in `vitest.config.ts`.
 * Vitest 3.2+ deprecates a standalone magic `vitest.workspace.ts` entrypoint; this file
 * documents the intended layout for Sprint 0 parity with the sprint checklist.
 */
export const vitestWorkspaceProjectGlobs = ["packages/*/vitest.config.ts"] as const
