import js from "@eslint/js";
import tseslint from "typescript-eslint";
import robloxTs from "eslint-plugin-roblox-ts";

export default tseslint.config(
	{ ignores: ["node_modules/**", "out/**", "include/**", "build/**", ".tools/**"] },
	{
		files: ["src/**/*.ts", "src/**/*.tsx"],
		extends: [
			tseslint.configs.recommended,
			robloxTs.configs.tsRecommendedCompat,
			robloxTs.configs.recommended,
		],
		languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
		},
	},
	{
		files: ["scripts/**/*.mjs", "eslint.config.mjs"],
		extends: [js.configs.recommended],
		languageOptions: {
			globals: { process: "readonly", console: "readonly", URL: "readonly", setTimeout: "readonly" },
		},
	},
	{
		files: ["scripts/**/*.cjs"],
		extends: [js.configs.recommended],
		languageOptions: {
			sourceType: "commonjs",
			globals: {
				process: "readonly",
				console: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
				Buffer: "readonly",
				fetch: "readonly",
				FormData: "readonly",
				Blob: "readonly",
				AbortSignal: "readonly",
				TextDecoder: "readonly",
				TextEncoder: "readonly",
				performance: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
			},
		},
		rules: {
			"no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
			"no-empty": ["error", { allowEmptyCatch: true }],
		},
	},
);
