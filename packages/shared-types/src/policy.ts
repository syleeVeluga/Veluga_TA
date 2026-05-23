export type Clearance = 'public' | 'internal' | 'confidential' | 'secret';
export type HitlMode = 'strict' | 'normal' | 'relaxed';
export type PolicyGuardMode = 'enforce' | 'dry-run';

export interface PolicyTierRules {
  external_apis?: 'allow' | 'deny';
  audit_log?: 'required' | 'optional';
  unverified_quotes?: 'allow' | 'warn' | 'deny';
  approval_for_destructive?: 'required' | 'optional';
  retention_default_days?: number;
}

export interface InstitutionPolicyMerged extends PolicyTierRules {
  default_veluga_mode: boolean;
  policy_guard_mode: PolicyGuardMode;
  hitl_mode: HitlMode;
}

export interface OrgPolicyMerged extends PolicyTierRules {
  org_id: string;
  default_skills: string[];
  kb_scopes: string[];
  active_mcp_connectors: string[];
}

export interface ProjectPolicyMerged extends PolicyTierRules {
  project_id: string;
  allowed_scopes: string[];
  active_skills: string[];
}

export interface PolicyContext {
  policy_version_id: string;
  user: {
    user_id: string;
    dept: string;
    roles: string[];
    clearance: Clearance;
  };
  institution: InstitutionPolicyMerged;
  org: OrgPolicyMerged;
  project?: ProjectPolicyMerged;
  effective: {
    external_apis: 'allow' | 'deny';
    audit_log: 'required' | 'optional';
    unverified_quotes: 'allow' | 'warn' | 'deny';
    approval_for_destructive: 'required' | 'optional';
    retention_default_days: number;
  };
  active_kb_scopes: string[];
  active_skill_ids: string[];
  active_mcp_connectors: string[];
  veluga: {
    enable_veluga_orchestration: boolean;
    policy_guard_mode: PolicyGuardMode;
    kb_token_budget?: number;
  };
  hitl_mode: HitlMode;
  stale?: boolean;
  hasSkill(id: string): boolean;
  hasKbScope(scope: string): boolean;
  subscribe(listener: (next: PolicyContext) => void): () => void;
}

export interface PolicyContextSnapshot extends Omit<PolicyContext, 'hasSkill' | 'hasKbScope' | 'subscribe'> {}

export class PolicyContextStore {
  private listeners = new Set<(next: PolicyContext) => void>();
  private current: PolicyContext;

  constructor(initial: PolicyContextSnapshot) {
    this.current = this.wrap(initial);
  }

  get(): PolicyContext {
    return this.current;
  }

  update(next: PolicyContextSnapshot): PolicyContext {
    this.current = this.wrap(next);
    for (const listener of this.listeners) {
      listener(this.current);
    }
    return this.current;
  }

  private wrap(snapshot: PolicyContextSnapshot): PolicyContext {
    return {
      ...snapshot,
      hasSkill: (id: string) => snapshot.active_skill_ids.includes(id),
      hasKbScope: (scope: string) => snapshot.active_kb_scopes.includes(scope),
      subscribe: (listener: (next: PolicyContext) => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
    };
  }
}
