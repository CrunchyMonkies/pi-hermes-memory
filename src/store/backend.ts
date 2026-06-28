/**
 * MemoryBackend — pluggable persistence abstraction for memory entries.
 *
 * The built-in Markdown store (`MemoryStore`) satisfies this interface as-is:
 * its public methods are synchronous, which are assignable to the `MaybePromise`
 * return types declared here. Alternative backends (e.g. Mem0) implement the same
 * surface with async network calls, so consumers MUST `await` every read/format
 * method — awaiting a synchronous value is a no-op, so the built-in path is
 * unaffected.
 */

import { DatabaseManager } from "./db.js";
import { getMemoryStats, searchMemories } from "./sqlite-memory-store.js";
import type { SqliteMemoryEntry } from "./sqlite-memory-store.js";
import type { ConsolidationResult, MemoryCategory, MemoryResult } from "../types.js";

export type { MemoryBackendKind } from "../types.js";

export type MaybePromise<T> = T | Promise<T>;

/**
 * The public surface the memory tool, prompt context, learning loop, and
 * commands depend on. Mirrors `MemoryStore`'s public methods.
 */
export interface MemoryBackend {
  loadFromDisk(): Promise<void>;
  add(target: "memory" | "user" | "failure", content: string, signal?: AbortSignal): Promise<MemoryResult>;
  addFailure(content: string, options: {
    category: MemoryCategory;
    failureReason?: string;
    toolState?: string;
    correctedTo?: string;
    project?: string;
  }): Promise<MemoryResult>;
  replace(target: "memory" | "user" | "failure", oldText: string, newContent: string): Promise<MemoryResult>;
  remove(target: "memory" | "user" | "failure", oldText: string): Promise<MemoryResult>;
  formatForSystemPrompt(): MaybePromise<string>;
  formatProjectBlock(projectName: string): MaybePromise<string>;
  getMemoryEntries(): MaybePromise<string[]>;
  getUserEntries(): MaybePromise<string[]>;
  getFailureEntries(maxAgeDays?: number): MaybePromise<string[]>;
  getAllFailureEntries(): MaybePromise<string[]>;
  setConsolidator(fn: (target: "memory" | "user" | "failure", signal?: AbortSignal) => Promise<ConsolidationResult>): void;
}

export interface MemorySearchOptions {
  project?: string;
  target?: string;
  category?: MemoryCategory;
  limit?: number;
}

/**
 * Backs the `memory_search` tool. The built-in implementation queries SQLite
 * FTS5; the Mem0 implementation queries Mem0's semantic search.
 */
export interface MemorySearcher {
  search(query: string, options: MemorySearchOptions): MaybePromise<SqliteMemoryEntry[]>;
  /** Total number of stored memory entries (used to short-circuit empty stores). */
  count(): MaybePromise<number>;
}

/** Built-in searcher backed by the SQLite FTS5 store. */
export class DbMemorySearcher implements MemorySearcher {
  constructor(private readonly dbManager: DatabaseManager) {}

  search(query: string, options: MemorySearchOptions): SqliteMemoryEntry[] {
    return searchMemories(this.dbManager, query, options);
  }

  count(): number {
    return getMemoryStats(this.dbManager).total;
  }
}

/** Normalize any `DatabaseManager | MemorySearcher` into a `MemorySearcher`. */
export function asMemorySearcher(source: DatabaseManager | MemorySearcher): MemorySearcher {
  return source instanceof DatabaseManager ? new DbMemorySearcher(source) : source;
}
