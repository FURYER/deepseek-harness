/**
 * Persistent storage for learned model token limits.
 * @module @deepseek-ai/dsh-llm-pi-ai/token-limit-store
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Schema format version for stored token limits. */
export const TOKEN_LIMITS_FORMAT_VERSION = 1
const DEFAULT_RELATIVE_PATH = ['llm-pi-ai', 'token-limits.json']

/** Schema of the stored token limits file. */
export interface StoredTokenLimits {
  /** Format version tag. */
  formatVersion: 1
  /** Map of provider/model route keys to discovered token limits. */
  limits: Record<string, number>
}

/**
 * Resolve the default path where learned token limits are stored on disk.
 * @returns absolute file path in the harness home directory.
 */
export function defaultTokenLimitsPath(): string {
  return join(resolveDshHome(), ...DEFAULT_RELATIVE_PATH)
}

/**
 * Validate and parse raw JSON text containing token limits.
 * @param text - raw JSON string.
 * @returns a map of provider/model keys to token limits, or undefined if invalid.
 */
export function parseTokenLimits(text: string): Map<string, number> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { formatVersion, limits } = parsed as { formatVersion?: unknown; limits?: unknown }
    if (formatVersion !== TOKEN_LIMITS_FORMAT_VERSION) return undefined
    if (typeof limits !== 'object' || limits === null) return undefined

    const result = new Map<string, number>()
    for (const [key, value] of Object.entries(limits as Record<string, unknown>)) {
      if (typeof key === 'string' && typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        result.set(key, value)
      }
    }
    return result
  } catch {
    return undefined
  }
}

/**
 * Load token limits from a file synchronously. Missing or invalid files return an empty map.
 * @param path - absolute file path.
 * @returns loaded limits.
 */
export function loadTokenLimitsSync(path: string): Map<string, number> {
  try {
    const text = readFileSync(path, 'utf8')
    return parseTokenLimits(text) ?? new Map()
  } catch {
    return new Map()
  }
}

/**
 * Persist token limits to disk atomically.
 * @param path - absolute file path.
 * @param limits - current limits map.
 * @returns a promise resolving once saved.
 */
export async function saveTokenLimits(
  path: string,
  limits: ReadonlyMap<string, number>,
): Promise<void> {
  const payload: StoredTokenLimits = {
    formatVersion: TOKEN_LIMITS_FORMAT_VERSION,
    limits: Object.fromEntries(limits.entries()),
  }
  const content = `${JSON.stringify(payload, undefined, 2)}\n`
  await writeFileAtomic(path, content, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

/** Options configuring {@link TokenLimitStore}. */
export interface TokenLimitStoreOptions {
  /** Explicit path to the token limits JSON file, or false to disable disk persistence. */
  path?: string | false | undefined
  /** Optional error callback for persistence failures. */
  onError?: ((error: unknown) => void) | undefined
}

/**
 * Manages in-memory and on-disk persistence for learned provider token limits.
 */
export class TokenLimitStore {
  /** Absolute target file path, or undefined when persistence is disabled. */
  readonly path: string | undefined
  private readonly onError?: ((error: unknown) => void) | undefined
  private pendingWrite: Promise<void> | undefined

  /**
   * @param options - store configuration.
   */
  constructor(options: TokenLimitStoreOptions = {}) {
    this.path = options.path === false ? undefined : (options.path ?? defaultTokenLimitsPath())
    this.onError = options.onError
  }

  /**
   * Load initial limits from disk. Returns an empty map if persistence is disabled or the file is absent/invalid.
   * @returns map of learned limits.
   */
  load(): Map<string, number> {
    if (this.path === undefined) return new Map()
    return loadTokenLimitsSync(this.path)
  }

  /**
   * Persist limits to disk if persistence is enabled. Chains writes to avoid concurrency races.
   * @param limits - snapshot of current limits.
   * @returns promise resolving when persistence finishes.
   */
  async save(limits: ReadonlyMap<string, number>): Promise<void> {
    const { path } = this
    if (path === undefined) return
    const write = async (): Promise<void> => {
      try {
        await saveTokenLimits(path, limits)
      } catch (error) {
        this.onError?.(error)
      }
    }
    this.pendingWrite = (this.pendingWrite ?? Promise.resolve()).then(write, write)
    return this.pendingWrite
  }
}
