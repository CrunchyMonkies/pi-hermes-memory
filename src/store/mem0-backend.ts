/**
 * Mem0 memory backend — implements MemoryBackend / MemorySearcher against Mem0.
 *
 * Entries are stored as Mem0 memories under a single `userId` namespace, scoped
 * by metadata:
 *   - target:   "memory" | "user" | "failure"
 *   - project:  project name (null for global). Only "memory" entries are
 *               project-scoped; "user" and "failure" are global, matching the
 *               built-in Markdown store layout.
 *   - category / failureReason: carried for failures.
 *
 * `replace` / `remove` use substring matching to locate the memory id(s), then
 * Mem0's update / delete — best-effort parity with the Markdown store's
 * substring semantics. The content scanner guards every write, exactly as the
 * built-in store does.
 */

import { scanContent } from "./content-scanner.js";
import { formatFailureMemoryContent } from "./sqlite-memory-store.js";
import type { SqliteMemoryEntry } from "./sqlite-memory-store.js";
import { normalizeMemoryLookupText } from "./memory-lookup.js";
import { Mem0Client } from "./mem0-client.js";
import type { Mem0Memory } from "./mem0-client.js";
import type { MemoryBackend, MemorySearcher, MemorySearchOptions } from "./backend.js";
import type { MemoryCategory, MemoryResult } from "../types.js";

type Target = "memory" | "user" | "failure";

export class Mem0Store implements MemoryBackend {
  constructor(
    private readonly client: Mem0Client,
    private readonly project: string | null = null,
  ) {}

  // Mem0 is the source of truth; nothing to load from local disk.
  async loadFromDisk(): Promise<void> {}

  // Mem0 deduplicates and consolidates server-side; no local consolidation.
  setConsolidator(): void {}

  async add(target: Target, content: string, _signal?: AbortSignal): Promise<MemoryResult> {
    content = content.trim();
    if (!content) return { success: false, error: "Content cannot be empty." };
    const scanError = scanContent(content);
    if (scanError) return { success: false, error: scanError };
    try {
      await this.client.add(content, { metadata: this.metadataFor(target) });
      return { success: true, target, message: "Entry added.", entries: [content] };
    } catch (err) {
      return { success: false, error: `Mem0 add failed: ${message(err)}` };
    }
  }

  async addFailure(
    content: string,
    options: {
      category: MemoryCategory;
      failureReason?: string;
      toolState?: string;
      correctedTo?: string;
      project?: string;
    },
  ): Promise<MemoryResult> {
    content = content.trim();
    if (!content) return { success: false, error: "Content cannot be empty." };
    const scanError = scanContent(content);
    if (scanError) return { success: false, error: scanError };
    const project = options.project ?? this.project ?? null;
    const formatted = formatFailureMemoryContent(content, {
      category: options.category,
      failureReason: options.failureReason,
      toolState: options.toolState,
      correctedTo: options.correctedTo,
      project,
    });
    try {
      await this.client.add(formatted, {
        metadata: {
          target: "failure",
          project,
          category: options.category,
          failureReason: options.failureReason ?? null,
        },
      });
      return { success: true, target: "failure", message: "Entry added.", entries: [formatted] };
    } catch (err) {
      return { success: false, error: `Mem0 add failed: ${message(err)}` };
    }
  }

