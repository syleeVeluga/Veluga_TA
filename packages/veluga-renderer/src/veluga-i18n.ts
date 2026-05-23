type VelugaTextKey =
  | 'externalDataBanner'
  | 'projectReentry'
  | 'resumeProjectSession'
  | 'continue'
  | 'mode';

const text: Record<'ko' | 'en', Record<VelugaTextKey, string>> = {
  ko: {
    externalDataBanner: '내부 자료를 사용하지 않은 일반 답변입니다.',
    projectReentry: '프로젝트 재진입',
    resumeProjectSession: '프로젝트 세션 이어가기',
    continue: '계속',
    mode: 'Veluga Mode',
  },
  en: {
    externalDataBanner: 'This is a general response without internal data.',
    projectReentry: 'Project reentry',
    resumeProjectSession: 'Resume project session',
    continue: 'Continue',
    mode: 'Veluga Mode',
  },
};

export function velugaText(key: VelugaTextKey): string {
  const language =
    typeof window !== 'undefined' ? window.localStorage?.getItem('i18nextLng') || 'ko' : 'ko';
  return text[language.startsWith('en') ? 'en' : 'ko'][key];
}
