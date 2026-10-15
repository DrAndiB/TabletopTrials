import globals from 'globals';
export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  rules: { 'no-undef': 'error', 'no-unused-vars': 'off', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-const-assign': 'error' },
}];
