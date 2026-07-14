import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: remoteBaseUrl ?? "http://localhost:5173/screwdealer/",
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile-webkit", use: { browserName: "webkit" } }],
  ...(remoteBaseUrl
    ? {}
    : {
        webServer: [
          {
            command: "npm run dev:worker",
            url: "http://localhost:8787/api/health",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
          {
            command: "npm run dev",
            url: "http://localhost:5173/screwdealer/",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ],
      }),
});
