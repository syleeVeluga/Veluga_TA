import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ContextFragment, WorkPlan } from '../../../shared-types/src/index.js';

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

interface DatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export interface OrchestrationCheckpoint {
  sessionId: string;
  state: string;
  plan: WorkPlan;
  updatedAt: string;
}

export class CheckpointStore {
  private db: DatabaseHandle | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const sqlite = (await import('node:sqlite')) as unknown as { DatabaseSync: DatabaseSyncConstructor };
    this.db = new sqlite.DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orchestration_checkpoint (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestration_task_result (
        session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_orchestration_checkpoint_updated
        ON orchestration_checkpoint(updated_at);
    `);
  }

  save(sessionId: string, state: string, plan: WorkPlan): void {
    const updatedAt = new Date().toISOString();
    this.requireDb()
      .prepare(
        `INSERT INTO orchestration_checkpoint (session_id, state, plan_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           state = excluded.state,
           plan_json = excluded.plan_json,
           updated_at = excluded.updated_at`
      )
      .run(sessionId, state, JSON.stringify(plan), updatedAt);
  }

  loadOpenSessions(): OrchestrationCheckpoint[] {
    return this.requireDb()
      .prepare('SELECT session_id, state, plan_json, updated_at FROM orchestration_checkpoint ORDER BY updated_at')
      .all()
      .map((row) => {
        const record = row as { session_id: string; state: string; plan_json: string; updated_at: string };
        return {
          sessionId: record.session_id,
          state: record.state,
          plan: JSON.parse(record.plan_json) as WorkPlan,
          updatedAt: record.updated_at
        };
      });
  }

  getCachedResult(sessionId: string, idempotencyKey: string): ContextFragment | null {
    const row = this.requireDb()
      .prepare('SELECT result_json FROM orchestration_task_result WHERE session_id = ? AND idempotency_key = ?')
      .get(sessionId, idempotencyKey) as { result_json: string } | undefined;
    return row ? (JSON.parse(row.result_json) as ContextFragment) : null;
  }

  putResult(sessionId: string, idempotencyKey: string, result: ContextFragment): void {
    this.requireDb()
      .prepare(
        `INSERT INTO orchestration_task_result (session_id, idempotency_key, result_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, idempotency_key) DO UPDATE SET
           result_json = excluded.result_json`
      )
      .run(sessionId, idempotencyKey, JSON.stringify(result), new Date().toISOString());
  }

  clear(sessionId: string): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM orchestration_checkpoint WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM orchestration_task_result WHERE session_id = ?').run(sessionId);
  }

  private requireDb(): DatabaseHandle {
    if (!this.db) {
      throw new Error('CheckpointStore.init() must be called before use');
    }
    return this.db;
  }
}
