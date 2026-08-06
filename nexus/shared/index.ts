/**
 * Package entry point for `@bridge-2026/shared`.
 *
 * `types/index.ts` already re-exports `../utils`, so consumers that import the
 * package root get types and utilities together. `@bridge-2026/shared/utils`
 * stays available as a narrower entry for code that only wants the helpers —
 * see the "exports" map in package.json.
 */

export * from './types';
