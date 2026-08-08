import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import unusedImportsPlugin from 'eslint-plugin-unused-imports'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2022, React: 'readonly' },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    settings: { react: { version: '18.3' } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    // Endpoints serverless (Node). Antes NÃO passavam por lint — justo os que
    // tocam SERVICE_ROLE_KEY, ANTHROPIC_API_KEY e CRON_SECRET.
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, fetch: 'readonly' },
    },
    plugins: { 'unused-imports': unusedImportsPlugin },
    rules: {
      'no-undef': 'error',
      'unused-imports/no-unused-imports': 'error',
    },
  },
  { ignores: ['public/v2/', 'node_modules/', '*.config.js'] },
]
