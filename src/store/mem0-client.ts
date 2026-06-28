/**
 * Mem0 client — thin, lazily-loaded wrapper over the `mem0ai` SDK.
 *
 * Supports three deployments:
 *   - Platform (hosted)      — mode "platform", api.mem0.ai + MEM0_API_KEY.
 *   - Platform (self-hosted) — mode "platform" with a custom `host`; the API key
 *                              becomes optional (depends on the server).
 *   - Open source (local)    — mode "oss", `mem0ai/oss` Memory engine, no API
 *                              key. `oss` config (vector store / embedder / LLM)
 *                              is passed straight to the Memory constructor.
 *
 * The `mem0ai` package is imported dynamically the first time the client is
 * used, so installs that never enable the Mem0 backend pay no load cost.
 */

import type { Mem0Config } from "../types.js";
import {
  DEFAULT_MEM0_HOST,
  DEFAULT_MEM0_INFER,
  DEFAULT_MEM0_MODE,
  DEFAULT_MEM0_USER_ID,
} from "../constants.js";

/** A normalized Mem0 memory record (shape varies across SDK versions). */
export interface Mem0Memory {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created?: string;
  updated?: string;
}

export interface Mem0WriteOptions {
  metadata?: Record<string, unknown>;
}

export type Mem0Mode = "platform" | "oss";

export class Mem0Client {
  readonly userId: string;
  readonly mode: Mem0Mode;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly infer: boolean;
  private readonly ossConfig: Record<string, unknown>;
  private clientPromise: Promise<unknown> | null = null;

  constructor(config: Mem0Config = {}) {
    this.userId = config.userId?.trim() || DEFAULT_MEM0_USER_ID;
    this.mode = config.mode === "oss" ? "oss" : DEFAULT_MEM0_MODE;
    this.host = config.host?.trim() || DEFAULT_MEM0_HOST;
    this.apiKey = config.apiKey?.trim() || process.env.MEM0_API_KEY?.trim();
    this.infer = config.infer ?? DEFAULT_MEM0_INFER;
    this.ossConfig = config.oss ?? {};
  }

  /**
   * True if this configuration can run without further input:
   *   - OSS runs locally, so it is always usable.
   *   - Hosted Platform needs an API key.
   *   - Self-hosted Platform (custom host) is allowed without a key.
   */
  static isUsable(config: Mem0Config = {}): boolean {
    if ((config.mode ?? DEFAULT_MEM0_MODE) === "oss") return true;
    if (config.apiKey?.trim() || process.env.MEM0_API_KEY?.trim()) return true;
    const host = config.host?.trim();
    return Boolean(host && host !== DEFAULT_MEM0_HOST);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async client(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = this.mode === "oss" ? this.buildOss() : this.buildPlatform();
    }
    return this.clientPromise;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildPlatform(): Promise<any> {
    if (!this.apiKey && this.host === DEFAULT_MEM0_HOST) {
      throw new Error(
        "Mem0 Platform requires an API key (set mem0.apiKey, MEM0_API_KEY, or point mem0.host at a self-hosted server).",
      );
    }
    const mod = await importModule("mem0ai");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MemoryClient: any = mod.default ?? mod.MemoryClient ?? mod;
    const options: Record<string, unknown> = { host: this.host };
    if (this.apiKey) options.apiKey = this.apiKey;
    return new MemoryClient(options);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildOss(): Promise<any> {
    const mod = await importModule("mem0ai/oss");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Memory: any = mod.Memory ?? mod.default ?? mod;
    return new Memory(this.ossConfig);
  }

  async add(content: string, options: Mem0WriteOptions = {}): Promise<void> {
    const client = await this.client();
    await client.add([{ role: "user", content }], {
      userId: this.userId,
      metadata: options.metadata,
      infer: this.infer,
    });
  }

  async search(query: string, limit = 10): Promise<Mem0Memory[]> {
    const client = await this.client();
    const raw =
      this.mode === "oss"
        ? await client.search(query, { filters: { userId: this.userId }, limit })
        : await client.search(query, { userId: this.userId, topK: limit });
    return normalizeList(raw);
  }

  async getAll(): Promise<Mem0Memory[]> {
    const client = await this.client();
    const raw =
      this.mode === "oss"
        ? await client.getAll({ filters: { userId: this.userId } })
        : await client.getAll({ userId: this.userId });
    return normalizeList(raw);
  }

  async update(id: string, content: string): Promise<void> {
    const client = await this.client();
    // OSS takes the new text directly; Platform takes a payload object.
    if (this.mode === "oss") await client.update(id, content);
    else await client.update(id, { text: content });
  }

  async delete(id: string): Promise<void> {
    const client = await this.client();
    await client.delete(id);
  }
}

/** Indirect dynamic import so TypeScript does not statically resolve the optional dep. */
async function importModule(name: string): Promise<Record<string, unknown>> {
  try {
    const specifier = name;
    return (await import(specifier)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Mem0 SDK not installed — run \`npm install mem0ai\`. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeList(raw: any): Mem0Memory[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.results)
      ? raw.results
      : [];
  return items
    .map(normalizeMemory)
    .filter((m): m is Mem0Memory => m !== null);
}

function normalizeMemory(item: unknown): Mem0Memory | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const content = record.memory ?? record.data ?? record.text ?? record.content;
  if (typeof content !== "string") return null;
  const metadata =
    record.metadata && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(record.id ?? record.memory_id ?? ""),
    content,
    metadata,
    created: asString(record.created_at ?? record.createdAt),
    updated: asString(record.updated_at ?? record.updatedAt),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
