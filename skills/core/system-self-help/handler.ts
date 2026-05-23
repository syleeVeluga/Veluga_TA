import type { PolicyContext } from '../../../packages/shared-types/src/index.js';

export interface SkillContext {
  policyContext: PolicyContext;
}

const SKILL_DESCRIPTIONS: Record<string, string> = {
  'system-self-help': '현재 권한 기준으로 사용 가능한 기능을 안내합니다.',
  'docx-format': '문서 형식 변환과 편집을 지원합니다.',
  'style-card': '프로젝트 문서의 문체 기준을 추출합니다.'
};

export function handleSystemSelfHelp(ctx: SkillContext): string {
  const p = ctx.policyContext;
  const skills = p.active_skill_ids
    .map((id) => `- ${id}: ${SKILL_DESCRIPTIONS[id] ?? '관리자가 허용한 Skill입니다.'}`)
    .join('\n');
  const scopes = p.active_kb_scopes.map((scope) => `- ${scope}`).join('\n') || '- 접근 가능한 KB scope가 없습니다.';
  const project = p.project ? `${p.project.project_id}: Phase2부터 사진/요약이 표시됩니다.` : '활성 Project가 없습니다.';

  return [
    '## Veluga로 할 수 있는 것',
    '',
    '### 1. 활성화된 기능 (Skills)',
    skills || '- 활성화된 Skill이 없습니다.',
    '',
    '### 2. 접근 가능한 자료 범위 (KB Scopes)',
    scopes,
    `- clearance: ${p.user.clearance}`,
    '',
    '### 3. 활성 Project',
    `- ${project}`,
    '',
    '### 4. 일반 채팅',
    '- 내부 자료 없는 일반 질문에 답할 수 있습니다. 모든 일반 답변에는 [parametric] 태그가 붙습니다.',
    '- 시점, 기관, 법령 의존 질문은 KB 사용을 권장합니다.',
    '',
    '### 5. 현재 모드',
    `- Veluga Mode: ${p.veluga.enable_veluga_orchestration ? 'ON' : 'OFF'}`,
    `- Policy Guard: ${p.veluga.policy_guard_mode}`,
    '',
    '권한 변경은 IT 관리자에게 문의하세요.'
  ].join('\n');
}
