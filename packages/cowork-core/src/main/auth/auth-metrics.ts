/**
 * @module main/auth/auth-metrics
 *
 * Internal-only telemetry for subscription-login (Phase 5 §2.3).
 *
 * HARD CONSTRAINT: no telemetry SaaS, "whiteout" maintained
 * (agent-orchestration-plan §하드제약 2). Counters live in-process and are
 * surfaced only through the local dev log. Never record token values, raw
 * emails, or message content — only event names and anonymized counts.
 */
import { log } from '../utils/logger';

export type AuthMetricName =
  | 'auth.oauth.flow.start'
  | 'auth.oauth.flow.success'
  | 'auth.oauth.flow.error'
  | 'auth.oauth.refresh.success'
  | 'auth.oauth.refresh.fail'
  | 'auth.cli.detect.start'
  | 'auth.cli.detect.installed'
  | 'auth.cli.detect.missing'
  | 'auth.cli.invoke.success'
  | 'auth.cli.invoke.fail'
  | 'chat.message.by_auth_method.apikey'
  | 'chat.message.by_auth_method.oauth'
  | 'chat.message.by_auth_method.cli-delegate';

const counters = new Map<string, number>();

/**
 * Increment an auth metric counter. `reason` (e.g. an error category like
 * `timeout`, `state_mismatch`) is appended to the key — it MUST be a fixed,
 * non-sensitive enum value, never user/token data.
 */
export function recordAuthMetric(name: AuthMetricName, reason?: string): void {
  const key = reason ? `${name}.${reason}` : name;
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  log(`[AuthMetric] ${key} = ${next}`);
}

/** Snapshot of all counters (for diagnostics / tests). */
export function getAuthMetricsSnapshot(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** Test helper — reset all counters. */
export function resetAuthMetrics(): void {
  counters.clear();
}
