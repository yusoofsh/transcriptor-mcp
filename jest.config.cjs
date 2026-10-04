module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Pure widget helpers and the original server test suites remain covered.
  roots: ['<rootDir>/src', '<rootDir>/ui/shared'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': '<rootDir>/scripts/jest-esm-compat.cjs',
  },
  // Compile real ESM code for Jest; do not mock away the new resource/wire checks.
  transformIgnorePatterns: [
    'node_modules/(?!(?:(?:@fastify/static/node_modules/)?content-disposition|@modelcontextprotocol/ext-apps)/)',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/mcp.ts',
    '!src/mcp-http-entry.ts',
    '!src/e2e/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
};
