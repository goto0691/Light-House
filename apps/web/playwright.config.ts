import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname localhost --port 3100",
    env: {
      FLAG_V2_ROUTES: "1",
      FLAG_V2_OFFLINE: "1",
      FLAG_V2_WRITE: process.env.FLAG_V2_WRITE ?? "0",
      FLAG_V2_DEFAULT_LIBRARY: process.env.FLAG_V2_DEFAULT_LIBRARY ?? "0",
      FLAG_V2_LEGACY_READONLY: process.env.FLAG_V2_LEGACY_READONLY ?? "0",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://localhost:3100/v2-lab",
  },
});
