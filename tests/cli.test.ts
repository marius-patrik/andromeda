import assert from "node:assert/strict";
import test from "node:test";

import { parseDoctorCliArgs } from "../src/cli.js";

test("doctor CLI defaults to read-only control-repository diagnosis", () => {
  const parsed = parseDoctorCliArgs([]);
  assert.equal(parsed.target, "marius-patrik/DarkFactory");
  assert.equal(parsed.all, false);
  assert.equal(parsed.writeIssues, false);
});

test("doctor CLI parses explicit report and local evidence options", () => {
  const parsed = parseDoctorCliArgs([
    "marius-patrik/Andromeda",
    "--write-issues",
    "--json",
    "--local",
    "C:\\work\\Andromeda",
    "--agents-home",
    "C:\\Users\\patrik\\.agents"
  ]);
  assert.equal(parsed.target, "marius-patrik/Andromeda");
  assert.equal(parsed.writeIssues, true);
  assert.equal(parsed.json, true);
  assert.equal(parsed.localPath, "C:\\work\\Andromeda");
});

test("doctor CLI rejects ambiguous, unknown, and repair options", () => {
  assert.throws(() => parseDoctorCliArgs(["--all", "marius-patrik/Andromeda"]), /cannot be combined/);
  assert.throws(() => parseDoctorCliArgs(["--all", "--local", "."]), /cannot inspect/);
  assert.throws(() => parseDoctorCliArgs(["--repair"]), /intentionally unavailable/);
  assert.throws(() => parseDoctorCliArgs(["--unknown"]), /unknown doctor option/);
});
