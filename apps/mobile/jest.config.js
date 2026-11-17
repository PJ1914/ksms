// Pure-logic tests (utils, validation) run in plain Node. Component tests (jest-expo) are added in the UI phase.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          ignoreDeprecations: '6.0',
          esModuleInterop: true,
          strict: true,
          target: 'ES2022',
          types: ['jest'],
        },
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
};
