import type { GeneralPlan } from '../../../shared-types/src/index.js';

const TEMPORAL = /(최근|현재|올해|이번|지난|today|now|recent|latest)/i;
const ORG_SPECIFIC = /(우리 회사|우리 부서|사내|기관 내부|내부 규정)/i;
const LEGAL_STATS = /(법령|시행규칙|통계|세액공제|tax credit|규정|고시)/i;
const REFUSE = /(법률 자문|소송 전략|의료 진단|주민번호 수집|계좌번호 수집|개인정보 수집)/i;

export function planGeneralAnswer(message: string): GeneralPlan {
  if (REFUSE.test(message)) {
    return {
      confidence: 'refuse',
      category: 'out_of_scope',
      steps: ['요청 범위가 일반 답변으로 처리하기 어렵습니다.'],
      escalate_to_kb: null,
      knowledge_boundaries: ['전문 자문 또는 개인정보 처리는 Phase1 일반 응답 범위를 벗어납니다.']
    };
  }

  const low = TEMPORAL.test(message) || ORG_SPECIFIC.test(message) || LEGAL_STATS.test(message);
  return {
    confidence: low ? 'low' : 'high',
    category: /방법|어떻게|정리|작성|계획/.test(message) ? 'how_to' : 'common_knowledge',
    steps: low
      ? ['일반 원칙만 답변합니다.', '시점 또는 기관별 근거가 필요한 부분은 KB 확인을 권장합니다.']
      : ['핵심 원칙을 정리합니다.', '실무에 바로 적용 가능한 체크 포인트로 나눕니다.'],
    escalate_to_kb: low
      ? {
          reason: '시점, 기관, 법령 또는 통계 의존 정보는 검증 가능한 근거가 필요합니다.',
          suggested_scopes: LEGAL_STATS.test(message) ? ['law:public', 'tax:public'] : ['policy:internal']
        }
      : null,
    knowledge_boundaries: ['Phase1 일반 답변은 내부 자료와 KB를 열람하지 않습니다.']
  };
}
