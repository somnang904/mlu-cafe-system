import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // This app loads its data with `useEffect(() => { loadX() }, [])`, and each loader
      // flips a loading flag before awaiting. That is still React's documented pattern for
      // client-side fetching, but the React Compiler rule counts the flag as a synchronous
      // setState. Reworking every screen around Suspense just to satisfy it would be a large,
      // risky change for no runtime benefit. Genuine derived-state misuse was fixed instead
      // (see Payment, Users, Sidebar and MenuItemImage, which now adjust state during render).
      'react-hooks/set-state-in-effect': 'off',

      // Context modules intentionally export their provider alongside the matching `useX`
      // hook. Splitting each context into provider/hook/context-object files would only
      // improve hot-reload granularity while touching every consumer. Non-component helpers
      // that had no reason to live in these files were moved out to utils instead.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Playwright specs run in Node (they read E2E_USERNAME / E2E_PASSWORD from process.env).
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Jest unit tests provide describe / test / expect as globals.
    files: ['jest-tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
])
