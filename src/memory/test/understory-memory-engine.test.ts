import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  UnderstoryMemoryProjection,
  UnderstoryMemoryService,
  parseMemoryConcept,
  planMemoryMigration,
  serializeMemoryConcept,
  type CanonicalMemoryAuthority,
  type CanonicalMemoryDocument,
  type CanonicalMemorySnapshot,
  type CanonicalMemoryTransaction,
  type LegacyMemorySource,
} from "../../engine/memory";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function concept(
  path: string,
  type: string,
  title: string,
  body: string,
  options: { description?: string; tags?: string[] } = {},
): CanonicalMemoryDocument {
  return {
    path,
    raw: serializeMemoryConcept(
      {
        type,
        title,
        ...(options.description ? { description: options.description } : {}),
        ...(options.tags ? { tags: options.tags } : {}),
      },
      body,
    ),
  };
}

class FakeCanonicalMemoryAuthority implements CanonicalMemoryAuthority {
  snapshot: CanonicalMemorySnapshot;
  transactions: CanonicalMemoryTransaction[] = [];
  rejectNextTransaction = false;

  constructor(documents: CanonicalMemoryDocument[]) {
    this.snapshot = { revision: "commit-1", documents };
  }

  async readSnapshot(): Promise<CanonicalMemorySnapshot> {
    return {
      revision: this.snapshot.revision,
      documents: this.snapshot.documents.map((document) => ({ ...document })),
    };
  }

  async transact(transaction: CanonicalMemoryTransaction): Promise<{ revision: string }> {
    this.transactions.push(structuredClone(transaction));
    if (this.rejectNextTransaction) {
      this.rejectNextTransaction = false;
      this.snapshot = { ...this.snapshot, revision: "concurrent-commit" };
      throw new Error("optimistic base commit is stale");
    }
    if (transaction.baseRevision !== this.snapshot.revision) throw new Error("optimistic base commit is stale");
    const documents = new Map(this.snapshot.documents.map((document) => [document.path, { ...document }]));
    for (const mutation of transaction.mutations) {
      const existing = documents.get(mutation.path);
      const existingHash = existing ? hash(existing.raw) : null;
      if (existingHash !== mutation.expectedContentHash) throw new Error(`content hash mismatch at ${mutation.path}`);
      if (mutation.type === "delete") documents.delete(mutation.path);
      else documents.set(mutation.path, { path: mutation.path, raw: mutation.raw });
    }
    const revision = `commit-${this.transactions.length + 1}`;
    this.snapshot = {
      revision,
      documents: [...documents.values()].sort((left, right) => left.path.localeCompare(right.path)),
    };
    return { revision };
  }
}

describe("Understory-derived canonical memory boundary", () => {
  test("primary path: query, graph, and update use one canonical Markdown authority", async () => {
    const authority = new FakeCanonicalMemoryAuthority([
      concept(
        "/concepts/andromeda.md",
        "system",
        "Andromeda",
        "The engine links to [AMS](/concepts/ams.md).\n",
        { description: "Unified agent product", tags: ["agent", "runtime"] },
      ),
      concept(
        "/concepts/ams.md",
        "model-runtime",
        "AMS",
        "Sparse local inference runtime.\n",
        { description: "Local model runtime", tags: ["runtime"] },
      ),
    ]);
    const projection = new UnderstoryMemoryProjection();
    const service = new UnderstoryMemoryService(authority, projection);
    try {
      const first = await service.refresh();
      expect(first.conceptCount).toBe(2);
      expect((await service.search("local runtime"))[0]).toMatchObject({
        path: "/concepts/ams.md",
        type: "model-runtime",
      });
      expect(await service.graph()).toMatchObject({
        edges: [{ source: "/concepts/andromeda.md", target: "/concepts/ams.md" }],
        brokenLinks: [],
      });

      const current = await service.read("/concepts/ams.md");
      expect(current).not.toBeNull();
      const committed = await service.update(
        [
          {
            type: "patch",
            path: "/concepts/ams.md",
            expectedContentHash: current!.contentHash,
            frontmatter: { tags: ["runtime", "quantization"] },
            replaceSection: { heading: "Qualification", content: "Native layer gate passed." },
          },
        ],
        {
          actor: "memory-plugin:test",
          evidence: { uri: "session://test/primary", contentHash: hash("primary evidence") },
        },
      );

      expect(committed.revision).toBe("commit-2");
      expect(authority.transactions).toHaveLength(1);
      expect(authority.transactions[0].baseRevision).toBe("commit-1");
      expect((await service.search("qualification", { tags: ["quantization"] }))[0]?.path).toBe(
        "/concepts/ams.md",
      );
      expect((await service.read("/concepts/ams.md"))?.body).toContain("Native layer gate passed.");
    } finally {
      projection.close();
    }
  });

  test("edge input: malformed and reserved concepts fail before replacing a good projection", () => {
    const projection = new UnderstoryMemoryProjection();
    try {
      const good = {
        revision: "good",
        documents: [concept("/concepts/good.md", "fact", "Good", "Known-good content.\n")],
      };
      const baseline = projection.rebuild(good);
      expect(() =>
        projection.rebuild({
          revision: "bad",
          documents: [{ path: "/concepts/index.md", raw: "---\ntype: fact\n---\nReserved.\n" }],
        }),
      ).toThrow("reserved filename");
      expect(projection.metadata()).toEqual(baseline);
      expect(projection.read("/concepts/good.md")?.frontmatter.title).toBe("Good");
      expect(() =>
        projection.rebuild({
          revision: "bad-yaml",
          documents: [{ path: "/concepts/bad.md", raw: "---\ntitle: missing-type\n---\nNo type.\n" }],
        }),
      ).toThrow('requires a normalized non-empty "type"');
      expect(projection.metadata()).toEqual(baseline);
    } finally {
      projection.close();
    }
  });

  test("denied failure: stale state rejection never advances the derivative projection", async () => {
    const authority = new FakeCanonicalMemoryAuthority([
      concept("/concepts/fact.md", "fact", "Fact", "Original.\n"),
    ]);
    const projection = new UnderstoryMemoryProjection();
    const service = new UnderstoryMemoryService(authority, projection);
    try {
      const before = await service.refresh();
      const current = await service.read("/concepts/fact.md");
      authority.rejectNextTransaction = true;
      await expect(
        service.update(
          [
            {
              type: "put",
              path: "/concepts/fact.md",
              frontmatter: { type: "fact", title: "Fact" },
              body: "Uncommitted candidate.\n",
              expectedContentHash: current!.contentHash,
            },
          ],
          {
            actor: "memory-plugin:test",
            evidence: { uri: "session://test/stale", contentHash: hash("stale evidence") },
          },
        ),
      ).rejects.toThrow("optimistic base commit is stale");
      expect(projection.metadata()).toEqual(before);
      expect(projection.read("/concepts/fact.md")?.body).toBe("Original.\n");
    } finally {
      projection.close();
    }
  });
});

