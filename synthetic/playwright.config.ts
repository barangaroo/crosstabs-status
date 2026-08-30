import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "core-beta-synthetic.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  outputDir: join(tmpdir(), "crosstabs-core-beta-synthetic-results"),
  reporter: [["line"]],
  use: {
    baseURL: "https://www.crosstabs.com",
    screenshot: "off",
    trace: "off",
    video: "off",
    acceptDownloads: true,
  },
  projects: [{
    name: "chromium",
    use: { browserName: "chromium" },
  }],
});
