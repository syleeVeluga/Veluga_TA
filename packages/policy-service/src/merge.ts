import { createHash } from 'node:crypto';
import type {
  Clearance,
  HitlMode,
  InstitutionPolicyMerged,
  OrgPolicyMerged,
  PolicyContextSnapshot,
  PolicyGuardMode,
  PolicyTierRules,
  ProjectPolicyMerged
} from '../../shared-types/src/index.js';

export interface Identity {
  user_id: string;
  dept: string;
  roles: string[];
  clearance: Clearance;
  group_ids?: string[];
}

export interface InstitutionPolicyInput extends PolicyTierRules {
  default_veluga_mode?: boolean;
  policy_guard_mode?: PolicyGuardMode;
  hitl_mode?: HitlMode;
}

export interface OrgPolicyInput extends PolicyTierRules {
  org_id?: string;
  default_skills?: string[];
  kb_scopes?: string[];
  active_mcp_connectors?: string[];
}

export interface ProjectPolicyInput extends PolicyTierRules {
  project_id?: string;
  allowed_scopes?: string[];
  active_skills?: string[];
}

export interface UserPolicyInput extends PolicyTierRules {
  extra_skills?: string[];
  denied_skills?: string[];
  kb_extra_scopes?: string[];
}

export interface SessionPolicyInput extends PolicyTierRules {
  enable_veluga_orchestration?: boolean;
  kb_token_budget?: number;
}

export interface MergePolicyInput {
  identity: Identity;
  institution?: InstitutionPolicyInput;
  org?: OrgPolicyInput;
  project?: ProjectPolicyInput | null;
  user?: UserPolicyInput;
  session?: SessionPolicyInput;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function chooseWithDenyPrecedence(
  tiers: Array<PolicyTierRules | undefined>,
  key: keyof Pick<PolicyTierRules, 'external_apis' | 'audit_log' | 'unverified_quotes' | 'approval_for_destructive'>,
  fallback: string,
  denyValue: string
): string {
  if (tiers.some((tier) => tier?.[key] === denyValue)) {
    return denyValue;
  }
  for (let index = tiers.length - 1; index >= 0; index -= 1) {
    const value = tiers[index]?.[key];
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

function latestNumber(tiers: Array<PolicyTierRules | undefined>, key: 'retention_default_days', fallback: number): number {
  for (let index = tiers.length - 1; index >= 0; index -= 1) {
    const value = tiers[index]?.[key];
    if (typeof value === 'number') {
      return value;
    }
  }
  return fallback;
}

function versionFor(payload: unknown): string {
  return `pol_${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}`;
}

export function mergePolicies(input: MergePolicyInput): PolicyContextSnapshot {
  const institution: InstitutionPolicyMerged = {
    external_apis: input.institution?.external_apis ?? 'deny',
    audit_log: input.institution?.audit_log ?? 'required',
    unverified_quotes: input.institution?.unverified_quotes ?? 'warn',
    approval_for_destructive: input.institution?.approval_for_destructive ?? 'required',
    retention_default_days: input.institution?.retention_default_days ?? 1825,
    default_veluga_mode: input.institution?.default_veluga_mode ?? true,
    policy_guard_mode: input.institution?.policy_guard_mode ?? 'dry-run',
    hitl_mode: input.institution?.hitl_mode ?? 'normal'
  };

  const org: OrgPolicyMerged = {
    external_apis: input.org?.external_apis,
    audit_log: input.org?.audit_log,
    unverified_quotes: input.org?.unverified_quotes,
    approval_for_destructive: input.org?.approval_for_destructive,
    retention_default_days: input.org?.retention_default_days,
    org_id: input.org?.org_id ?? input.identity.dept,
    default_skills: unique(input.org?.default_skills ?? ['system-self-help']),
    kb_scopes: unique(input.org?.kb_scopes ?? []),
    active_mcp_connectors: unique(input.org?.active_mcp_connectors ?? [])
  };

  const project: ProjectPolicyMerged | undefined = input.project
    ? {
        external_apis: input.project.external_apis,
        audit_log: input.project.audit_log,
        unverified_quotes: input.project.unverified_quotes,
        approval_for_destructive: input.project.approval_for_destructive,
        retention_default_days: input.project.retention_default_days,
        project_id: input.project.project_id ?? 'default',
        allowed_scopes: unique(input.project.allowed_scopes ?? []),
        active_skills: unique(input.project.active_skills ?? [])
      }
    : undefined;

  const tiers = [institution, org, project, input.user, input.session];
  const scopedBeforeProject = unique([...(input.org?.kb_scopes ?? []), ...(input.user?.kb_extra_scopes ?? [])]);
  const active_kb_scopes = project?.allowed_scopes.length
    ? scopedBeforeProject.filter((scope) => project.allowed_scopes.includes(scope))
    : scopedBeforeProject;

  const deniedSkills = new Set(input.user?.denied_skills ?? []);
  const active_skill_ids = unique([
    ...(input.org?.default_skills ?? ['system-self-help']),
    ...(input.user?.extra_skills ?? []),
    ...(project?.active_skills ?? [])
  ]).filter((skill) => !deniedSkills.has(skill));

  const snapshot: PolicyContextSnapshot = {
    policy_version_id: versionFor({ ...input, generated_at: undefined }),
    user: {
      user_id: input.identity.user_id,
      dept: input.identity.dept,
      roles: input.identity.roles,
      clearance: input.identity.clearance
    },
    institution,
    org,
    project,
    effective: {
      external_apis: chooseWithDenyPrecedence(tiers, 'external_apis', 'deny', 'deny') as 'allow' | 'deny',
      audit_log: chooseWithDenyPrecedence(tiers, 'audit_log', 'required', 'required') as 'required' | 'optional',
      unverified_quotes: chooseWithDenyPrecedence(tiers, 'unverified_quotes', 'warn', 'deny') as 'allow' | 'warn' | 'deny',
      approval_for_destructive: chooseWithDenyPrecedence(
        tiers,
        'approval_for_destructive',
        'required',
        'required'
      ) as 'required' | 'optional',
      retention_default_days: latestNumber(tiers, 'retention_default_days', 1825)
    },
    active_kb_scopes,
    active_skill_ids,
    active_mcp_connectors: org.active_mcp_connectors,
    veluga: {
      enable_veluga_orchestration:
        input.session?.enable_veluga_orchestration ?? institution.default_veluga_mode,
      policy_guard_mode: institution.policy_guard_mode,
      kb_token_budget: input.session?.kb_token_budget
    },
    hitl_mode: institution.hitl_mode
  };

  return snapshot;
}
