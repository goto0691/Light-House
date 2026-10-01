import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_ADAPTER_BY_TABLE } from "../../apps/web/src/lib/v2/migration/legacy-adapters-v1";
import {
  assertReadOnlySql,
  candidateReasons,
  candidateSqlPredicate,
  computeBaseSampleSize,
  computeEvenSampleIndexes,
  isPrivateArtifactOutput,
} from "./private-sample-core";

test("sampling policy takes all tiny tables and 5%-up-to-20 otherwise", () => {
  assert.equal(computeBaseSampleSize(0), 0);
  assert.equal(computeBaseSampleSize(4), 4);
  assert.equal(computeBaseSampleSize(5), 5);
  assert.equal(computeBaseSampleSize(100), 5);
  assert.equal(computeBaseSampleSize(101), 6);
  assert.equal(computeBaseSampleSize(400), 20);
  assert.equal(computeBaseSampleSize(10_000), 20);
});

test("sample indexes are deterministic, unique, and span the ordered table", () => {
  const indexes = computeEvenSampleIndexes(101);
  assert.deepEqual(indexes, [0, 20, 40, 60, 80, 100]);
  assert.equal(new Set(indexes).size, indexes.length);
  assert.deepEqual(computeEvenSampleIndexes(4), [0, 1, 2, 3]);
});

test("damage, high-risk, and attachment candidates are additive", () => {
  const people = LEGACY_ADAPTER_BY_TABLE.get("people");
  const attachments = LEGACY_ADAPTER_BY_TABLE.get("attachments");
  assert.ok(people);
  assert.ok(attachments);
  assert.deepEqual(candidateReasons(people, { id: "p1", phone: "010" }, ["id", "phone"]), ["HIGH_RISK_PERSONAL", "SOURCE_MISSING"]);
  assert.deepEqual(candidateReasons(attachments, { id: "a1", r2_key: "private/a" }, ["id", "r2_key"]), ["ATTACHMENT_RECORD"]);
  assert.match(candidateSqlPredicate(attachments, ["id", "r2_key"]) ?? "", /1=1/);
});

test("output path and SQL guards fail closed", () => {
  const repository = "C:\\repo";
  assert.equal(isPrivateArtifactOutput("artifacts/v2-migration/run-1", repository), true);
  assert.equal(isPrivateArtifactOutput("Docs/private", repository), false);
  assert.doesNotThrow(() => assertReadOnlySql("select count(*) from legacy"));
  assert.throws(() => assertReadOnlySql("update legacy set body='x'"), /SELECT or PRAGMA|mutating/);
});
