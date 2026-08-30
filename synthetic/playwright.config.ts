import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /core-beta\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "output/results",
  reporter: "line",
  use: {
    baseURL: "https://www.crosstabs.com",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{
    name: "core-beta-chromium",
    use: { ...devices["Desktop Chrome"] },
  }],
});
