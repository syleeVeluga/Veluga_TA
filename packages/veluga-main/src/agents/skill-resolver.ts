import type { PolicyContext, SkillActivationPlan, SkillStep } from '../../../shared-types/src/index.js';

export const SKILL_DEPENDENCIES: Record<string, string[]> = {
  'gov-proposal': ['style-card', 'citation-verifier', 'docx', 'compliance-checker'],
  'policy-research': ['style-card', 'citation-verifier', 'docx'],
  'legal-opinion': ['style-card', 'citation-verifier', 'compliance-checker'],
  'budget-review': ['style-card', 'xlsx'],
  docx: [],
  pptx: [],
  xlsx: [],
  'style-card': [],
  'citation-verifier': [],
  'compliance-checker': []
};

export const SKILL_ORDER: Record<string, number> = {
  'style-card': 1,
  'gov-proposal': 3,
  'policy-research': 3,
  'legal-opinion': 3,
  'budget-review': 3,
  'citation-verifier': 4,
  'compliance-checker': 5,
  docx: 6,
  pptx: 6,
  xlsx: 6
};

const WRITE_SKILLS = new Set(['gov-proposal', 'policy-research', 'legal-opinion', 'budget-review', 'docx', 'pptx', 'xlsx']);

export function resolveSkillPlan(suggested: string[], policy: PolicyContext): SkillActivationPlan {
  const allowed = new Set(policy.active_skill_ids);
  const unresolved = new Set<string>();
  const selected = new Set<string>();

  for (const skill of suggested) {
    if (!allowed.has(skill)) {
      unresolved.add(skill);
      continue;
    }
    expandSkill(skill, allowed, selected, unresolved);
  }

  const ordered = [...selected]
    .sort((a, b) => (SKILL_ORDER[a] ?? 50) - (SKILL_ORDER[b] ?? 50) || a.localeCompare(b))
    .map(toSkillStep);

  return {
    ordered_skills: ordered,
    data_passing: policy.project ? 'project_temp' : 'memory',
    rationale: 'catalog_dependencies_and_policy_active_skills',
    unresolved_skills: [...unresolved].sort()
  };
}

function expandSkill(skill: string, allowed: Set<string>, selected: Set<string>, unresolved: Set<string>): void {
  for (const dependency of SKILL_DEPENDENCIES[skill] ?? []) {
    if (allowed.has(dependency)) {
      expandSkill(dependency, allowed, selected, unresolved);
    } else {
      unresolved.add(dependency);
    }
  }
  selected.add(skill);
}

function toSkillStep(id: string): SkillStep {
  return { id, mode: WRITE_SKILLS.has(id) ? 'write' : 'read' };
}
