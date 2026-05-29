import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react';
import type { ClaudeCliStatus } from '../../types';

const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code';

/**
 * Claude Pro CLI-delegation panel (Phase 5 §1.4). Reflects the live state of the
 * local Claude Code CLI: not installed → installed-but-logged-out → ready.
 */
export function CliDelegatePanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ClaudeCliStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    if (!window.electronAPI) return;
    setChecking(true);
    try {
      const result = await window.electronAPI.auth.checkClaudeCli();
      setStatus(result);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const recheckButton = (
    <button
      type="button"
      onClick={() => {
        void check();
      }}
      disabled={checking}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-muted text-sm text-text-secondary hover:border-border hover:text-text-primary transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
      {t('api.cliRecheck')}
    </button>
  );

  if (checking && !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('api.cliChecking')}
      </div>
    );
  }

  const installed = status?.installed ?? false;
  const authenticated = status?.authenticated === true;
  const version = status?.version ?? '';

  // State: not installed
  if (!installed) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-amber-500 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{t('api.cliNotInstalledTitle')}</p>
            <p className="text-xs text-text-muted mt-1">{t('api.cliNotInstalledDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void window.electronAPI?.openExternal(INSTALL_URL);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('api.cliInstallGuide')}
          </button>
          {recheckButton}
        </div>
      </div>
    );
  }

  // State: installed but not authenticated
  if (!authenticated) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-text-secondary">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-accent" />
          <div>
            <p className="font-medium text-text-primary">
              {t('api.cliDetectedNotAuthTitle', { version })}
            </p>
            <p className="text-xs text-text-muted mt-1">{t('api.cliDetectedNotAuthDesc')}</p>
          </div>
        </div>
        {recheckButton}
      </div>
    );
  }

  // State: ready
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircle className="w-4 h-4" />
        {t('api.cliReadyTitle', { version })}
      </div>
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircle className="w-4 h-4" />
        {t('api.cliReadyAuthed')}
      </div>
      <div className="flex items-start gap-2 text-xs text-text-muted">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>{t('api.cliNoToolsNote')}</span>
      </div>
      <div className="pt-1">{recheckButton}</div>
    </div>
  );
}
