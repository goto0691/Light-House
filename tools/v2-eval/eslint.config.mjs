import base from "../../apps/web/eslint.config.mjs";

const config = [
  ...base,
  { settings: { next: { rootDir: "apps/web/" } } },
];

export default config;