  async replace(target: Target, oldText: string, newContent: string): Promise<MemoryResult> {
    oldText = normalizeMemoryLookupText(oldText);
    newContent = newContent.trim();
    if (!oldText) return { success: false, error: "old_text cannot be empty." };
    if (!newContent) return { success: false, error: "new_content cannot be empty." };
    const scanError = scanContent(newContent);
    if (scanError) return { success: false, error: scanError };
    try {
      const matches = await this.findMatches(target, oldText);
      if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
      if (distinctContents(matches) > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Provide a more specific old_text.`,
          matches: matches.map((m) => m.content),
        };
      }
      await this.client.update(matches[0].id, newContent);
      return { success: true, target, message: "Entry replaced." };
    } catch (err) {
      return { success: false, error: `Mem0 replace failed: ${message(err)}` };
    }
  }

  async remove(target: Target, oldText: string): Promise<MemoryResult> {
    oldText = normalizeMemoryLookupText(oldText);
    if (!oldText) return { success: false, error: "old_text cannot be empty." };
    try {
      const matches = await this.findMatches(target, oldText);
      if (matches.length === 0) return { success: false, error: `No entry matched '${oldText}'.` };
      if (distinctContents(matches) > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Provide a more specific old_text.`,
          matches: matches.map((m) => m.content),
        };
      }
      await this.client.delete(matches[0].id);
      return { success: true, target, message: "Entry removed." };
    } catch (err) {
      return { success: false, error: `Mem0 remove failed: ${message(err)}` };
    }
  }

  async getMemoryEntries(): Promise<string[]> {
    return this.entriesFor("memory");
  }

  async getUserEntries(): Promise<string[]> {
    return this.entriesFor("user");
  }

  async getFailureEntries(_maxAgeDays?: number): Promise<string[]> {
    return this.entriesFor("failure");
  }

  async getAllFailureEntries(): Promise<string[]> {
    return this.entriesFor("failure");
  }

  async formatForSystemPrompt(): Promise<string> {
    const [memory, user] = await Promise.all([this.entriesFor("memory"), this.entriesFor("user")]);
    const parts: string[] = [];
    if (user.length) parts.push(`USER PROFILE (who the user is)\n${bullets(user)}`);
    if (memory.length) parts.push(`MEMORY (durable notes)\n${bullets(memory)}`);
    if (!parts.length) return "";
    return `<memory-context>\n${parts.join("\n\n")}\n</memory-context>`;
  }

  async formatProjectBlock(projectName: string): Promise<string> {
    const entries = await this.entriesFor("memory");
    if (!entries.length) return "";
    return `<project-memory project="${projectName}">\n${bullets(entries)}\n</project-memory>`;
  }

  private metadataFor(target: Target): Record<string, unknown> {
    return { target, project: target === "memory" ? this.project ?? null : null };
  }

  /** Memory entries belong to this scope's project; user/failure are global. */
  private inScope(memory: Mem0Memory, target: Target): boolean {
    if (memory.metadata.target !== target) return false;
    if (target !== "memory") return true;
    return (memory.metadata.project ?? null) === (this.project ?? null);
  }

  private async entriesFor(target: Target): Promise<string[]> {
    const all = await this.client.getAll();
    return all.filter((m) => this.inScope(m, target)).map((m) => m.content);
  }

  private async findMatches(target: Target, oldText: string): Promise<Mem0Memory[]> {
    const all = await this.client.getAll();
    return all.filter((m) => this.inScope(m, target) && m.content.includes(oldText));
  }
}

/** Backs the `memory_search` tool via Mem0's semantic search. */
export class Mem0Searcher implements MemorySearcher {
  constructor(private readonly client: Mem0Client) {}

  async search(query: string, options: MemorySearchOptions): Promise<SqliteMemoryEntry[]> {
    const limit = options.limit ?? 10;
    const hits = await this.client.search(query, Math.max(limit, 20));
    return hits
      .filter((h) => {
        if (options.target && h.metadata.target !== options.target) return false;
        if (options.category && h.metadata.category !== options.category) return false;
        if (options.project !== undefined && (h.metadata.project ?? null) !== (options.project ?? null)) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(toSqliteEntry);
  }

  async count(): Promise<number> {
    return (await this.client.getAll()).length;
  }
}

function toSqliteEntry(m: Mem0Memory): SqliteMemoryEntry {
  const target = (m.metadata.target as SqliteMemoryEntry["target"]) ?? "memory";
  const now = new Date().toISOString().split("T")[0];
  return {
    id: 0,
    project: (m.metadata.project as string | null) ?? null,
    target,
    category: (m.metadata.category as MemoryCategory | null) ?? null,
    content: m.content,
    failureReason: (m.metadata.failureReason as string | null) ?? null,
    toolState: null,
    correctedTo: null,
    created: m.created ?? now,
    lastReferenced: m.updated ?? m.created ?? now,
  };
}

function bullets(entries: string[]): string {
  return entries.map((e) => `- ${e}`).join("\n");
}

function distinctContents(matches: Mem0Memory[]): number {
  return new Set(matches.map((m) => m.content)).size;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
