import React from 'react';
import type { ProjectMeta } from '../../shared-types/src/index.js';
import { velugaText } from './veluga-i18n.js';

export function ProjectReentryBanner({
  project,
  onResume
}: {
  project: ProjectMeta | null;
  onResume: () => void;
}) {
  if (!project?.last_session_summary) return null;
  return (
    <section
      aria-label={velugaText('projectReentry')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid rgba(28, 92, 145, 0.28)',
        background: 'rgba(28, 92, 145, 0.08)',
        padding: '8px 12px',
        borderRadius: 6
      }}
    >
      <span style={{ color: '#1c5c91', fontSize: 13, lineHeight: 1.4 }}>{project.last_session_summary}</span>
      <button type="button" onClick={onResume} aria-label={velugaText('resumeProjectSession')}>
        {velugaText('continue')}
      </button>
    </section>
  );
}
