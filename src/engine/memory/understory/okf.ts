// Derived from Understory at 912cfa6d4f407ffdb768bcd667bd701ccfe9ecb2.
// Copyright 2026 Anirban Kar. Modified by Andromeda contributors.
// Licensed under the Apache License, Version 2.0.

import { createHash } from "node:crypto";
import type {
  CanonicalMemoryDocument,
  MemoryConceptFrontmatter,
  MemoryFrontmatterValue,
  ParsedMemoryConcept,
} from "./types";

export const MAX_MEMORY_CONCEPT_BYTES = 4 * 1024 * 1024;

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RESERVED_FILENAMES = new Set(["agents.md", "claude.md", "index.md", "log.md", "readme.md"]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class MemoryConceptError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PATH"
      | "RESERVED_PATH"
      | "INVALID_FRONTMATTER"
      | "INVALID_MARKDOWN"
      | "TOO_LARGE",
  ) {
    super(message);
    this.name = "MemoryConceptError";
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Canonical memory paths are deliberately portable across private-data clones.
 * Callers must supply lowercase ASCII paths rather than relying on host-specific
 * normalization or case folding.
 */
export function canonicalMemoryConceptPath(input: string): string {
  if (typeof input !== "string" || !input || input.includes("\0") || /[\r\n]/.test(input)) {
    throw new MemoryConceptError("memory concept path is required and must be one line", "INVALID_PATH");
  }
  if (input.includes("\\") || !input.startsWith("/") || input.includes("//")) {
    throw new MemoryConceptError(`memory concept path is not canonical: ${input}`, "INVALID_PATH");
  }
  const segments = input.slice(1).split("/");
  if (segments.length === 0 || segments.some((segment) => !segment || !SAFE_SEGMENT.test(segment))) {
    throw new MemoryConceptError(`memory concept path contains a non-portable segment: ${input}`, "INVALID_PATH");
  }
  if (segments.some((segment) => segment === "." || segment === "..") || !input.endsWith(".md")) {
    throw new MemoryConceptError(`memory concept path must identify a Markdown concept: ${input}`, "INVALID_PATH");
  }
  const filename = segments.at(-1)!;
  if (RESERVED_FILENAMES.has(filename)) {
    throw new MemoryConceptError(`memory concept path uses reserved filename ${filename}`, "RESERVED_PATH");
  }
  return input;
}

function canonicalFrontmatterValue(value: unknown, field: string): MemoryFrontmatterValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MemoryConceptError(`${field} must not contain a non-finite number`, "INVALID_FRONTMATTER");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((member, index) => canonicalFrontmatterValue(member, `${field}[${index}]`));
  }
  if (typeof value === "object") {
    const output: Record<string, MemoryFrontmatterValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (!key || FORBIDDEN_OBJECT_KEYS.has(key)) {
        throw new MemoryConceptError(`${field} contains forbidden key ${JSON.stringify(key)}`, "INVALID_FRONTMATTER");
      }
      output[key] = canonicalFrontmatterValue(
        (value as Record<string, unknown>)[key],
        `${field}.${key}`,
      );
    }
    return output;
  }
  throw new MemoryConceptError(`${field} contains unsupported ${typeof value}`, "INVALID_FRONTMATTER");
}

export function normalizeMemoryFrontmatter(value: unknown): MemoryConceptFrontmatter {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryConceptError("memory concept frontmatter must be a mapping", "INVALID_FRONTMATTER");
  }
  const canonical = canonicalFrontmatterValue(value, "frontmatter");
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new MemoryConceptError("memory concept frontmatter must be a mapping", "INVALID_FRONTMATTER");
  }
  const type = canonical.type;
  if (typeof type !== "string" || !type.trim() || type !== type.trim()) {
    throw new MemoryConceptError('memory concept frontmatter requires a normalized non-empty "type"', "INVALID_FRONTMATTER");
  }
  for (const field of ["title", "description", "resource", "timestamp"] as const) {
    const member = canonical[field];
    if (member !== undefined && typeof member !== "string") {
      throw new MemoryConceptError(`memory concept frontmatter ${field} must be a string`, "INVALID_FRONTMATTER");
    }
  }
  if (canonical.tags !== undefined) {
    if (
      !Array.isArray(canonical.tags) ||
      canonical.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag !== tag.trim())
    ) {
      throw new MemoryConceptError("memory concept frontmatter tags must be normalized non-empty strings", "INVALID_FRONTMATTER");
    }
  }
  return canonical as MemoryConceptFrontmatter;
}

function frontmatterMatch(raw: string): RegExpMatchArray {
  const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    throw new MemoryConceptError("memory concept must start with a closed YAML frontmatter block", "INVALID_MARKDOWN");
  }
  return match;
}

export function parseMemoryConcept(document: CanonicalMemoryDocument): ParsedMemoryConcept {
  const conceptPath = canonicalMemoryConceptPath(document.path);
  if (typeof document.raw !== "string") {
    throw new MemoryConceptError(`memory concept ${conceptPath} is not UTF-8 text`, "INVALID_MARKDOWN");
  }
  if (Buffer.byteLength(document.raw, "utf8") > MAX_MEMORY_CONCEPT_BYTES) {
    throw new MemoryConceptError(`memory concept exceeds ${MAX_MEMORY_CONCEPT_BYTES} bytes: ${conceptPath}`, "TOO_LARGE");
  }
  const match = frontmatterMatch(document.raw);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]);
  } catch (error) {
    throw new MemoryConceptError(
      `memory concept frontmatter is invalid YAML at ${conceptPath}: ${(error as Error).message}`,
      "INVALID_FRONTMATTER",
    );
  }
  const frontmatter = normalizeMemoryFrontmatter(parsed);
  return {
    path: conceptPath,
    raw: document.raw,
    body: document.raw.slice(match[0].length),
    frontmatter,
    contentHash: sha256(document.raw),
  };
}

export function serializeMemoryConcept(frontmatterInput: MemoryConceptFrontmatter, body: string): string {
  if (typeof body !== "string" || body.includes("\0")) {
    throw new MemoryConceptError("memory concept body must be UTF-8 text without NUL bytes", "INVALID_MARKDOWN");
  }
  const frontmatter = normalizeMemoryFrontmatter(frontmatterInput);
  const yaml = Bun.YAML.stringify(frontmatter).trim();
  const normalizedBody = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const raw = `---\n${yaml}\n---\n${normalizedBody}`;
  if (Buffer.byteLength(raw, "utf8") > MAX_MEMORY_CONCEPT_BYTES) {
    throw new MemoryConceptError(`serialized memory concept exceeds ${MAX_MEMORY_CONCEPT_BYTES} bytes`, "TOO_LARGE");
  }
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}

/** Replace one top-level Markdown section, or append it when absent. */
export function replaceMemorySection(body: string, headingInput: string, content: string): string {
  const heading = headingInput.replace(/^#+\s*/, "").trim();
  if (!heading || /[\r\n\0]/.test(heading)) {
    throw new MemoryConceptError("replacement heading must be one non-empty line", "INVALID_MARKDOWN");
  }
  const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const start = lines.findIndex(
    (line) => /^#\s+/.test(line) && line.replace(/^#\s+/, "").trim() === heading,
  );
  if (start === -1) {
    const prefix = body.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}# ${heading}\n\n${content.trim()}\n`;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const before = lines.slice(0, start + 1).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}\n\n${content.trim()}\n${after ? `\n${after}` : ""}`;
}

export function assertSha256(value: string, field: string): string {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`);
  return value;
}
