import { fileURLToPath } from "node:url";

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Vercel bundles this config outside the monorepo and provides no Wrangler runtime.
// Keep local Cloudflare development and the safe Worker build unchanged.
if (process.env.VERCEL !== "1") {
  initOpenNextCloudflareForDev({
    configPath: fileURLToPath(new URL("../../wrangler.toml", import.meta.url)),
    remoteBindings: false,
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // The Vercel project builds only apps/web; monorepo test fixtures are not runtime inputs.
  typescript: {
    tsconfigPath: process.env.VERCEL === "1" ? "tsconfig.vercel.json" : "tsconfig.json",
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
