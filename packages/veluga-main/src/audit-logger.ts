import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AuditEventInput, AuditLogRow } from '../../shared-types/src/index.js';

interface DatabaseSyncConstructor {
  new (location: string): {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
  };
}

export const PII_PATTERNS = [
  { name: 'rrn', regex: /\b\d{6}[-\s]?\d{7}\b/g, replace: '[RRN-MASKED]' },
  { name: 'phone', regex: /\b01\d[-\s]?\d{3,4}[-\s]?\d{4}\b/g, replace: '[PHONE-MASKED]' },
  { name: 'bank', regex: /\b\d{3,4}[-\s]?\d{2,4}[-\s]?\d{6,}\b/g, replace: '[BANK-MASKED]' }
];

const IMAGE_DATA_URL_PATTERN = /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isImageRecord(value: Record<string, unknown>): boolean {
  return (
    value.type === 'image' ||
    (typeof value.mimeType === 'string' && value.mimeType.startsWith('image/')) ||
    (typeof value.media_type === 'string' && value.media_type.startsWith('image/'))
  );
}

function redactImagePayloads(value: unknown, parentIsImage = false): unknown {
  if (typeof value === 'string') {
    return value.replace(IMAGE_DATA_URL_PATTERN, (match) => `[image data URL omitted: ${match.length} chars]`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactImagePayloads(item, parentIsImage));
  }
  if (!isRecord(value)) {
    return value;
  }

  const currentIsImage = parentIsImage || isImageRecord(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (currentIsImage && key === 'data' && typeof child === 'string') {
        return [key, `[image base64 omitted: ${child.length} chars]`];
      }
      return [key, redactImagePayloads(child, currentIsImage || key === 'source')];
    })
  );
}

export function maskPii(value: unknown): string {
  const redacted = redactImagePayloads(value);
  let text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  for (const pattern of PII_PATTERNS) {
    text = text.replace(pattern.regex, pattern.replace);
  }
  return text;
}

export class AuditLogger {
  private db:
    | {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...params: unknown[]): unknown;
          get(...params: unknown[]): unknown;
          all(...params: unknown[]): unknown[];
        };
      }
    | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const sqlite = (await import('node:sqlite')) as unknown as { DatabaseSync: DatabaseSyncConstructor };
    this.db = new sqlite.DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        policy_version_id TEXT NOT NULL,
        hash_prev TEXT,
        hash_self TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
      CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(FAIL, 'audit_log is append-only'); END;
    `);
  }

  append(input: AuditEventInput): AuditLogRow {
    const db = this.requireDb();
    const prev = db.prepare('SELECT hash_self FROM audit_log ORDER BY id DESC LIMIT 1').get() as
      | { hash_self: string }
      | undefined;
    const ts = new Date().toISOString();
    const payload_json = maskPii(input.payload);
    const hash_prev = prev?.hash_self ?? null;
    const hash_self = createHash('sha256')
      .update(JSON.stringify({ ts, ...input, payload_json, hash_prev }))
      .digest('hex');
    db.prepare(
      `INSERT INTO audit_log
       (ts, session_id, user_id, event_type, payload_json, policy_version_id, hash_prev, hash_self)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ts,
      input.session_id,
      input.user_id,
      input.event_type,
      payload_json,
      input.policy_version_id,
      hash_prev,
      hash_self
    );
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get() as AuditLogRow;
  }

  all(): AuditLogRow[] {
    return this.requireDb().prepare('SELECT * FROM audit_log ORDER BY id').all() as AuditLogRow[];
  }

  unsafeExec(sql: string): void {
    this.requireDb().exec(sql);
  }

  private requireDb() {
    if (!this.db) {
      throw new Error('AuditLogger.init() must be called before use');
    }
    return this.db;
  }
}
