export default [
  {
    ignores: ['**/node_modules/**', '.dart_tool/**', 'build/**', 'coverage/**', '**/*.min.js'],
  },
  {
    files: ['eslint.config.mjs', 'scripts/**/*.mjs', 'test/engineering-foundation.test.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
