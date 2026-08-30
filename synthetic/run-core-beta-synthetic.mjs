#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(ROOT, "expected-production.json");
const SPEC_PATH = resolve(ROOT, "core-beta-synthetic.spec.ts");
const PLAYWRIGHT_CLI = resolve(ROOT, "node_modules/@playwright/test/cli.js");
const PLAYWRIGHT_CONFIG = resolve(ROOT, "playwright.config.ts");
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/u;
const MAX_HEALTH_BYTES = 64 * 1024;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    throw new Error(`${label} fields are not exact.`);
  }
}

export function validateConfiguration(value, { requireActive = true } = {}) {
  exactKeys(value, [
    "schemaVersion", "status", "targetUrl", "journeyId", "checkId",
    "sourceRevision", "deploymentId", "contractSha256",
  ], "Synthetic configuration");
  if (value.schemaVersion !== 1 || !["pending", "active"].includes(value.status)) {
    throw new Error("Synthetic configuration lifecycle is invalid.");
  }
  if (value.targetUrl !== "https://www.crosstabs.com" ||
      value.journeyId !== "core_workspace_crosstab_v1" ||
      value.checkId !== "crosstabs-core-beta-synthetic" ||
      !DIGEST.test(value.contractSha256)) {
    throw new Error("Synthetic configuration contract is invalid.");
  }
  if (value.status === "pending") {
    if (value.sourceRevision !== null || value.deploymentId !== null) {
      throw new Error("Pending synthetic configuration cannot claim a release identity.");
    }
    if (requireActive) throw new Error("Synthetic monitoring is not activated.");
    return value;
  }
  if (!SHA.test(value.sourceRevision) || !DEPLOYMENT.test(value.deploymentId)) {
    throw new Error("Active synthetic configuration requires an exact release identity.");
  }
  return value;
}

export function validateHealth(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Production health is invalid.");
  }
  const identity = value.build;
  if (value.schemaVersion !== 3 || value.service !== "crosstabs.com" ||
      value.status !== "operational" ||
      value.releasePosture?.hostedAi !== "disabled" ||
      value.releasePosture?.basis !== "build-time-release-flag" ||
      identity?.sourceRevision !== expected.sourceRevision ||
      identity?.deploymentId !== expected.deploymentId) {
    throw new Error("Production health does not match the exact disabled-AI release.");
  }
  return {
    sourceRevision: identity.sourceRevision,
    deploymentId: identity.deploymentId,
  };
}

async function productionIdentity(expected, fetchImpl) {
  const response = await fetchImpl("https://www.crosstabs.com/api/health", {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200 || !response.headers.get("cache-control")?.includes("no-store")) {
    throw new Error("Production health response is not eligible.");
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_HEALTH_BYTES) {
    throw new Error("Production health response is oversized.");
  }
  return validateHealth(JSON.parse(raw), expected);
}

function executePlaywright(expectedIdentity) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", `--config=${PLAYWRIGHT_CONFIG}`], {
      cwd: ROOT,
      env: {
        ...process.env,
        CORE_EXPECTED_DEPLOYMENT_ID: expectedIdentity.deploymentId,
        CORE_EXPECTED_SOURCE_SHA: expectedIdentity.sourceRevision,
        PLAYWRIGHT_BASE_URL: "https://www.crosstabs.com",
      },
      stdio: "inherit",
    });
    child.once("error", () => resolvePromise(1));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

function canonicalEvidence(value) {
  return `${JSON.stringify(value)}\n`;
}

export async function runSynthetic({
  config,
  outputPath,
  fetchImpl = fetch,
  execute = executePlaywright,
  now = () => new Date(),
  specSource,
}) {
  const expected = validateConfiguration(config);
  const contractSha256 = createHash("sha256").update(specSource).digest("hex");
  if (contractSha256 !== expected.contractSha256) {
    throw new Error("The monitored journey bytes do not match the activated contract digest.");
  }
  const started = now();
  const expectedIdentity = {
    sourceRevision: expected.sourceRevision,
    deploymentId: expected.deploymentId,
  };
  let outcome = "failed";
  let errorCode = "synthetic_failed";
  try {
    const before = await productionIdentity(expected, fetchImpl);
    const exitCode = await execute(expectedIdentity);
    if (exitCode !== 0) throw new Error("Synthetic browser journey failed.");
    const after = await productionIdentity(expected, fetchImpl);
    if (before.sourceRevision !== after.sourceRevision || before.deploymentId !== after.deploymentId) {
      throw new Error("Production identity changed during the synthetic journey.");
    }
    outcome = "passed";
    errorCode = null;
  } catch {
    outcome = "failed";
  }
  const completed = now();
  const durationMs = Math.max(1, completed.getTime() - started.getTime());
  const runId = process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
    ? `${process.env.GITHUB_RUN_ID}-attempt-${process.env.GITHUB_RUN_ATTEMPT}`
    : "local-synthetic-run";
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const core = {
    schemaVersion: 1,
    provider: "GitHub Actions",
    journeyId: expected.journeyId,
    checkId: expected.checkId,
    runId,
    runUrl,
    contractSha256,
    targetUrl: expected.targetUrl,
    sourceRevision: expected.sourceRevision,
    deploymentId: expected.deploymentId,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs,
    outcome,
    errorCode,
  };
  const evidenceSha256 = createHash("sha256").update(canonicalEvidence(core)).digest("hex");
  const evidence = { ...core, evidenceSha256 };
  await writeFile(outputPath, canonicalEvidence(evidence), { encoding: "utf8", flag: "wx" });
  return evidence;
}

async function main() {
  const outputPath = process.env.CORE_BETA_SYNTHETIC_EVIDENCE_PATH;
  const runnerRoot = resolve(process.env.RUNNER_TEMP ?? "/tmp");
  const resolvedOutput = outputPath ? resolve(outputPath) : "";
  const outputRelative = resolvedOutput ? relative(runnerRoot, resolvedOutput) : "";
  if (!outputPath || outputRelative === "" || outputRelative === ".." ||
      outputRelative.startsWith("../") || resolve(runnerRoot, outputRelative) !== resolvedOutput) {
    throw new Error("CORE_BETA_SYNTHETIC_EVIDENCE_PATH must be an unused runner-temp path.");
  }
  const [configRaw, specSource] = await Promise.all([
    readFile(CONFIG_PATH, "utf8"),
    readFile(SPEC_PATH, "utf8"),
  ]);
  const evidence = await runSynthetic({
    config: JSON.parse(configRaw),
    outputPath,
    specSource,
  });
  process.stdout.write(`${JSON.stringify({
    status: evidence.outcome,
    sourceRevision: evidence.sourceRevision,
    deploymentId: evidence.deploymentId,
    durationMs: evidence.durationMs,
  })}\n`);
  if (evidence.outcome !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("Core beta synthetic failed closed.\n");
    process.exitCode = 1;
  });
}
