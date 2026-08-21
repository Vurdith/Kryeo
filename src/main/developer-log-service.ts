import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DeveloperLogEntry, DeveloperLogLevel, DeveloperLogSnapshot } from '../shared/types';

const MAX_MEMORY_ENTRIES = 5_000;
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_STRING_LENGTH = 20_000;
const MAX_ARRAY_ITEMS = 1_000;

const SENSITIVE_KEY = /^(?:key|token|secret|password|credential|authorization|bearer|auth(?:orization)?[-_ ]?token|(?:x[-_])?api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|encrypted[-_ ]?token|model[-_ ]?api[-_ ]?key)$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|private[-_ ]?key|encrypted[-_ ]?token|authorization|bearer|password|secret|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const QUERY_SECRET = /([?&](?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|key)=)[^&#\s]+/gi;
const BEARER_TOKEN = /\bBearer\s+[^\s"'`,;}]+/gi;
const TOKEN_SHAPES = /\b(?:sk|rk|pk|ghp|github_pat|glpat|xox[baprs]|hf|gsk)[_-][A-Za-z0-9._-]{8,}\b/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const DATA_URI = /data:[^,\s]+;base64,[A-Za-z0-9+/=]+/gi;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function redactString(value: string, secrets: string[]): string {
  if (!value) return value;
  let output = value.replace(DATA_URI, '[data URI omitted]');
  for (const secret of secrets.sort((left, right) => right.length - left.length)) {
    if (secret.length >= 6) output = output.split(secret).join('[REDACTED]');
  }
  output = output
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(SENSITIVE_TEXT, (match) => match.replace(/([:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/, '$1[REDACTED]'))
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(TOKEN_SHAPES, '[REDACTED]')
    .replace(JWT, '[REDACTED]');
  if (output.length <= MAX_STRING_LENGTH) return output;
  return `${output.slice(0, MAX_STRING_LENGTH)}… [truncated ${output.length - MAX_STRING_LENGTH} characters]`;
}

function collectSecrets(value: unknown, secrets: Set<string>, seen: WeakSet<object>): void {
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Error) {
    collectSecrets(value.message, secrets, seen);
    collectSecrets(value.stack, secrets, seen);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSecrets(item, secrets, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && typeof child === 'string' && child.length >= 6) secrets.add(child);
    collectSecrets(child, secrets, seen);
  }
}

function sanitizeValue(value: unknown, secrets: string[], seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value, secrets);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (depth > 10) return '[nested value omitted]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
      ...(value.stack ? { stack: redactString(value.stack, secrets) } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
    const bytes = value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
    return `[binary data omitted: ${bytes} bytes]`;
  }
  if (seen.has(value as object)) return '[circular reference]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, secrets, seen, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[${value.length - MAX_ARRAY_ITEMS} additional items omitted]`);
    return items;
  }
  if (isObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeValue(child, secrets, seen, depth + 1);
    }
    return output;
  }
  return redactString(String(value), secrets);
}

export function sanitizeDeveloperValue(value: unknown): unknown {
  const secrets = new Set<string>();
  collectSecrets(value, secrets, new WeakSet<object>());
  return sanitizeValue(value, [...secrets], new WeakSet<object>());
}

export class DeveloperLogService {
  private enabled = false;
  private entries: DeveloperLogEntry[] = [];
  private readonly secrets = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writesSinceTrim = 0;
  private loaded = false;
  private readonly logDirectory: () => string;

  constructor(logDirectory: () => string) {
    this.logDirectory = logDirectory;
    for (const [key, value] of Object.entries(process.env)) {
      if (value && /key|token|secret|password|credential/i.test(key) && value.length >= 6) this.secrets.add(value);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  filePath(): string {
    return path.join(this.logDirectory(), 'kryeo-developer.log');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await fs.readFile(this.filePath(), 'utf8');
      this.entries = content
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-MAX_MEMORY_ENTRIES)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as DeveloperLogEntry;
            return parsed && typeof parsed === 'object' && typeof parsed.message === 'string' ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch {
      this.entries = [];
    }
  }

  private queueWrite(entry: DeveloperLogEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await fs.mkdir(this.logDirectory(), { recursive: true });
        await fs.appendFile(this.filePath(), line, 'utf8');
        this.writesSinceTrim += 1;
        if (this.writesSinceTrim >= 250) {
          this.writesSinceTrim = 0;
          await this.trimFile();
        }
      } catch {
        // Developer logging must never break the workflow it is observing.
      }
    });
  }

  private async trimFile(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath(), 'utf8');
      if (Buffer.byteLength(content, 'utf8') <= MAX_LOG_BYTES) return;
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-MAX_MEMORY_ENTRIES);
      await fs.writeFile(this.filePath(), `${lines.join('\n')}\n`, 'utf8');
    } catch {
      // A log rotation failure is not a product failure.
    }
  }

  private broadcast(entry: DeveloperLogEntry): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('kryeo:developer-log', entry);
      }
    }
  }

  record(
    level: DeveloperLogLevel,
    source: string,
    event: string,
    message: string,
    data?: unknown,
  ): DeveloperLogEntry | undefined {
    if (!this.enabled) return undefined;
    const payload = data === undefined ? { message } : { message, data };
    collectSecrets(payload, this.secrets, new WeakSet<object>());
    const sanitized = sanitizeValue(payload, [...this.secrets], new WeakSet<object>()) as { message: string; data?: unknown };
    const entry: DeveloperLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      level,
      source,
      event,
      message: String(sanitized.message),
      ...(data === undefined ? {} : { data: sanitized.data }),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY_ENTRIES) this.entries.shift();
    this.queueWrite(entry);
    this.broadcast(entry);
    return entry;
  }

  async setEnabled(enabled: boolean): Promise<DeveloperLogSnapshot> {
    if (enabled) {
      await this.load();
      const wasEnabled = this.enabled;
      this.enabled = true;
      if (!wasEnabled) this.record('info', 'developer-mode', 'enabled', 'Developer logging enabled.', { filePath: this.filePath() });
    } else {
      if (this.enabled) this.record('info', 'developer-mode', 'disabled', 'Developer logging disabled.');
      this.enabled = false;
    }
    await this.writeQueue;
    return this.snapshot();
  }

  async clear(): Promise<DeveloperLogSnapshot> {
    await this.writeQueue;
    try {
      await fs.rm(this.filePath(), { force: true });
    } catch {
      // The file may not exist yet.
    }
    this.entries = [];
    this.writesSinceTrim = 0;
    this.loaded = true;
    return this.snapshot();
  }

  snapshot(): DeveloperLogSnapshot {
    return {
      enabled: this.enabled,
      entries: this.entries.slice(-MAX_MEMORY_ENTRIES),
      filePath: this.filePath(),
    };
  }
}
