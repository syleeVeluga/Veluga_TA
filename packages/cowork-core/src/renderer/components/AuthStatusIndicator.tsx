import { useEffect, useState } from 'react';
import { useAppConfig } from '../store/selectors';
import { subscriptionLoginFeatureFlags } from '../../shared/subscription-login-feature-flags';

type Dot = 'green' | 'yellow' | 'red';

const DOT_CLASS: Record<Dot, string> = {
  green: 'bg-success',
  yellow: 'bg-amber-400',
  red: 'bg-error',
};

const EXPIRY_WARN_MS = 5 * 60_000;

/**
 * Compact auth-status pill shown beside the model switcher (Phase 5 §1.6).
 * Only rendered for subscription auth methods; the colored dot reflects health
 * (green ok, yellow expiring <5m, red expired / not ready).
 */
export function AuthStatusIndicator() {
  const appConfig = useAppConfig();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cliReady, setCliReady] = useState<boolean | null>(null);

  const activeProfile = appConfig?.profiles?.[appConfig.activeProfileKey];
  const authMethod = activeProfile?.authMethod ?? 'apikey';
  const isSubscription = authMethod === 'oauth' || authMethod === 'cli-delegate';

  // Tick once a minute to keep the OAuth expiry dot fresh.
  useEffect(() => {
    if (authMethod !== 'oauth') return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [authMethod]);

  // For CLI delegation, probe readiness once when this method becomes active.
  useEffect(() => {
    if (authMethod !== 'cli-delegate' || !window.electronAPI) {
      setCliReady(null);
      return;
    }
    let cancelled = false;
    void window.electronAPI.auth.checkClaudeCli().then((status) => {
      if (!cancelled) setCliReady(status.installed && status.authenticated === true);
    });
    return () => {
      cancelled = true;
    };
  }, [authMethod, appConfig?.activeProfileKey]);

  if (!subscriptionLoginFeatureFlags.enabled || !isSubscription) {
    return null;
  }

  let label: string;
  let dot: Dot;
  if (authMethod === 'oauth') {
    label = 'ChatGPT Plus';
    const expiresAt = activeProfile?.oauthCredentials?.expiresAt;
    if (expiresAt === undefined) dot = 'red';
    else if (expiresAt - nowMs <= 0) dot = 'red';
    else if (expiresAt - nowMs < EXPIRY_WARN_MS) dot = 'yellow';
    else dot = 'green';
  } else {
    label = 'Claude Pro CLI';
    dot = cliReady === null ? 'yellow' : cliReady ? 'green' : 'red';
  }

  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted"
      title={label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOT_CLASS[dot]}`} />
      {label}
    </span>
  );
}