describe("deterministic memory migration receipts", () => {
  const overlapping: LegacyMemorySource[] = Array.from({ length: 5 }, (_, index) => [
    {
      sourcePath: `wiki/topic-${index + 1}.md`,
      topic: `Shared Topic ${index + 1}`,
      bytes: `# Shared Topic ${index + 1}\n\nWiki evidence ${index + 1}.\n`,
    },
    {
      sourcePath: `research/topic-${index + 1}.json`,
      topic: `Shared Topic ${index + 1}`,
      bytes: JSON.stringify({ source: "research", topic: index + 1 }),
    },
  ]).flat();

  test("primary path: five overlapping topics merge while retaining every source hash", () => {
    const plan = planMemoryMigration(overlapping);
    expect(plan.receipt).toMatchObject({
      schemaVersion: 1,
      sourceCount: 10,
      conceptCount: 5,
      mergedSourceCount: 5,
    });
    expect(plan.concepts).toHaveLength(5);
    expect(plan.concepts.every((entry) => entry.evidence.length === 2)).toBeTrue();
    expect(new Set(plan.concepts.flatMap((entry) => entry.evidence.map((evidence) => evidence.sha256))).size).toBe(10);
    for (const migrated of plan.concepts) {
      const parsed = parseMemoryConcept(migrated);
      expect((parsed.frontmatter.andromeda_evidence as unknown[]).length).toBe(2);
      expect(hash(migrated.raw)).toBe(migrated.contentHash);
    }
  });

  test("edge input: source order cannot change paths, counts, hashes, or generated bytes", () => {
    const forward = planMemoryMigration(overlapping);
    const reverse = planMemoryMigration([...overlapping].reverse());
    expect(reverse.receipt).toEqual(forward.receipt);
    expect(reverse.concepts).toEqual(forward.concepts);

    const reserved = planMemoryMigration([
      { sourcePath: "AGENTS.md", bytes: "# Instructions\n\nHistorical, non-authoritative evidence.\n" },
      { sourcePath: "index.md", bytes: "# Generated index\n\nHistorical index evidence.\n" },
    ]);
    expect(reserved.concepts.map((entry) => entry.path)).toEqual([
      "/concepts/generated-index.md",
      "/concepts/instructions.md",
    ]);
    expect(reserved.concepts.every((entry) => !/\/(?:agents|index)\.md$/.test(entry.path))).toBeTrue();
  });

  test("denied failure: duplicate provenance paths are rejected and changed bytes change the plan hash", () => {
    expect(() =>
      planMemoryMigration([
        { sourcePath: "wiki/same.md", bytes: "one" },
        { sourcePath: "wiki/same.md", bytes: "two" },
      ]),
    ).toThrow("repeats source path");
    const original = planMemoryMigration(overlapping);
    const changed = planMemoryMigration([
      ...overlapping.slice(0, -1),
      { ...overlapping.at(-1)!, bytes: '{"source":"research","topic":5,"changed":true}' },
    ]);
    expect(changed.receipt.planHash).not.toBe(original.receipt.planHash);
    const changedSource = changed.receipt.sources.find((source) => source.sourcePath === "research/topic-5.json");
    const originalSource = original.receipt.sources.find((source) => source.sourcePath === "research/topic-5.json");
    expect(changedSource?.sha256).not.toBe(originalSource?.sha256);
  });
});
