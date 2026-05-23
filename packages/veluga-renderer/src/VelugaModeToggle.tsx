import React from 'react';
import { usePolicyContext } from './PolicyProvider.js';
import { velugaText } from './veluga-i18n.js';

export function VelugaModeToggle({ onChange }: { onChange?: (enabled: boolean) => void }) {
  const policy = usePolicyContext();
  const enabled = policy.veluga.enable_veluga_orchestration;
  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onChange?.(event.currentTarget.checked)}
      />
      <span>{velugaText('mode')}</span>
    </label>
  );
}
