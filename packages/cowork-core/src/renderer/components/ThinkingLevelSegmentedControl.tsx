import { useTranslation } from 'react-i18next';
import { THINKING_LEVELS, type SharedThinkingLevel } from '../../shared/thinking';

interface ThinkingLevelSegmentedControlProps {
  value: SharedThinkingLevel;
  onChange: (value: SharedThinkingLevel) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ThinkingLevelSegmentedControl({
  value,
  onChange,
  disabled = false,
  compact = false,
}: ThinkingLevelSegmentedControlProps) {
  const { t } = useTranslation();
  const displayedValue = disabled ? 'off' : value;

  return (
    <div
      role="radiogroup"
      aria-label={t('api.thinkingLevel')}
      className={`grid grid-cols-3 sm:grid-cols-6 gap-1 ${disabled ? 'opacity-55' : ''}`}
    >
      {THINKING_LEVELS.map((level) => {
        const selected = displayedValue === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(level)}
            className={`min-w-0 rounded-md border text-xs transition-colors ${
              compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
            } ${
              selected
                ? 'border-accent bg-accent/10 text-accent font-medium'
                : 'border-border-muted text-text-secondary hover:border-border hover:text-text-primary'
            } disabled:cursor-not-allowed`}
          >
            {t(`api.thinkingLevelValues.${level}`)}
          </button>
        );
      })}
    </div>
  );
}
