import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: [".next/**", ".open-next/**", "**/.wrangler/**", "playwright-report/**", "test-results/**", "coverage/**", "public/sw.js"] },
  ...nextVitals,
  // Same files as the react-hooks plugin in eslint-config-next; a bare override also hits .cjs fixtures and crashes.
  { files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"], rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/refs": "warn" } },
];

export default config;
