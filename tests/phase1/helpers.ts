import { PolicyContextStore, type PolicyContext } from '../../packages/shared-types/src/index.js';
import { mergePolicies, type MergePolicyInput } from '../../packages/policy-service/src/merge.js';

export function makePolicy(input: Partial<MergePolicyInput> = {}): PolicyContext {
  const snapshot = mergePolicies({
    identity: {
      user_id: 'u1',
      dept: 'finance',
      roles: ['analyst'],
      clearance: 'internal'
    },
    institution: {
      external_apis: 'deny',
      audit_log: 'required',
      default_veluga_mode: true,
      policy_guard_mode: 'dry-run',
      hitl_mode: 'normal'
    },
    org: {
      org_id: 'finance',
      default_skills: ['system-self-help', 'style-card'],
      kb_scopes: ['law:public', 'tax:public', 'policy:internal']
    },
    project: {
      project_id: 'demo',
      allowed_scopes: ['law:public', 'tax:public'],
      active_skills: ['docx-format']
    },
    user: {
      extra_skills: ['system-self-help'],
      denied_skills: ['style-card'],
      kb_extra_scopes: ['audit:confidential'],
      external_apis: 'allow'
    },
    session: {},
    ...input
  });
  return new PolicyContextStore(snapshot).get();
}
