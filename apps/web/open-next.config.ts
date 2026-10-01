import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext imports this config during Worker initialization as well as builds.
// Keep runtime imports independent of build-only environment variables.
const config = {
  ...defineCloudflareConfig(),
  buildCommand: "node scripts/build-next-worker-safe.mjs",
};

export default config;
