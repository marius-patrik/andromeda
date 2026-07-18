import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Workflow entrypoint helpers are native ESM, not built TypeScript modules.
const autoreviewRunnerModule: any = await import("../.github/scripts/run-darkfactory-autoreview.mjs");

const {
  classifyChangedTreeEntry,
  indexExactTreeEntries,
  parseChangedPaths
} = autoreviewRunnerModule;

function changedEvidence(names: Buffer, baseEntries: any[], headEntries: any[]) {
  const baseByPath = indexExactTreeEntries(baseEntries);
  const headByPath = indexExactTreeEntries(headEntries);
  const files: Record<string, unknown> = {};
  const reviewedFiles = parseChangedPaths(names).map((filePath: string) => {
    const baseEntry = baseByPath.get(filePath);
    const headEntry = headByPath.get(filePath);
    const evidence = classifyChangedTreeEntry(
      filePath,
      baseEntry ? [baseEntry] : [],
      headEntry ? [headEntry] : []
    );
    if (evidence.autofixEligible) files[filePath] = { sha256: "unread" };
    return evidence;
  });
  return { files, reviewedFiles };
}

test("gitlink pointer changes preserve exact base and head OIDs and stay out of autofix", () => {
  const path = "modules/darkfactory";
  const baseOid = "a".repeat(40);
  const headOid = "b".repeat(40);
  const result = changedEvidence(
    Buffer.from(`${path}\0`),
    [{ mode: "160000", type: "commit", oid: baseOid, path }],
    [{ mode: "160000", type: "commit", oid: headOid, path }]
  );

  assert.deepEqual(result.files, {});
  assert.deepEqual(result.reviewedFiles, [{
    path,
    kind: "gitlink",
    deleted: false,
    mode: "160000",
    oid: headOid,
    baseOid,
    headOid,
    replacementMode: null,
    replacementOid: null,
    contentKind: "none",
    autofixEligible: false,
    sha256: null,
    content: null
  }]);
});

test("gitlink renames preserve both exact paths and OIDs and keep both sides out of autofix", () => {
  const oldPath = "modules/old-name";
  const newPath = "modules/new-name";
  const baseOid = "c".repeat(40);
  const headOid = "d".repeat(40);
  const result = changedEvidence(
    Buffer.from(`${oldPath}\0${newPath}\0`),
    [{ mode: "160000", type: "commit", oid: baseOid, path: oldPath }],
    [{ mode: "160000", type: "commit", oid: headOid, path: newPath }]
  );

  assert.deepEqual(result.files, {});
  assert.deepEqual(result.reviewedFiles.map((entry: any) => ({
    path: entry.path,
    deleted: entry.deleted,
    oid: entry.oid,
    baseOid: entry.baseOid,
    headOid: entry.headOid,
    autofixEligible: entry.autofixEligible
  })), [
    { path: oldPath, deleted: true, oid: baseOid, baseOid, headOid: null, autofixEligible: false },
    { path: newPath, deleted: false, oid: headOid, baseOid: null, headOid, autofixEligible: false }
  ]);
});
