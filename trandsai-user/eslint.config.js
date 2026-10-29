export default [
  {
    files: ["**/*.{js,vue}"],
    ignores: ["unpackage/**", "node_modules/**", "static/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        uni: "readonly",
        plus: "readonly",
        wx: "readonly",
      },
    },
    rules: {},
  },
];
