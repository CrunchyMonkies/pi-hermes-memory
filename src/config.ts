import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryConfig, MemoryOverflowStrategy, SessionSearchVariant, ThinkingLevel } from "./types.js";
import {
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  DEFAULT_PROJECT_CHAR_LIMIT,
  DEFAULT_PROJECTS_MEMORY_DIR,
  DEFAULT_NUDGE_INTERVAL,
  DEFAULT_FLUSH_MIN_TURNS,
  DEFAULT_NUDGE_TOOL_CALLS,
  DEFAULT_REVIEW_RECENT_MESSAGES,
  DEFAULT_FLUSH_RECENT_MESSAGES,
  DEFAULT_CONSOLIDATION_TIMEOUT_MS,
  DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
  DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
  DEFAULT_MEMORY_BACKEND,
} from "./constants.js";
import { AGENT_ROOT, normalizeConfiguredMemoryDir, normalizeProjectsMemoryDir } from "./paths.js";

const MEMORY_OVERFLOW_STRATEGIES: readonly MemoryOverflowStrategy[] = ["auto-consolidate", "reject", "fifo-evict"];
const SESSION_SEARCH_VARIANTS: readonly SessionSearchVariant[] = ["legacy", "anchors"];
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function isMemoryOverflowStrategy(value: unknown): value is MemoryOverflowStrategy {
  return typeof value === "string" && MEMORY_OVERFLOW_STRATEGIES.includes(value as MemoryOverflowStrategy);
}

