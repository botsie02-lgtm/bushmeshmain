module.exports = {
  root: true,
  extends: ['./.eslintrc.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
  },
  overrides: [
    {
      files: [
        'src/security/bytes.ts',
        'src/security/pairing.ts',
        'src/security/testing/InMemorySecurityStores.ts',
      ],
      rules: {
        'no-bitwise': 'off',
        'no-div-regex': 'off',
      },
    },
  ],
};
