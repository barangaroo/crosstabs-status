import { expect, test } from "@playwright/test";

test("core beta synthetic journey computes, persists, reloads, and exports a crosstab", async ({
  page,
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  const report = await health.json() as {
    build?: { deploymentId?: unknown; sourceRevision?: unknown };
    service?: unknown;
    status?: unknown;
  };
  expect(report).toMatchObject({ service: "crosstabs.com", status: "operational" });
  expect(report.build?.deploymentId).toMatch(/^dpl_[A-Za-z0-9]+$/u);
  expect(report.build?.sourceRevision).toMatch(/^[a-f0-9]{40}$/u);

  await page.goto("/");
  await page.getByRole("button", { name: "Try sample dataset" }).first().click();
  await expect(page).toHaveURL(/\/workspace/u);
  await expect(page.getByRole("heading", {
    name: "Engagement × Manager Support",
  })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Project" }).click();
  await page.getByLabel("Project name").fill("Core beta synthetic monitor");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  const continueButton = page.getByRole("button", { name: "Continue" });
  if (await continueButton.isVisible()) {
    await continueButton.click();
    await expect(page).toHaveURL(/\/workspace/u);
  }
  await expect(page.getByRole("heading", {
    name: "Engagement × Manager Support",
  })).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Data table CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/u);
});
