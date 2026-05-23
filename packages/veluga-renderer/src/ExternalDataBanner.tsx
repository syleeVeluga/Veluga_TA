import React from 'react';
import { velugaText } from './veluga-i18n.js';

export function ExternalDataBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div role="status" className="border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
      {velugaText('externalDataBanner')}
    </div>
  );
}
