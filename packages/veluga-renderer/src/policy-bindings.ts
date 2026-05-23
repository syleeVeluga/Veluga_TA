import type { PolicyContext } from '../../shared-types/src/index.js';

export function visibleSkills(policy: PolicyContext, catalog: string[]): string[] {
  return catalog.filter((skill) => policy.hasSkill(skill));
}

export function selectableKbScopes(policy: PolicyContext, catalog: string[]): string[] {
  return catalog.filter((scope) => policy.hasKbScope(scope));
}

export function shouldShowExternalDataBanner(options: {
  useKb: boolean;
  intentClass: string;
  answerMode: string;
}): boolean {
  return !options.useKb && options.intentClass !== 'conversational' && options.answerMode === 'general';
}
