// Derived from Understory at 912cfa6d4f407ffdb768bcd667bd701ccfe9ecb2.
// Copyright 2026 Anirban Kar. Modified by Andromeda contributors.
// Licensed under the Apache License, Version 2.0.

import {
  assertSha256,
  canonicalMemoryConceptPath,
  parseMemoryConcept,
  replaceMemorySection,
  serializeMemoryConcept,
} from "./okf";
import { UnderstoryMemoryProjection } from "./projection";
import type {
  CanonicalMemoryAuthority,
  CanonicalMemoryDocument,
  CanonicalMemoryEvidence,
  CanonicalMemorySnapshot,
  CanonicalMemoryTransactionMutation,
  MemoryFrontmatterValue,
  MemoryGraph,
  MemorySearchHit,
  MemorySearchOptions,
  MemoryUpdate,
  MemoryValidationReport,
  ParsedMemoryConcept,
} from "./types";

function requiredOneLine(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`${field} is required and must be one normalized line`);
  }
  return value;
}

function validateEvidence(evidence: CanonicalMemoryEvidence): CanonicalMemoryEvidence {
  const uri = requiredOneLine(evidence.uri, "memory transaction evidence URI");
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("memory transaction evidence URI must be absolute");
  }
  if (!parsed.protocol) throw new Error("memory transaction evidence URI must include a scheme");
  return {
    uri,
    contentHash: assertSha256(evidence.contentHash, "memory transaction evidence hash"),
  };
}

function documentMap(snapshot: CanonicalMemorySnapshot): Map<string, CanonicalMemoryDocument> {
  const documents = new Map<string, CanonicalMemoryDocument>();
  for (const document of snapshot.documents) {
    const parsed = parseMemoryConcept(document);
    if (documents.has(parsed.path)) throw new Error(`canonical memory repeats path ${parsed.path}`);
    documents.set(parsed.path, { path: parsed.path, raw: parsed.raw });
  }
  return documents;
}

function applyFrontmatterPatch(
  source: ParsedMemoryConcept["frontmatter"],
  patch: Record<string, MemoryFrontmatterValue | null> | undefined,
): ParsedMemoryConcept["frontmatter"] {
  if (!patch) return source;
  const next = { ...source };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

function transactionMutations(
  snapshot: CanonicalMemorySnapshot,
  updates: readonly MemoryUpdate[],
): CanonicalMemoryTransactionMutation[] {
  if (updates.length === 0) throw new Error("memory transaction requires at least one update");
  const documents = documentMap(snapshot);
  const touched = new Set<string>();
  const mutations: CanonicalMemoryTransactionMutation[] = [];
  for (const update of updates) {
    const conceptPath = canonicalMemoryConceptPath(update.path);
    if (touched.has(conceptPath)) throw new Error(`memory transaction repeats path ${conceptPath}`);
    touched.add(conceptPath);
    const currentDocument = documents.get(conceptPath);
    const current = currentDocument ? parseMemoryConcept(currentDocument) : null;
    if (update.type === "put") {
      if (update.expectedContentHash === null) {
        if (current) throw new Error(`memory concept already exists: ${conceptPath}`);
      } else {
        assertSha256(update.expectedContentHash, "expected memory content hash");
        if (!current || current.contentHash !== update.expectedContentHash) {
          throw new Error(`memory concept content changed before update: ${conceptPath}`);
        }
      }
      const raw = serializeMemoryConcept(update.frontmatter, update.body);
      parseMemoryConcept({ path: conceptPath, raw });
      mutations.push({
        type: "put",
        path: conceptPath,
        raw,
        expectedContentHash: update.expectedContentHash,
      });
      documents.set(conceptPath, { path: conceptPath, raw });
      continue;
    }
    if (!current || current.contentHash !== assertSha256(update.expectedContentHash, "expected memory content hash")) {
      throw new Error(`memory concept content changed before ${update.type}: ${conceptPath}`);
    }
    if (update.type === "delete") {
      mutations.push({
        type: "delete",
        path: conceptPath,
        expectedContentHash: update.expectedContentHash,
      });
      documents.delete(conceptPath);
      continue;
    }
    if (update.replaceBody !== undefined && update.replaceSection !== undefined) {
      throw new Error("memory patch cannot replace the full body and one section together");
    }
    const body =
      update.replaceBody ??
      (update.replaceSection
        ? replaceMemorySection(current.body, update.replaceSection.heading, update.replaceSection.content)
        : current.body);
    const raw = serializeMemoryConcept(applyFrontmatterPatch(current.frontmatter, update.frontmatter), body);
    parseMemoryConcept({ path: conceptPath, raw });
    mutations.push({
      type: "put",
      path: conceptPath,
      raw,
      expectedContentHash: update.expectedContentHash,
    });
    documents.set(conceptPath, { path: conceptPath, raw });
  }
  // Validate the complete candidate snapshot before the state authority sees a mutation.
  for (const document of documents.values()) parseMemoryConcept(document);
  return mutations;
}

function assertCommitted(
  before: CanonicalMemorySnapshot,
  after: CanonicalMemorySnapshot,
  mutations: readonly CanonicalMemoryTransactionMutation[],
): void {
  const expected = documentMap(before);
  for (const mutation of mutations) {
    if (mutation.type === "delete") expected.delete(mutation.path);
    else expected.set(mutation.path, { path: mutation.path, raw: mutation.raw });
  }
  const committed = documentMap(after);
  if (committed.size !== expected.size) {
    throw new Error(
      `canonical memory authority published ${committed.size} concepts; expected ${expected.size}`,
    );
  }
  for (const [conceptPath, document] of expected) {
    if (committed.get(conceptPath)?.raw !== document.raw) {
      throw new Error(`canonical memory authority did not publish exact snapshot bytes for ${conceptPath}`);
    }
  }
}

/**
 * Query/update boundary for the built-in Memory plugin.
 *
 * Every mutation crosses CanonicalMemoryAuthority with an optimistic base
 * revision. SQLite and graph state are refreshed only from the committed
 * Markdown snapshot, never from the caller's candidate.
 */
export class UnderstoryMemoryService {
  constructor(
    private readonly authority: CanonicalMemoryAuthority,
    private readonly projection: UnderstoryMemoryProjection,
  ) {}

  async refresh(): Promise<{ revision: string; digest: string; conceptCount: number }> {
    return this.projection.ensure(await this.authority.readSnapshot());
  }

  async read(conceptPath: string): Promise<ParsedMemoryConcept | null> {
    await this.refresh();
    return this.projection.read(conceptPath);
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]> {
    await this.refresh();
    return this.projection.search(query, options);
  }

  async graph(): Promise<MemoryGraph> {
    await this.refresh();
    return this.projection.graph();
  }

  async validate(): Promise<MemoryValidationReport> {
    await this.refresh();
    return this.projection.validate();
  }

  async update(
    updates: readonly MemoryUpdate[],
    options: { actor: string; evidence: CanonicalMemoryEvidence },
  ): Promise<{ revision: string; digest: string; conceptCount: number }> {
    const actor = requiredOneLine(options.actor, "memory transaction actor");
    const evidence = validateEvidence(options.evidence);
    const before = await this.authority.readSnapshot();
    const mutations = transactionMutations(before, updates);
    const result = await this.authority.transact({
      baseRevision: before.revision,
      actor,
      evidence,
      mutations,
    });
    const after = await this.authority.readSnapshot();
    if (after.revision !== result.revision) {
      throw new Error(
        `canonical memory authority returned revision ${result.revision} but published ${after.revision}`,
      );
    }
    assertCommitted(before, after, mutations);
    return this.projection.rebuild(after);
  }
}
