import js from '@eslint/js';
import globals from 'globals';

// Linter for the Node.js backend (gateway, services, shared, scripts). Run: npm run lint
// The frontend has its own config (frontend/eslint.config.mjs) and the agent is Python.
export default [
  { ignores: ['frontend/**', 'agent/**', '**/node_modules/**', '**/generated/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      // Express error handlers need all four arguments, even when next is not used.
      // const { a, ...rest } = obj leaves a out on purpose.
      'no-unused-vars': ['error', { argsIgnorePattern: '^(next|_)', ignoreRestSiblings: true }],
    },
  },
];
