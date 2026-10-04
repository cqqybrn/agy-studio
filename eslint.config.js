import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.db',
      '**/.agy-studio/**',
      'fixtures/private/**',
    ],
  },
  {
    rules: {
      // `_name` marks a parameter or variable that is intentionally unused (interface placeholders,
      // callback signatures, loop counters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test doubles: `any` keeps mocks and fakes short and does not weaken product types.
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['backend/src/services/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/integrations/**',
                '**/integrations',
                '../integrations/**',
                '../../integrations/**',
                '*integrations*',
              ],
              message: 'backend/src/services/** 禁止 import backend/src/integrations/**',
            },
          ],
        },
      ],
    },
  },
);
