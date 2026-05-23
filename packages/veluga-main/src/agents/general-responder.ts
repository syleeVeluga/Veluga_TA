import type { CitationTag, GeneralPlan, GeneralResponse } from '../../../shared-types/src/index.js';

export function respondGeneral(plan: GeneralPlan, body: string): GeneralResponse {
  const level = plan.confidence === 'high' ? 'high' : 'low';
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `${paragraph} [parametric:${level}]`);

  if (plan.escalate_to_kb) {
    paragraphs.push(
      `이 답변은 내부 자료를 보지 않은 일반 답변입니다. KB 사용을 활성화하면 기관 자료와 근거를 확인해 더 정확히 답할 수 있습니다. [parametric:low]`
    );
  }

  const tags: CitationTag[] = [{ kind: 'parametric', level }];
  return {
    text: paragraphs.join('\n\n'),
    citation_tags: tags,
    escalation_offered: Boolean(plan.escalate_to_kb)
  };
}
