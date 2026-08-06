/**
 * These tests import the TypeScript sources beside them (`../validation`, not
 * `shared/dist/...`), so they need a transform to run at all.
 *
 * The config has to live here rather than at the workspace root: Jest resolves
 * its config from the directory it is invoked in and does not search upwards,
 * and `pnpm test` runs it from this package.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
