import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, Cpu } from 'lucide-react';
import { useAppStore } from '../store';
import { useAppConfig } from '../store/selectors';
import type { AppConfig, ProviderModelInfo, ProviderPresets, ProviderProfileKey } from '../types';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { FALLBACK_PROVIDER_PRESETS, getModelOptionsForProfile } from '../hooks/useApiConfigState';
import {
  deriveThinkingLevel,
  modelSupportsReasoning,
  type SharedThinkingLevel,
} from '../../shared/thinking';
import { ThinkingLevelSegmentedControl } from './ThinkingLevelSegmentedControl';

interface ModelGroup {
  key: ProviderProfileKey;
  label: string;
  models: ProviderModelInfo[];
}

const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

function profileLabel(profileKey: ProviderProfileKey, presets: ProviderPresets): string {
  if (profileKey === 'custom:anthropic') return 'Custom (Anthropic)';
  if (profileKey === 'custom:openai') return 'Custom (OpenAI)';
  if (profileKey === 'custom:gemini') return 'Custom (Gemini)';
  return presets[profileKey]?.name || profileKey;
}

function hasUsableProfile(profileKey: ProviderProfileKey, appConfig: AppConfig): boolean {
  const profile = appConfig.profiles?.[profileKey];
  if (!profile) return false;
  if (profile.apiKey?.trim()) return true;
  if (profileKey === 'ollama') return true;
  return Boolean(profile.baseUrl && isLoopbackBaseUrl(profile.baseUrl));
}

export function ChatHeaderModelSwitcher() {
  const { t } = useTranslation();
  const appConfig = useAppConfig();
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const [presets, setPresets] = useState<ProviderPresets>(FALLBACK_PROVIDER_PRESETS);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!window.electronAPI) return;
    void window.electronAPI.config.getPresets().then((loaded) => {
      if (!cancelled) {
        setPresets(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const modelGroups = useMemo<ModelGroup[]>(() => {
    if (!appConfig) return [];
    return PROFILE_KEYS.filter(
      (profileKey) =>
        profileKey === appConfig.activeProfileKey || hasUsableProfile(profileKey, appConfig)
    ).map((profileKey) => {
      const models = getModelOptionsForProfile(profileKey, presets);
      const currentModel = appConfig.profiles?.[profileKey]?.model?.trim();
      const mergedModels =
        currentModel && !models.some((model) => model.id === currentModel)
          ? [{ id: currentModel, name: currentModel }, ...models]
          : models;
      return {
        key: profileKey,
        label: profileLabel(profileKey, presets),
        models: mergedModels,
      };
    });
  }, [appConfig, presets]);

  const activeModel = appConfig?.model || '';
  const thinkingLevel = deriveThinkingLevel({
    thinkingLevel: appConfig?.thinkingLevel,
    enableThinking: appConfig?.enableThinking,
  });
  const reasoningSupported = modelSupportsReasoning(activeModel);

  const applyConfigResult = (config: typeof appConfig) => {
    if (!config) return;
    setAppConfig(config);
    setIsConfigured(Boolean(config.isConfigured));
  };

  const setActiveModel = async (profileKey: ProviderProfileKey, modelId: string) => {
    if (!appConfig || isSaving) return;
    setIsSaving(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.config.setActiveModel({ profileKey, modelId });
        applyConfigResult(result.config);
      }
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const setThinkingLevel = async (level: SharedThinkingLevel) => {
    if (!appConfig || isSaving) return;
    setIsSaving(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.config.save({
          thinkingLevel: level,
          enableThinking: level !== 'off',
        });
        applyConfigResult(result.config);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!appConfig) {
    return (
      <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted">
        {t('chat.noModel')}
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[260px] items-center gap-1.5 px-2.5 py-1 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted hover:text-text-primary hover:border-border transition-colors"
        title={t('chat.modelSwitcher')}
      >
        <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{activeModel || t('chat.noModel')}</span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[340px] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl z-50">
          <div className="p-3 border-b border-border-muted">
            <div className="flex items-center gap-2 text-xs font-medium text-text-primary mb-2">
              <Brain className="w-3.5 h-3.5" />
              {t('api.thinkingLevel')}
            </div>
            <ThinkingLevelSegmentedControl
              value={thinkingLevel}
              onChange={setThinkingLevel}
              disabled={!reasoningSupported || isSaving}
              compact
            />
            {!reasoningSupported && (
              <p className="mt-2 text-xs text-text-muted">{t('api.thinkingLevelUnsupported')}</p>
            )}
          </div>

          <div className="py-2">
            {modelGroups.map((group) => (
              <div key={group.key} className="py-1">
                <div className="px-3 pb-1 text-[11px] font-medium uppercase text-text-muted">
                  {group.label}
                </div>
                {group.models.map((model) => {
                  const selected =
                    appConfig.activeProfileKey === group.key && appConfig.model === model.id;
                  return (
                    <button
                      key={`${group.key}:${model.id}`}
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        void setActiveModel(group.key, model.id);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        selected
                          ? 'bg-accent/10 text-accent font-medium'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      } disabled:opacity-60`}
                    >
                      <span className="block truncate">{model.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
