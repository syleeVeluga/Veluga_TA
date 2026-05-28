/**
 * SlackConfigStep - Slack bot credentials and DM policy configuration.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { DmPolicy } from './types';

interface Props {
  botToken: string;
  appToken: string;
  signingSecret: string;
  useSocketMode: boolean;
  dmPolicy: DmPolicy;
  onBotTokenChange: (value: string) => void;
  onAppTokenChange: (value: string) => void;
  onSigningSecretChange: (value: string) => void;
  onSocketModeChange: (value: boolean) => void;
  onDmPolicyChange: (value: DmPolicy) => void;
}

export function SlackConfigStep({
  botToken,
  appToken,
  signingSecret,
  useSocketMode,
  dmPolicy,
  onBotTokenChange,
  onAppTokenChange,
  onSigningSecretChange,
  onSocketModeChange,
  onDmPolicyChange,
}: Props) {
  const { t } = useTranslation();

  const dmPolicies: Array<{ value: DmPolicy; label: string; desc: string }> = [
    { value: 'pairing', label: t('remote.policyPairing'), desc: t('remote.policyPairingDesc') },
    {
      value: 'allowlist',
      label: t('remote.policyAllowlist'),
      desc: t('remote.policyAllowlistDesc'),
    },
    { value: 'open', label: t('remote.policyOpen'), desc: t('remote.policyOpenDesc') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">{t('remote.slackTitle')}</h3>
        <p className="text-sm text-text-secondary">{t('remote.slackDesc')}</p>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.slackBotToken')}
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(event) => onBotTokenChange(event.target.value)}
            className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
            placeholder="xoxb-..."
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onSocketModeChange(!useSocketMode)}
            className={`relative w-10 h-6 rounded-full transition-colors ${useSocketMode ? 'bg-accent' : 'bg-border'}`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${useSocketMode ? 'translate-x-5' : 'translate-x-1'}`}
            />
          </button>
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t('remote.slackSocketMode')}
            </div>
            <div className="text-xs text-text-muted">{t('remote.slackSocketModeDesc')}</div>
          </div>
        </div>

        {useSocketMode && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('remote.slackAppToken')}
            </label>
            <input
              type="password"
              value={appToken}
              onChange={(event) => onAppTokenChange(event.target.value)}
              className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
              placeholder="xapp-..."
            />
          </div>
        )}

        {!useSocketMode && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              {t('remote.slackSigningSecret')}
            </label>
            <input
              type="password"
              value={signingSecret}
              onChange={(event) => onSigningSecretChange(event.target.value)}
              className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
              placeholder="Signing secret"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.dmPolicy')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {dmPolicies.map((option) => (
              <button
                key={option.value}
                onClick={() => onDmPolicyChange(option.value)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  dmPolicy === option.value
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="font-medium text-text-primary text-sm">{option.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <a
        href="https://api.slack.com/apps"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
      >
        <ExternalLink className="w-4 h-4" />
        {t('remote.openSlack')}
      </a>
    </div>
  );
}
