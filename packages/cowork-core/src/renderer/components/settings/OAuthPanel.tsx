import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, Loader2, LogIn, LogOut } from 'lucide-react';
import type { AuthProgressEvent, AuthStatusResult } from '../../types';
import { TosAcknowledgeDialog } from './TosAcknowledgeDialog';

type PanelState = 'loading' | 'idle' | 'in_progress' | 'connected' | 'error';

const OPENAI_PROFILE_ID = 'openai';

/** Coarse, locale-free relative expiry label. */
function formatExpiry(expiresAt: number | undefined, nowMs: number): string {
  if (!expiresAt) return '';
  const mins = Math.round((expiresAt - nowMs) / 60_000);
  if (mins <= 0) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * ChatGPT Plus OAuth panel (Phase 5 §1.3). Three states: unauthenticated,
 * login-in-progress, and connected. Gates the first login behind the ToS notice.
 */
export function OAuthPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<PanelState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | undefined>(undefined);
  const [showTos, setShowTos] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const flowIdRef = useRef<string | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI) return;
    const result: AuthStatusResult = await window.electronAPI.auth.getStatus({
      profileId: OPENAI_PROFILE_ID,
    });
    if ('error' in result) {
      setState('idle');
      return;
    }
    if (result.authMethod === 'oauth' && result.loggedIn) {
      setExpiresAt(result.expiresAt);
      setState('connected');
    } else {
      setState('idle');
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Subscribe to OAuth flow progress from the main process.
  useEffect(() => {
    if (!window.electronAPI) return;
    return window.electronAPI.auth.onProgress((event: AuthProgressEvent) => {
      switch (event.status) {
        case 'started':
          setErrorMsg(null);
          setState('in_progress');
          break;
        case 'success':
          flowIdRef.current = undefined;
          void refreshStatus();
          break;
        case 'error':
          flowIdRef.current = undefined;
          setErrorMsg(event.message || t('api.oauthErrorGeneric'));
          setState('error');
          break;
        case 'cancelled':
          flowIdRef.current = undefined;
          setState('idle');
          break;
      }
    });
  }, [refreshStatus, t]);

  // Recompute the expiry label each minute while connected.
  useEffect(() => {
    if (state !== 'connected') return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [state]);

  const beginOAuth = useCallback(async () => {
    if (!window.electronAPI) return;
    setErrorMsg(null);
    setState('in_progress');
    const result = await window.electronAPI.auth.startOAuth({
      provider: 'openai-codex',
      profileId: OPENAI_PROFILE_ID,
    });
    if (result.error) {
      setErrorMsg(result.error);
      setState('error');
      return;
    }
    flowIdRef.current = result.flowId;
  }, []);

  const handleLoginClick = useCallback(async () => {
    if (!window.electronAPI) return;
    const config = await window.electronAPI.config.get();
    if (!config.chatgptPlusTosAckAt) {
      setShowTos(true);
      return;
    }
    void beginOAuth();
  }, [beginOAuth]);

  const handleTosAgree = useCallback(async () => {
    setShowTos(false);
    if (window.electronAPI) {
      await window.electronAPI.config.save({ chatgptPlusTosAckAt: Date.now() });
    }
    void beginOAuth();
  }, [beginOAuth]);

  const handleCancel = useCallback(async () => {
    if (window.electronAPI && flowIdRef.current) {
      await window.electronAPI.auth.cancelOAuth({ flowId: flowIdRef.current });
    }
    flowIdRef.current = undefined;
    setState('idle');
  }, []);

  const handleLogout = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.auth.signOut({ profileId: OPENAI_PROFILE_ID });
    }
    setExpiresAt(undefined);
    setState('idle');
  }, []);

  const expiryLabel = formatExpiry(expiresAt, nowMs);
  const expired = expiresAt !== undefined && expiresAt - nowMs <= 0;

  return (
    <div className="space-y-3">
      {state === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('api.oauthChecking')}
        </div>
      )}

      {(state === 'idle' || state === 'error') && (
        <>
          <p className="text-xs leading-5 text-text-muted">{t('api.oauthConnectDesc')}</p>
          <button
            type="button"
            onClick={() => {
              void handleLoginClick();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors active:scale-[0.98]"
          >
            <LogIn className="w-4 h-4" />
            {t('api.oauthLoginButton')}
          </button>
          <div className="flex items-start gap-2 text-xs text-amber-500 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{t('api.oauthUnofficialWarning')}</span>
          </div>
          {state === 'error' && errorMsg && (
            <p className="text-xs text-error">{errorMsg}</p>
          )}
        </>
      )}

      {state === 'in_progress' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('api.oauthInProgress')}
          </div>
          <button
            type="button"
            onClick={() => {
              void handleCancel();
            }}
            className="px-3 py-1.5 rounded-lg border border-border-muted text-sm text-text-secondary hover:border-border hover:text-text-primary transition-colors"
          >
            {t('api.oauthCancel')}
          </button>
        </div>
      )}

      {state === 'connected' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle className="w-4 h-4" />
            {t('api.oauthConnected')}
          </div>
          <p className="text-xs text-text-muted">{t('api.oauthConnectedDesc')}</p>
          {expiresAt !== undefined && (
            <p className="text-xs text-text-muted">
              {expired ? t('api.oauthExpired') : t('api.oauthExpiry', { time: expiryLabel })}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              void handleLogout();
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-muted text-sm text-text-secondary hover:border-border hover:text-text-primary transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {t('api.oauthLogout')}
          </button>
        </div>
      )}

      {showTos && (
        <TosAcknowledgeDialog
          onAgree={() => {
            void handleTosAgree();
          }}
          onCancel={() => setShowTos(false)}
        />
      )}
    </div>
  );
}
