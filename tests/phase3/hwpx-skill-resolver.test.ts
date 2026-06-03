import { describe, expect, it } from 'vitest';
import { PolicyContextStore, type PolicyContext } from '../../packages/shared-types/src/index.js';
import { mergePolicies } from '../../packages/policy-service/src/merge.js';
import { resolveSkillPlan } from '../../packages/veluga-main/src/agents/skill-resolver.js';

// hwpx is registered as an independent, office-tier (order 6) WRITE built-in,
// exactly like docx — and gov-proposal's dependency set must stay unchanged.
function makePolicy(
  activeSkills: string[],
  defaultSkills: string[] = ['system-self-help', 'style-card', 'citation-verifier', 'compliance-checker']
): PolicyContext {
  return new PolicyContextStore(
    mergePolicies({
      identity: { user_id: 'analyst@veluga.io', dept: 'strategy', roles: ['analyst'], clearance: 'internal' },
      institution: {
        external_apis: 'allow',
        audit_log: 'required',
        default_veluga_mode: true,
        policy_guard_mode: 'enforce',
        hitl_mode: 'normal',
        retention_default_days: 1825
      },
      org: {
        org_id: 'strategy',
        default_skills: defaultSkills,
        kb_scopes: ['law:public'],
        active_mcp_connectors: []
      },
      project: { project_id: 'hwpx-test', allowed_scopes: ['law:public'], active_skills: activeSkills },
      user: {},
      session: {}
    })
  ).get();
}

describe('hwpx skill registration (docx-equivalent, independent)', () => {
  it('resolves hwpx independently as a write skill with no dependencies', () => {
    const plan = resolveSkillPlan(['hwpx'], makePolicy(['hwpx']));
    expect(plan.ordered_skills.map((step) => step.id)).toEqual(['hwpx']);
    expect(plan.ordered_skills[0].mode).toBe('write');
    expect(plan.unresolved_skills).toEqual([]);
  });

  it('orders hwpx at the office artifact tier (same level as docx/pptx/xlsx)', () => {
    const plan = resolveSkillPlan(['hwpx', 'style-card'], makePolicy(['hwpx', 'style-card']));
    // style-card (order 1) precedes hwpx (order 6); ties broken alphabetically.
    expect(plan.ordered_skills.map((step) => step.id)).toEqual(['style-card', 'hwpx']);
  });

  it('does NOT couple gov-proposal to hwpx — its dependency set is unchanged', () => {
    const policy = makePolicy(['gov-proposal', 'docx', 'hwpx']);
    const plan = resolveSkillPlan(['gov-proposal'], policy);
    const ids = plan.ordered_skills.map((step) => step.id);
    expect(ids).toEqual(['style-card', 'gov-proposal', 'citation-verifier', 'compliance-checker', 'docx']);
    expect(ids).not.toContain('hwpx');
  });

  it('reports hwpx as unresolved when the policy does not activate it', () => {
    const plan = resolveSkillPlan(['hwpx'], makePolicy(['docx']));
    expect(plan.ordered_skills).toEqual([]);
    expect(plan.unresolved_skills).toContain('hwpx');
  });
});
