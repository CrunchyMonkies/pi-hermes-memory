/**
 * Backend factory — selects the memory backend from config.
 *
 * Default is the built-in Markdown + SQLite store (`MemoryStore` + FTS5). When
 * `memoryBackend: "mem0"` is set AND credentials resolve, memory CRUD/search is
 * routed through Mem0 instead. If Mem0 is requested but no API key is available,
 * it logs a warning and falls back to the built-in store so startup never fails.
 */

import { MemoryStore } from "./memory-store.js";
import { DatabaseManager } from "./db.js";
import { DbMemorySearcher } from "./backend.js";
import type { MemoryBackend, MemoryBackendKind, MemorySearcher } from "./backend.js";
import { Mem0Client } from "./mem0-client.js";
import { Mem0Searcher, Mem0Store } from "./mem0-backend.js";
import type { MemoryConfig } from "../types.js";

export interface MemoryBackends {
  store: MemoryBackend;
  projectStore: MemoryBackend | null;
  searcher: MemorySearcher;
  /**
   * DatabaseManager to pass to the memory tool / correction detector for SQLite
   * mirroring. `null` for Mem0 (it persists writes itself), which disables the
   * SQLite sync paths in those consumers.
   */
  toolDbManager: DatabaseManager | null;
  kind: MemoryBackendKind;
}

export interface CreateMemoryBackendsParams {
  config: MemoryConfig;
  globalDir: string;
  dbManager: DatabaseManager;
  /** project.memoryDir — present only when a project is detected. */
  projectMemoryDir?: string;
  projectName: string;
}

export function createMemoryBackends(params: CreateMemoryBackendsParams): MemoryBackends {
  const { config, globalDir, dbManager, projectMemoryDir, projectName } = params;

  if (config.memoryBackend === "mem0") {
    if (Mem0Client.isUsable(config.mem0)) {
      const client = new Mem0Client(config.mem0);
      return {
        store: new Mem0Store(client, null),
        projectStore: projectMemoryDir ? new Mem0Store(client, projectName || null) : null,
        searcher: new Mem0Searcher(client),
        toolDbManager: null,
        kind: "mem0",
      };
    }
    console.warn(
      "⚠️ memoryBackend is \"mem0\" but it is not usable (hosted Platform needs mem0.apiKey or MEM0_API_KEY; " +
        "use a self-hosted mem0.host or mem0.mode \"oss\" to run without a key). Falling back to the built-in memory store.",
    );
  }

  return {
    store: new MemoryStore({ ...config, memoryDir: globalDir }),
    projectStore: projectMemoryDir
      ? new MemoryStore({ ...config, memoryCharLimit: config.projectCharLimit, memoryDir: projectMemoryDir })
      : null,
    searcher: new DbMemorySearcher(dbManager),
    toolDbManager: dbManager,
    kind: "builtin",
  };
}
