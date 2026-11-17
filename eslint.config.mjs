import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      'apps/api/src/generated/**',
      'apps/mobile/babel.config.js',
      'apps/mobile/metro.config.js',
      '**/jest.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Money must never be a JS float: ban Number()/parseFloat() on obvious money names.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name=/^(parseFloat|Number)$/] > Identifier[name=/(amount|price|total|balance|cost|tax|discount)/i]',
          message: 'Do not convert money values to JS numbers. Use decimal.js.',
        },
      ],
    },
  },
  prettier,
);
