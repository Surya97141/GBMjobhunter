// Flat ESLint config for the monorepo. Deliberately lenient: it catches real
// problems (undefined variables, unreachable code, broken hooks) as errors and
// treats style-level issues such as unused variables as warnings, so CI fails
// only on things that are actually wrong.

const js         = require('@eslint/js');
const globals    = require('globals');
const react      = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

const unusedVars = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }];

module.exports = [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/dist-check/**', '**/build/**', '**/coverage/**',
      'mobile/**',                 // Expo app: separate toolchain, not linted yet
      'scripts/dev-verification/**',
      'repomix-output.xml',
    ],
  },

  js.configs.recommended,

  // Backend: Node, CommonJS.
  {
    files: ['gateway/**/*.js', 'services/**/*.js', 'scripts/**/*.js', 'shared/**/*.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: { 'no-unused-vars': unusedVars },
  },

  // Jest tests.
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    languageOptions: { globals: { ...globals.jest } },
  },

  // Web app: React, ES modules, browser.
  {
    files: ['web/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',   // marks components used in JSX as "used"
      'react/jsx-uses-react': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': unusedVars,
    },
  },
  // Vite config runs in Node.
  {
    files: ['web/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Chrome extension: browser plus the `chrome` extension API globals.
  // API_BASE and WEB_APP_URL are defined in extension/src/config.js and shared
  // with the other scripts through importScripts() / a <script> tag, so they
  // are real cross-file globals, not typos.
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2022,
      globals: {
        ...globals.browser, ...globals.webextensions, ...globals.serviceworker,
        API_BASE: 'readonly', WEB_APP_URL: 'readonly',
      },
    },
    rules: { 'no-unused-vars': unusedVars },
  },
  // config.js is the one place those globals are defined (and "unused" in-file).
  {
    files: ['extension/src/config.js'],
    languageOptions: { globals: { API_BASE: 'off', WEB_APP_URL: 'off' } },
    rules: { 'no-unused-vars': 'off' },
  },

  // Repo-wide tweaks to recommended rules.
  {
    rules: {
      // `catch {}` / `catch (_) {}` is used on purpose to swallow best-effort failures.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Harmless escapes (e.g. \- inside a regex class): flag, don't fail CI.
      'no-useless-escape': 'warn',
    },
  },
];