function isSessionSearchVariant(value: unknown): value is SessionSearchVariant {
  return typeof value === "string" && SESSION_SEARCH_VARIANTS.includes(value as SessionSearchVariant);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

const DEFAULT_CONFIG: MemoryConfig = {
  memoryMode: "policy-only",
  memoryPolicyStyle: "full",
  memoryCharLimit: DEFAULT_MEMORY_CHAR_LIMIT,
  userCharLimit: DEFAULT_USER_CHAR_LIMIT,
  projectCharLimit: DEFAULT_PROJECT_CHAR_LIMIT,
  nudgeInterval: DEFAULT_NUDGE_INTERVAL,
  reviewRecentMessages: DEFAULT_REVIEW_RECENT_MESSAGES,
  reviewEnabled: true,
  flushOnCompact: true,
  flushOnShutdown: true,
  flushMinTurns: DEFAULT_FLUSH_MIN_TURNS,
  flushRecentMessages: DEFAULT_FLUSH_RECENT_MESSAGES,
  memoryOverflowStrategy: "auto-consolidate",
  autoConsolidate: true,
  correctionDetection: true,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS,
  failureInjectionMaxEntries: DEFAULT_FAILURE_INJECTION_MAX_ENTRIES,
  consolidationTimeoutMs: DEFAULT_CONSOLIDATION_TIMEOUT_MS,
  nudgeToolCalls: DEFAULT_NUDGE_TOOL_CALLS,
  projectsMemoryDir: DEFAULT_PROJECTS_MEMORY_DIR,
  sessionSearch: { variant: "legacy" },
  memoryBackend: DEFAULT_MEMORY_BACKEND,
};

export const DEFAULT_CONFIG_PATH = path.join(
  AGENT_ROOT,
  "hermes-memory-config.json",
);

export function loadConfig(configPath = DEFAULT_CONFIG_PATH): MemoryConfig {
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      // Merge: override defaults with user config
      const config: MemoryConfig = { ...DEFAULT_CONFIG };
      const isNonNegativeNumber = (value: unknown): value is number => (
        typeof value === "number" && Number.isFinite(value) && value >= 0
      );
      const isStringArray = (value: unknown): value is string[] => (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
      let hasLegacyAutoConsolidate = false;
      let hasMemoryOverflowStrategy = false;
      if (parsed.memoryMode === "policy-only" || parsed.memoryMode === "legacy-inject") config.memoryMode = parsed.memoryMode;
      if (
        parsed.memoryPolicyStyle === "full" ||
        parsed.memoryPolicyStyle === "compact" ||
        parsed.memoryPolicyStyle === "custom" ||
        parsed.memoryPolicyStyle === "none"
      ) config.memoryPolicyStyle = parsed.memoryPolicyStyle;
      if (typeof parsed.memoryPolicyCustomText === "string") config.memoryPolicyCustomText = parsed.memoryPolicyCustomText;
      if (typeof parsed.memoryCharLimit === "number") config.memoryCharLimit = parsed.memoryCharLimit;
      if (typeof parsed.userCharLimit === "number") config.userCharLimit = parsed.userCharLimit;
      if (typeof parsed.nudgeInterval === "number") config.nudgeInterval = parsed.nudgeInterval;
      if (isNonNegativeNumber(parsed.reviewRecentMessages)) config.reviewRecentMessages = parsed.reviewRecentMessages;
      if (typeof parsed.reviewEnabled === "boolean") config.reviewEnabled = parsed.reviewEnabled;
      if (typeof parsed.flushOnCompact === "boolean") config.flushOnCompact = parsed.flushOnCompact;
      if (typeof parsed.flushOnShutdown === "boolean") config.flushOnShutdown = parsed.flushOnShutdown;
      if (typeof parsed.flushMinTurns === "number") config.flushMinTurns = parsed.flushMinTurns;
      if (isNonNegativeNumber(parsed.flushRecentMessages)) config.flushRecentMessages = parsed.flushRecentMessages;
      if (typeof parsed.autoConsolidate === "boolean") {
        config.autoConsolidate = parsed.autoConsolidate;
        hasLegacyAutoConsolidate = true;
      }
      if (isMemoryOverflowStrategy(parsed.memoryOverflowStrategy)) {
        config.memoryOverflowStrategy = parsed.memoryOverflowStrategy;
        hasMemoryOverflowStrategy = true;
      }
      if (typeof parsed.correctionDetection === "boolean") config.correctionDetection = parsed.correctionDetection;
      if (isStringArray(parsed.correctionStrongPatterns)) config.correctionStrongPatterns = parsed.correctionStrongPatterns;
      if (isStringArray(parsed.correctionWeakPatterns)) config.correctionWeakPatterns = parsed.correctionWeakPatterns;
      if (isStringArray(parsed.correctionNegativePatterns)) config.correctionNegativePatterns = parsed.correctionNegativePatterns;
      if (isStringArray(parsed.correctionDirectiveWords)) config.correctionDirectiveWords = parsed.correctionDirectiveWords;
      if (typeof parsed.consolidationTimeoutMs === "number") config.consolidationTimeoutMs = parsed.consolidationTimeoutMs;
      if (typeof parsed.failureInjectionEnabled === "boolean") config.failureInjectionEnabled = parsed.failureInjectionEnabled;
      if (typeof parsed.failureInjectionMaxAgeDays === "number") config.failureInjectionMaxAgeDays = parsed.failureInjectionMaxAgeDays;
      if (typeof parsed.failureInjectionMaxEntries === "number") config.failureInjectionMaxEntries = parsed.failureInjectionMaxEntries;
      if (typeof parsed.nudgeToolCalls === "number") config.nudgeToolCalls = parsed.nudgeToolCalls;
      if (typeof parsed.projectCharLimit === "number") config.projectCharLimit = parsed.projectCharLimit;
      if (typeof parsed.memoryDir === "string") {
        const normalizedMemoryDir = normalizeConfiguredMemoryDir(parsed.memoryDir);
        if (normalizedMemoryDir) config.memoryDir = normalizedMemoryDir;
      }
      if (typeof parsed.projectsMemoryDir === "string") {
        const normalizedProjectsMemoryDir = normalizeProjectsMemoryDir(parsed.projectsMemoryDir);
        if (normalizedProjectsMemoryDir) config.projectsMemoryDir = normalizedProjectsMemoryDir;
      }
      if (
        typeof parsed.sessionSearch === "object" &&
        parsed.sessionSearch !== null &&
        isSessionSearchVariant(parsed.sessionSearch.variant)
      ) {
        config.sessionSearch = { variant: parsed.sessionSearch.variant };
      }
      if (typeof parsed.llmModelOverride === "string") {
        const trimmed = parsed.llmModelOverride.trim();
        if (trimmed.length > 0) config.llmModelOverride = trimmed;
      }
      if (isThinkingLevel(parsed.llmThinkingOverride)) config.llmThinkingOverride = parsed.llmThinkingOverride;
      if (parsed.memoryBackend === "builtin" || parsed.memoryBackend === "mem0") {
        config.memoryBackend = parsed.memoryBackend;
      }
      if (typeof parsed.mem0 === "object" && parsed.mem0 !== null) {
        const mem0: NonNullable<MemoryConfig["mem0"]> = {};
        if (parsed.mem0.mode === "platform" || parsed.mem0.mode === "oss") mem0.mode = parsed.mem0.mode;
        if (typeof parsed.mem0.apiKey === "string" && parsed.mem0.apiKey.trim()) mem0.apiKey = parsed.mem0.apiKey.trim();
        if (typeof parsed.mem0.host === "string" && parsed.mem0.host.trim()) mem0.host = parsed.mem0.host.trim();
        if (typeof parsed.mem0.userId === "string" && parsed.mem0.userId.trim()) mem0.userId = parsed.mem0.userId.trim();
        if (typeof parsed.mem0.infer === "boolean") mem0.infer = parsed.mem0.infer;
        if (typeof parsed.mem0.oss === "object" && parsed.mem0.oss !== null) mem0.oss = parsed.mem0.oss;
        config.mem0 = mem0;
      }
      if (hasMemoryOverflowStrategy) {
        config.autoConsolidate = config.memoryOverflowStrategy === "auto-consolidate";
      } else if (hasLegacyAutoConsolidate) {
        config.memoryOverflowStrategy = config.autoConsolidate ? "auto-consolidate" : "reject";
      }
      return config;
    }
  } catch {
    // Fall back to defaults on parse error or access issues
  }
  return { ...DEFAULT_CONFIG };
}
