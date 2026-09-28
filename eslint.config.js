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
