import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createMemoryBackends } from "../../src/store/backend-factory.js";
import { DatabaseManager } from "../../src/store/db.js";
import { MemoryStore } from "../../src/store/memory-store.js";
import { Mem0Store } from "../../src/store/mem0-backend.js";
import { loadConfig } from "../../src/config.js";
import type { MemoryConfig } from "../../src/types.js";

describe("createMemoryBackends", () => {
  let tmpDir: string;
  let dbManager: DatabaseManager;
  let savedKey: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-backend-factory-"));
    dbManager = new DatabaseManager(tmpDir);
    savedKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;
  });

  afterEach(() => {
    dbManager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = savedKey;
  });

  function baseConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
    // loadConfig with a missing path returns defaults.
    return { ...loadConfig(path.join(tmpDir, "missing.json")), ...overrides };
  }

  it("defaults to the built-in backend", () => {
    const backends = createMemoryBackends({
      config: baseConfig(),
      globalDir: tmpDir,
      dbManager,
      projectName: "",
    });
    assert.strictEqual(backends.kind, "builtin");
    assert.ok(backends.store instanceof MemoryStore);
    assert.strictEqual(backends.toolDbManager, dbManager);
  });

  it("falls back to built-in when mem0 is selected without credentials", () => {
    const backends = createMemoryBackends({
      config: baseConfig({ memoryBackend: "mem0" }),
      globalDir: tmpDir,
      dbManager,
      projectName: "",
    });
    assert.strictEqual(backends.kind, "builtin");
    assert.strictEqual(backends.toolDbManager, dbManager);
  });

  it("uses the Mem0 backend when selected with an API key", () => {
    process.env.MEM0_API_KEY = "m0-test-key";
    const backends = createMemoryBackends({
      config: baseConfig({ memoryBackend: "mem0" }),
      globalDir: tmpDir,
      dbManager,
      projectName: "",
    });
    assert.strictEqual(backends.kind, "mem0");
    assert.ok(backends.store instanceof Mem0Store);
    // SQLite mirroring is disabled for Mem0.
    assert.strictEqual(backends.toolDbManager, null);
  });

  it("creates a project-scoped Mem0 store when a project dir is present", () => {
    process.env.MEM0_API_KEY = "m0-test-key";
    const backends = createMemoryBackends({
      config: baseConfig({ memoryBackend: "mem0" }),
      globalDir: tmpDir,
      dbManager,
      projectMemoryDir: path.join(tmpDir, "proj"),
      projectName: "proj",
    });
    assert.strictEqual(backends.kind, "mem0");
    assert.ok(backends.projectStore instanceof Mem0Store);
  });

  it("enables a self-hosted Mem0 Platform server without an API key", () => {
    const backends = createMemoryBackends({
      config: baseConfig({ memoryBackend: "mem0", mem0: { host: "http://localhost:8000" } }),
      globalDir: tmpDir,
      dbManager,
      projectName: "",
    });
    assert.strictEqual(backends.kind, "mem0");
    assert.ok(backends.store instanceof Mem0Store);
  });

  it("enables OSS (self-hosted local) mode without an API key", () => {
    const backends = createMemoryBackends({
      config: baseConfig({ memoryBackend: "mem0", mem0: { mode: "oss" } }),
      globalDir: tmpDir,
      dbManager,
      projectName: "",
    });
    assert.strictEqual(backends.kind, "mem0");
    assert.ok(backends.store instanceof Mem0Store);
  });
});
