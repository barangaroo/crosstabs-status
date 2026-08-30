import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runSynthetic,
  validateConfiguration,
  validateHealth,
} from "./run-core-beta-synthetic.mjs";

const SOURCE = "a".repeat(40);
const DEPLOYMENT = "dpl_CoreBetaExact";
const SPEC = "deterministic synthetic source\n";
const DIGEST = "5d90ce29f5321c5b294becd248e71a07c26d8744235ee50e6b834ce40cabd723";

function configuration(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "active",
    targetUrl: "https://www.crosstabs.com",
    journeyId: "core_workspace_crosstab_v1",
    checkId: "crosstabs-core-beta-synthetic",
    sourceRevision: SOURCE,
    deploymentId: DEPLOYMENT,
    contractSha256: DIGEST,
    ...overrides,
  };
}

function health(overrides = {}) {
  return {
    schemaVersion: 3,
    service: "crosstabs.com",
    status: "operational",
    build: { sourceRevision: SOURCE, deploymentId: DEPLOYMENT },
    releasePosture: { hostedAi: "disabled", basis: "build-time-release-flag" },
    ...overrides,
  };
}

function response(value) {
  return {
    status: 200,
    headers: new Headers({ "cache-control": "no-store", "content-type": "application/json" }),
    text: async () => JSON.stringify(value),
  };
}

test("configuration is exact and pending state cannot claim release evidence", () => {
  assert.throws(() => validateConfiguration(configuration({ unexpected: true })), /fields/u);
  assert.throws(() => validateConfiguration(configuration({ status: "pending" })), /cannot claim/u);
  assert.deepEqual(validateConfiguration({
    ...configuration(), status: "pending", sourceRevision: null, deploymentId: null,
  }, { requireActive: false }).status, "pending");
});

test("health must bind the exact operational disabled-AI release", () => {
  assert.deepEqual(validateHealth(health(), configuration()), {
    sourceRevision: SOURCE,
    deploymentId: DEPLOYMENT,
  });
  assert.throws(() => validateHealth(health({
    build: { sourceRevision: "b".repeat(40), deploymentId: DEPLOYMENT },
  }), configuration()), /does not match/u);
  assert.throws(() => validateHealth(health({
    releasePosture: { hostedAi: "enabled", basis: "build-time-release-flag" },
  }), configuration()), /does not match/u);
});

test("browser execution receives the exact identity validated by the wrapper", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crosstabs-synthetic-test-"));
  const outputPath = join(directory, "browser-identity.json");
  let browserIdentity;
  const evidence = await runSynthetic({
    config: configuration(),
    outputPath,
    specSource: SPEC,
    fetchImpl: async () => response(health()),
    execute: async (expectedIdentity) => {
      browserIdentity = expectedIdentity;
      return 0;
    },
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });

  assert.equal(evidence.outcome, "passed");
  assert.deepEqual(browserIdentity, {
    sourceRevision: SOURCE,
    deploymentId: DEPLOYMENT,
  });
});

test("browser contract enforces the expected identity on both health checks", async () => {
  const source = await readFile(
    new URL("./core-beta-synthetic.spec.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /CORE_EXPECTED_SOURCE_SHA/u);
  assert.match(source, /CORE_EXPECTED_DEPLOYMENT_ID/u);
  assert.match(source, /expect\(identity\)\.toEqual\(expected\)/u);
  assert.equal(
    source.match(/exactProductionIdentity\(request, expectedIdentity\)/gu)?.length,
    2,
  );
});

test("committed lifecycle configuration binds the exact browser contract bytes", async () => {
  const [configurationSource, contractSource] = await Promise.all([
    readFile(new URL("./expected-production.json", import.meta.url), "utf8"),
    readFile(new URL("./core-beta-synthetic.spec.ts", import.meta.url), "utf8"),
  ]);
  const committed = JSON.parse(configurationSource);

  assert.equal(
    committed.contractSha256,
    createHash("sha256").update(contractSource).digest("hex"),
  );
});

test("passing evidence is bounded, content-free, and identity-stable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crosstabs-synthetic-test-"));
  const outputPath = join(directory, "evidence.json");
  const times = [new Date("2026-08-30T00:00:00.000Z"), new Date("2026-08-30T00:00:01.000Z")];
  const evidence = await runSynthetic({
    config: configuration(),
    outputPath,
    specSource: SPEC,
    fetchImpl: async () => response(health()),
    execute: async () => 0,
    now: () => times.shift(),
  });
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.durationMs, 1000);
  assert.match(evidence.evidenceSha256, /^[a-f0-9]{64}$/u);
  const raw = await readFile(outputPath, "utf8");
  assert.doesNotMatch(raw, /prompt|respondent|authorization|cookie|dsn/iu);
});

test("a browser failure or identity drift produces only redacted failed evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crosstabs-synthetic-test-"));
  const outputPath = join(directory, "failed.json");
  const evidence = await runSynthetic({
    config: configuration(),
    outputPath,
    specSource: SPEC,
    fetchImpl: async () => response(health()),
    execute: async () => 1,
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  assert.equal(evidence.outcome, "failed");
  assert.equal(evidence.errorCode, "synthetic_failed");
  assert.deepEqual(Object.keys(evidence).sort(), [
    "checkId", "completedAt", "contractSha256", "deploymentId", "durationMs",
    "errorCode", "evidenceSha256", "journeyId", "outcome", "provider", "runId",
    "runUrl", "schemaVersion", "sourceRevision", "startedAt", "targetUrl",
  ].sort());
});
