import {
  expect,
  test,
  type APIRequestContext,
} from "@playwright/test";

type SyntheticIdentity = {
  deploymentId: string;
  sourceRevision: string;
};

function expectedProductionIdentity(): SyntheticIdentity {
  const deploymentId = process.env.CORE_EXPECTED_DEPLOYMENT_ID;
  const sourceRevision = process.env.CORE_EXPECTED_SOURCE_SHA;
  if (!deploymentId || !/^dpl_[A-Za-z0-9]+$/u.test(deploymentId) ||
      !sourceRevision || !/^[a-f0-9]{40}$/u.test(sourceRevision)) {
    throw new Error("The browser journey requires an exact expected production identity.");
  }
  return { deploymentId, sourceRevision };
}

async function exactProductionIdentity(
  request: APIRequestContext,
  expected: SyntheticIdentity,
): Promise<SyntheticIdentity> {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toContain("no-store");
  const report = await health.json() as {
    schemaVersion?: unknown;
    service?: unknown;
    status?: unknown;
    build?: { deploymentId?: unknown; sourceRevision?: unknown };
    releasePosture?: { hostedAi?: unknown; basis?: unknown };
  };
  expect(report).toMatchObject({
    schemaVersion: 3,
    service: "crosstabs.com",
    status: "operational",
    releasePosture: {
      hostedAi: "disabled",
      basis: "build-time-release-flag",
    },
  });
  expect(report.build?.deploymentId).toMatch(/^dpl_[A-Za-z0-9]+$/u);
  expect(report.build?.sourceRevision).toMatch(/^[a-f0-9]{40}$/u);
  const identity = {
    deploymentId: report.build?.deploymentId,
    sourceRevision: report.build?.sourceRevision,
  };
  expect(identity).toEqual(expected);
  return expected;
}

test("core beta synthetic journey computes, persists, reloads, and exports a crosstab", async ({
  page,
  request,
}) => {
  const expectedIdentity = expectedProductionIdentity();
  const initialIdentity = await exactProductionIdentity(request, expectedIdentity);

  await page.goto("/");
  await page.getByRole("button", { name: "Try sample dataset" }).first().click();

  await expect(page).toHaveURL(/\/workspace/u);
  await expect(
    page.getByRole("heading", { name: "Engagement × Manager Support" }),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Project" }).click();
  await page.getByLabel("Project name").fill("Core beta synthetic monitor");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  const continueButton = page.getByRole("button", { name: "Continue" });
  if (await continueButton.isVisible()) await continueButton.click();
  await expect(
    page.getByRole("heading", { name: "Engagement × Manager Support" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Data table CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/u);

  expect(await exactProductionIdentity(request, expectedIdentity)).toEqual(initialIdentity);
});
