import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const currentLang = i18n.language.startsWith('en') ? 'en' : 'ko';
  const [appVer, setAppVer] = useState('');
  const [isSavingDeepAgent, setIsSavingDeepAgent] = useState(false);
  const deepAgentEnabled = appConfig?.deepAgentEnabled === true;

  useEffect(() => {
    try {
      const version = window.electronAPI?.getVersion?.();
      if (version instanceof Promise) {
        version.then(setAppVer);
      } else if (version) {
        setAppVer(version);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [
    { code: 'ko', nativeName: '한국어' },
    { code: 'en', nativeName: 'English' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem') },
  ];

  const toggleDeepAgent = async () => {
    if (!window.electronAPI || isSavingDeepAgent) return;
    setIsSavingDeepAgent(true);
    try {
      const result = await window.electronAPI.config.save({
        deepAgentEnabled: !deepAgentEnabled,
      });
      if (result?.config) {
        setAppConfig(result.config);
      }
    } finally {
      setIsSavingDeepAgent(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h4 className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Bot className="w-4 h-4" />
              {t('general.deepAgentMode')}
            </h4>
            <p className="text-xs leading-5 text-text-muted">{t('general.deepAgentModeDesc')}</p>
          </div>
          <button
            type="button"
            onClick={toggleDeepAgent}
            disabled={isSavingDeepAgent}
            className={`relative h-7 w-12 flex-shrink-0 rounded-full border transition-colors ${
              deepAgentEnabled
                ? 'border-accent bg-accent'
                : 'border-border-muted bg-surface-muted'
            } ${isSavingDeepAgent ? 'opacity-70 cursor-wait' : ''}`}
            aria-pressed={deepAgentEnabled}
            title={t('general.deepAgentMode')}
          >
            {isSavingDeepAgent ? (
              <Loader2 className="absolute left-3.5 top-1.5 w-4 h-4 animate-spin text-background" />
            ) : (
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
                  deepAgentEnabled ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            )}
          </button>
        </div>
      </div>

      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">Veluga v{appVer}</p>
        </div>
      )}
    </div>
  );
}
