import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["handbells-used-chart/bundle.js"] },
  js.configs.recommended,
  {
    // The extension runs inside MuseScore and lib/ runs there too, so both are
    // held to the ES5 the extension is written in: let, const and arrow
    // functions are parse errors here. The probes are extensions as well.
    files: ["handbells-used-chart/**/*.js", "test/extension/probes/**/*.js"],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: "script",
      globals: { require: "readonly", module: "writable", api: "readonly" },
    },
    rules: {
      // MuseScore calls each action's main(). Nothing in the file does.
      "no-unused-vars": ["error", { varsIgnorePattern: "^main$" }],
      // The rule guards objects made without a prototype. Everything these
      // scripts call hasOwnProperty on is an object literal or one of
      // MuseScore's enum objects, and both have Object's.
      "no-prototype-builtins": "off",
    },
  },
  {
    files: ["tools/**/*.js", "test/**/*.js"],
    ignores: ["test/extension/probes/**"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
];
