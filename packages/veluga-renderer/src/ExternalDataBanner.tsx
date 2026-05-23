import React from 'react';

export function ExternalDataBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div role="status" className="border border-border bg-surface-muted px-3 py-2 text-sm text-text-secondary">
      내부 자료 미사용 일반 답변입니다.
    </div>
  );
}
