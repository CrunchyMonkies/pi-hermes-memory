import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";

import { Mem0Store, Mem0Searcher } from "../../src/store/mem0-backend.js";
import type { Mem0Client, Mem0Memory, Mem0WriteOptions } from "../../src/store/mem0-client.js";

/** In-memory fake of the Mem0Client wrapper used to drive the backend. */
class FakeMem0Client {
  readonly userId = "test-user";
  memories: Mem0Memory[] = [];
  private nextId = 1;
  addCalls: Array<{ content: string; options: Mem0WriteOptions }> = [];

  async add(content: string, options: Mem0WriteOptions = {}): Promise<void> {
    this.addCalls.push({ content, options });
    this.memories.push({
      id: String(this.nextId++),
      content,
      metadata: (options.metadata ?? {}) as Record<string, unknown>,
      created: "2026-01-01",
      updated: "2026-01-01",
    });
  }

  async search(query: string, limit = 10): Promise<Mem0Memory[]> {
    return this.memories.filter((m) => m.content.includes(query)).slice(0, limit);
  }

  async getAll(): Promise<Mem0Memory[]> {
    return this.memories.map((m) => ({ ...m }));
  }

  async update(id: string, content: string): Promise<void> {
    const m = this.memories.find((x) => x.id === id);
    if (m) m.content = content;
  }

  async delete(id: string): Promise<void> {
    this.memories = this.memories.filter((x) => x.id !== id);
  }
}

function makeStore(project: string | null = null): { store: Mem0Store; client: FakeMem0Client } {
  const client = new FakeMem0Client();
  const store = new Mem0Store(client as unknown as Mem0Client, project);
  return { store, client };
}

describe("Mem0Store", () => {
  let fake: { store: Mem0Store; client: FakeMem0Client };

  beforeEach(() => {
    fake = makeStore();
  });

  it("add stores content with target/project metadata", async () => {
    const result = await fake.store.add("memory", "Use pnpm in this repo");
    assert.strictEqual(result.success, true);
    assert.strictEqual(fake.client.addCalls.length, 1);
    assert.strictEqual(fake.client.addCalls[0].content, "Use pnpm in this repo");
    assert.deepStrictEqual(fake.client.addCalls[0].options.metadata, {
      target: "memory",
      project: null,
    });
  });

  it("add rejects empty content without calling Mem0", async () => {
    const result = await fake.store.add("memory", "   ");
    assert.strictEqual(result.success, false);
    assert.strictEqual(fake.client.addCalls.length, 0);
  });

  it("add blocks secrets via the content scanner before writing", async () => {
    const secret = `token is ghp_${"a".repeat(36)}`;
    const result = await fake.store.add("memory", secret);
    assert.strictEqual(result.success, false);
    assert.ok(result.error, "should return a scan error");
    assert.strictEqual(fake.client.addCalls.length, 0, "must not write a secret to Mem0");
  });

  it("addFailure stores a formatted failure entry with category metadata", async () => {
    const result = await fake.store.addFailure("npm install failed", {
      category: "failure",
      failureReason: "network timeout",
    });
    assert.strictEqual(result.success, true);
    const meta = fake.client.addCalls[0].options.metadata as Record<string, unknown>;
    assert.strictEqual(meta.target, "failure");
    assert.strictEqual(meta.category, "failure");
    assert.strictEqual(meta.failureReason, "network timeout");
  });

  it("replace updates the single matching entry", async () => {
    await fake.store.add("memory", "Deploy with script A");
    const result = await fake.store.replace("memory", "script A", "Deploy with script B");
    assert.strictEqual(result.success, true);
    const entries = await fake.store.getMemoryEntries();
    assert.deepStrictEqual(entries, ["Deploy with script B"]);
  });

  it("replace returns an error when nothing matches", async () => {
    const result = await fake.store.replace("memory", "nonexistent", "x");
    assert.strictEqual(result.success, false);
    assert.match(result.error ?? "", /No entry matched/);
  });

  it("remove deletes the matching entry", async () => {
    await fake.store.add("memory", "Temporary note");
    const result = await fake.store.remove("memory", "Temporary note");
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(await fake.store.getMemoryEntries(), []);
  });

  it("scopes memory entries by project but keeps user/failure global", async () => {
    const client = new FakeMem0Client();
    const globalStore = new Mem0Store(client as unknown as Mem0Client, null);
    const projectStore = new Mem0Store(client as unknown as Mem0Client, "acme");

    await globalStore.add("memory", "global note");
    await projectStore.add("memory", "acme note");
    await globalStore.add("user", "prefers TypeScript");

    assert.deepStrictEqual(await globalStore.getMemoryEntries(), ["global note"]);
    assert.deepStrictEqual(await projectStore.getMemoryEntries(), ["acme note"]);
    // user entries are global regardless of which scope reads them
    assert.deepStrictEqual(await globalStore.getUserEntries(), ["prefers TypeScript"]);
    assert.deepStrictEqual(await projectStore.getUserEntries(), ["prefers TypeScript"]);
  });
});

describe("Mem0Searcher", () => {
  it("maps Mem0 hits to memory entries and filters by target", async () => {
    const client = new FakeMem0Client();
    const store = new Mem0Store(client as unknown as Mem0Client, null);
    await store.add("memory", "alpha convention");
    await store.add("user", "alpha preference");

    const searcher = new Mem0Searcher(client as unknown as Mem0Client);
    const all = await searcher.search("alpha", { limit: 10 });
    assert.strictEqual(all.length, 2);

    const onlyMemory = await searcher.search("alpha", { target: "memory", limit: 10 });
    assert.strictEqual(onlyMemory.length, 1);
    assert.strictEqual(onlyMemory[0].target, "memory");
    assert.strictEqual(onlyMemory[0].content, "alpha convention");
  });

  it("count reflects the number of stored memories", async () => {
    const client = new FakeMem0Client();
    const store = new Mem0Store(client as unknown as Mem0Client, null);
    const searcher = new Mem0Searcher(client as unknown as Mem0Client);
    assert.strictEqual(await searcher.count(), 0);
    await store.add("memory", "one");
    await store.add("memory", "two");
    assert.strictEqual(await searcher.count(), 2);
  });
});
