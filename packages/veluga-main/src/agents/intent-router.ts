import type { IntentPlan, PolicyContext } from '../../../shared-types/src/index.js';
import type { LlmGateway } from '../llm-gateway.js';
import type { KbConnectorRegistry } from '../kb/kb-connector-registry.js';

export interface IntentRouterMetrics {
  llm_invocations_count: number;
}

const FAST_PATH_RULES: Array<{ pattern: RegExp; hit: NonNullable<IntentPlan['fast_path_hit']> }> = [
  { pattern: /^\s*(hi|hello|hey)[\s!?.~]*$/i, hit: 'greeting' },
  { pattern: /^\s*(thanks?|thank you)[\s!?.~]*$/i, hit: 'thanks' },
  { pattern: /^\s*(ok|got it)[\s!?.~]*$/i, hit: 'ack' },
  { pattern: /^\s*\/help/i, hit: 'self_help' },
  { pattern: /^\s*\/skill\s+(\S+)/i, hit: 'explicit_skill' }
];

function basePlan(hit?: IntentPlan['fast_path_hit']): IntentPlan {
  return {
    intent_class: hit === 'greeting' || hit === 'thanks' || hit === 'ack' ? 'conversational' : 'general_qa',
    answer_mode: 'general',
    use_kb: false,
    kb_scopes: [],
    suggested_skills: [],
    needs_clarification: false,
    clarification_questions: [],
    fast_path_hit: hit
  };
}

export function tryFastPath(message: string, policy: PolicyContext): IntentPlan | null {
  const compact = message.trim();
  if (compact === '안녕') return basePlan('greeting');
  if (compact === '고마워요') return basePlan('thanks');
  if (compact === '확인') return basePlan('ack');
  if (compact === '?덈뀞') return basePlan('greeting');
  if (compact === '怨좊쭏?뚯슂') return basePlan('thanks');
  if (compact === '?뺤씤') return basePlan('ack');

  for (const rule of FAST_PATH_RULES) {
    const match = message.match(rule.pattern);
    if (!match) continue;
    const plan = basePlan(rule.hit);
    if (rule.hit === 'self_help') {
      plan.suggested_skills = policy.hasSkill('system-self-help') ? ['system-self-help'] : [];
    }
    if (rule.hit === 'explicit_skill') {
      const skill = match[1];
      plan.suggested_skills = policy.hasSkill(skill) ? [skill] : [];
      plan.needs_clarification = plan.suggested_skills.length === 0;
      plan.clarification_questions = plan.needs_clarification ? [`${skill} is not enabled for this policy.`] : [];
    }
    return plan;
  }
  return null;
}

export class IntentRouter {
  readonly metrics: IntentRouterMetrics = { llm_invocations_count: 0 };

  constructor(
    private readonly gateway?: LlmGateway,
    /**
     * When supplied, overrides the useKbToggle argument: if no plugin is enabled,
     * KB intent is suppressed regardless of what the caller passes in.
     */
    private readonly kbRegistry?: KbConnectorRegistry
  ) {}

  async classify(message: string, policy: PolicyContext, useKbToggle = true): Promise<IntentPlan> {
    const fast = tryFastPath(message, policy);
    if (fast) return fast;

    const effectiveKbToggle = useKbToggle && (this.kbRegistry ? this.kbRegistry.isEnabled() : true);

    if (this.gateway) {
      this.metrics.llm_invocations_count += 1;
      const result = await this.gateway.chat({
        model: process.env.VELUGA_LLM_DEFAULT_MODEL ?? 'veluga-default',
        messages: [{ role: 'user', content: message }]
      });
      try {
        return sanitizePlan(JSON.parse(result.text) as IntentPlan, policy, effectiveKbToggle);
      } catch {
        return heuristicPlan(message, policy, effectiveKbToggle);
      }
    }

    return heuristicPlan(message, policy, effectiveKbToggle);
  }
}

export function heuristicPlan(message: string, policy: PolicyContext, useKbToggle = true): IntentPlan {
  const text = message.toLowerCase();
  const wantsKb =
    /(kb|knowledge|policy|regulation|law|citation|source|evidence)/i.test(message) ||
    includesAny(message, [
      '근거',
      '인용',
      '법령',
      '규정',
      '정책',
      '세액공제',
      '최신',
      '올해',
      '사내',
      '우리 회사',
      '洹쇨굅',
      '?몄슜',
      '踰뺣졊',
      '洹쒖젙',
      '?뺤콉',
      '?몄븸怨듭젣',
      '理쒖떊',
      '?ы빐',
      '?щ궡',
      '?곕━ ?뚯궗'
    ]);
  const wantsProject =
    /(project|attached|attachment|file|document|summarize|summary|report|notebook)/i.test(message) ||
    includesAny(message, [
      '프로젝트',
      '첨부',
      '문서',
      '파일',
      '요약',
      '보고서 초안',
      '?꾨줈?앺듃',
      '泥⑤?',
      '臾몄꽌',
      '?뚯씪',
      '?붿빟',
      '蹂닿퀬??珥덉븞'
    ]);
  const wantsDraft =
    /(draft|write|compose|proposal|brief|report|create)/i.test(message) || includesAny(message, ['초안', '작성', '珥덉븞', '?묒꽦']);
  const wantsSkill =
    /(how to|format|convert|docx|plan|method|organize|check)/i.test(message) ||
    includesAny(message, ['방법', '사용법', '작성', '정리', '계획', '변환', '검토', '?꾩?', '諛⑸쾿', '?ъ슜踰??묒꽦', '?뺣━', '怨꾪쉷', '?꾪솚', '蹂??寃??']);
  const suggested_skills = policy.active_skill_ids.filter((skill) => {
    if (skill === 'system-self-help') return /help/.test(text);
    if (skill.includes('docx')) return /docx|word|document|report/.test(text);
    if (skill === 'style-card') return wantsProject && wantsDraft;
    if (skill === 'citation-verifier') return wantsProject && (wantsDraft || wantsKb);
    if (skill === 'gov-proposal') return wantsDraft && wantsKb && /(proposal|r&d|grant|government|policy|공모|제안|사업)/i.test(message);
    if (skill === 'compliance-checker') return wantsKb || /compliance|check|검수|준수|보존|등급/i.test(message);
    return wantsSkill || (wantsProject && wantsDraft);
  });

  const answer_mode = wantsKb && wantsProject ? 'mixed' : wantsKb ? 'kb_grounded' : wantsProject ? 'project_only' : 'general';
  return sanitizePlan(
    {
      intent_class: wantsKb && wantsProject
        ? 'compare_project_vs_kb'
        : wantsKb && wantsDraft
          ? 'compare_project_vs_kb'
          : wantsKb
            ? 'general_qa'
        : wantsProject && wantsDraft
          ? 'draft_with_grounding'
          : wantsProject
            ? 'summarize_project'
            : wantsSkill
              ? 'how_to_assist'
              : 'general_qa',
      answer_mode,
      use_kb: useKbToggle && wantsKb,
      kb_scopes: useKbToggle && wantsKb ? policy.active_kb_scopes : [],
      suggested_skills,
      needs_clarification: false,
      clarification_questions: []
    },
    policy,
    useKbToggle
  );
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function sanitizePlan(plan: IntentPlan, policy: PolicyContext, useKbToggle: boolean): IntentPlan {
  return {
    ...plan,
    use_kb: useKbToggle && plan.use_kb,
    kb_scopes: useKbToggle ? plan.kb_scopes.filter((scope) => policy.hasKbScope(scope)) : [],
    suggested_skills: plan.suggested_skills.filter((skill) => policy.hasSkill(skill))
  };
}
