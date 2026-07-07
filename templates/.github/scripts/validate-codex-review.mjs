#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateReviewAgainstSchema(review, schema) {
  const errors = [];

  if (!isRecord(review)) {
    return ["review verdict must be a JSON object"];
  }

  const allowedProperties = new Set(Object.keys(schema.properties || {}));
  if (schema.additionalProperties === false) {
    for (const property of Object.keys(review)) {
      if (!allowedProperties.has(property)) errors.push(`unexpected property '${property}'`);
    }
  }

  for (const property of schema.required || []) {
    if (!(property in review)) errors.push(`missing required property '${property}'`);
  }

  validateBoolean(review, "_infra_failure", errors);
  validateBoolean(review, "approved", errors);
  validateString(review, "summary", errors);
  validateStringArray(review, "blocking_findings", errors);
  validateStringArray(review, "non_blocking_notes", errors);

  return errors;
}

function validateBoolean(review, property, errors) {
  if (property in review && typeof review[property] !== "boolean") {
    errors.push(`property '${property}' must be boolean`);
  }
}

function validateString(review, property, errors) {
  if (property in review && typeof review[property] !== "string") {
    errors.push(`property '${property}' must be string`);
  }
}

function validateStringArray(review, property, errors) {
  if (!(property in review)) return;
  if (!Array.isArray(review[property])) {
    errors.push(`property '${property}' must be an array`);
    return;
  }
  review[property].forEach((item, index) => {
    if (typeof item !== "string") errors.push(`property '${property}[${index}]' must be string`);
  });
}

function infraVerdict(errors) {
  return {
    approved: false,
    _infra_failure: true,
    summary: "Codex autoreview did not produce a schema-valid verdict due to an infrastructure/automation failure.",
    blocking_findings: [
      `Fix the Codex Review automation so codex-review.json matches .github/codex-review.schema.json. Validation errors: ${errors.join("; ")}`
    ],
    non_blocking_notes: []
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReviewFile(reviewPath, schemaPath) {
  const schema = readJson(schemaPath);
  let review;
  try {
    review = readJson(reviewPath);
  } catch (error) {
    review = null;
    const message = error instanceof Error ? error.message : String(error);
    const fallback = infraVerdict([`review file is not valid JSON: ${message}`]);
    writeFileSync(reviewPath, `${JSON.stringify(fallback, null, 2)}\n`);
    return { valid: false, errors: fallback.blocking_findings, infra: true };
  }

  const errors = validateReviewAgainstSchema(review, schema);
  if (errors.length === 0) {
    const infra = review._infra_failure === true;
    return { valid: true, errors: [], infra };
  }

  const fallback = infraVerdict(errors);
  writeFileSync(reviewPath, `${JSON.stringify(fallback, null, 2)}\n`);
  return { valid: false, errors, infra: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reviewPath = process.argv[2] || "codex-review.json";
  const schemaPath = process.argv[3] || ".github/codex-review.schema.json";
  const result = validateReviewFile(reviewPath, schemaPath);
  if (!result.valid) {
    console.error(`Codex review verdict failed schema validation: ${result.errors.join("; ")}`);
  }
}
