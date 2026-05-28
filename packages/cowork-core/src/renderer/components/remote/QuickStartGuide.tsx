/**
 * QuickStartGuide - setup guide for Discord bot integration.
 */

import { useTranslation } from 'react-i18next';

export function QuickStartGuide() {
  const { t } = useTranslation();

  const steps = [
    t('remote.quickStartStep1'),
    t('remote.quickStartStep2'),
    t('remote.quickStartStep3'),
    t('remote.quickStartStep4'),
    t('remote.quickStartStep5'),
  ];

  return (
    <div className="p-5 rounded-[2rem] border border-border-subtle bg-background/55">
      <h4 className="font-medium text-text-primary mb-3">{t('remote.quickStart')}</h4>
      <ol className="space-y-2 text-sm text-text-secondary">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
