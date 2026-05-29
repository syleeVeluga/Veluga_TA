import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';

interface TosAcknowledgeDialogProps {
  onAgree: () => void;
  onCancel: () => void;
}

/**
 * ChatGPT Plus OAuth ToS notice (Phase 5 §1.5). Shown once before the first
 * OAuth login; agreement is persisted as `config.chatgptPlusTosAckAt`.
 */
export function TosAcknowledgeDialog({ onAgree, onCancel }: TosAcknowledgeDialogProps) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="card w-full max-w-lg p-6 m-4 shadow-elevated animate-slide-up">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-accent/10">
            <Info className="w-6 h-6 text-accent" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary">{t('api.tosTitle')}</h2>
            <p className="text-sm text-text-secondary mt-1">{t('api.tosIntro')}</p>
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-sm text-text-secondary list-disc pl-5">
          <li>{t('api.tosBullet1')}</li>
          <li>{t('api.tosBullet2')}</li>
          <li>{t('api.tosBullet3')}</li>
        </ul>

        <label className="mt-5 flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="accent-accent"
          />
          {t('api.tosAgreeCheckbox')}
        </label>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={onCancel} className="flex-1 btn btn-secondary">
            <X className="w-4 h-4" />
            {t('api.tosCancel')}
          </button>
          <button onClick={onAgree} disabled={!checked} className="flex-1 btn btn-primary">
            {t('api.tosContinue')}
          </button>
        </div>
      </div>
    </div>
  );
}
