const js = require('@eslint/js')
const globals = require('globals')
const { defineConfig, globalIgnores } = require('eslint/config')

module.exports = defineConfig([
  globalIgnores(['node_modules', 'backups', 'logs', 'uploads', 'private-uploads']),
  {
    files: ['**/*.{js,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // Optional schema tweaks use `try { ... } catch {}` on purpose: the step is skipped
      // when the column or table already has the wanted shape.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Jest unit tests provide describe / test / expect as globals.
    files: ['jest-tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
])
