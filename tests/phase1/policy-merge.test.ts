import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PolicyContextStore } from '../../packages/shared-types/src/index.js';
import { mergePolicies } from '../../packages/policy-service/src/merge.js';
import { MockPolicyService } from '../../packages/policy-service/src/mock-server.js';
import { InMemoryTokenVault, InternalSsoProvider } from '../../packages/policy-service/src/sso/internal.js';

describe('Phase1 policy merge and SSO', () => {
  it('merges five tiers with deny precedence, project scope intersection, helper methods, and subscriptions', () => {
    const snapshot = mergePolicies({
      identity: { user_id: 'p2', dept: 'finance', roles: ['new-hire'], clearance: 'internal' },
      institution: {
        external_apis: 'deny',
        audit_log: 'required',
        unverified_quotes: 'warn',
        approval_for_destructive: 'required',
        retention_default_days: 365,
        default_veluga_mode: true,
        policy_guard_mode: 'dry-run',
        hitl_mode: 'strict'
      },
      org: {
        org_id: 'finance',
        external_apis: 'allow',
        default_skills: ['system-self-help', 'style-card'],
        kb_scopes: ['law:public', 'tax:public'],
        active_mcp_connectors: ['mcp-a']
      },
      project: {
        project_id: 'demo',
        allowed_scopes: ['tax:public'],
        active_skills: ['docx-format']
      },
      user: {
        extra_skills: ['custom-skill'],
        denied_skills: ['style-card'],
        kb_extra_scopes: ['audit:confidential'],
        retention_default_days: 30,
        external_apis: 'allow'
      },
      session: { enable_veluga_orchestration: false, kb_token_budget: 1200 }
    });

    expect(snapshot.user.user_id).toBe('p2');
    expect(snapshot.institution.policy_guard_mode).toBe('dry-run');
    expect(snapshot.org.org_id).toBe('finance');
    expect(snapshot.project?.project_id).toBe('demo');
    expect(snapshot.effective.external_apis).toBe('deny');
    expect(snapshot.effective.audit_log).toBe('required');
    expect(snapshot.effective.unverified_quotes).toBe('warn');
    expect(snapshot.effective.approval_for_destructive).toBe('required');
    expect(snapshot.effective.retention_default_days).toBe(30);
    expect(snapshot.active_kb_scopes).toEqual(['tax:public']);
    expect(snapshot.active_skill_ids).toEqual(['custom-skill', 'docx-format', 'system-self-help']);
    expect(snapshot.active_mcp_connectors).toEqual(['mcp-a']);
    expect(snapshot.veluga.enable_veluga_orchestration).toBe(false);
    expect(snapshot.veluga.kb_token_budget).toBe(1200);
    expect(snapshot.hitl_mode).toBe('strict');
    expect(snapshot.policy_version_id).toMatch(/^pol_/);

    const store = new PolicyContextStore(snapshot);
    const policy = store.get();
    let observed = '';
    const unsubscribe = policy.subscribe((next) => {
      observed = next.policy_version_id;
    });
    expect(policy.hasSkill('style-card')).toBe(false);
    expect(policy.hasSkill('docx-format')).toBe(true);
    expect(policy.hasKbScope('tax:public')).toBe(true);
    expect(policy.hasKbScope('law:public')).toBe(false);
    store.update({ ...snapshot, policy_version_id: 'pol_next' });
    unsubscribe();
    expect(observed).toBe('pol_next');
  });

  it('covers null project, lower-tier fill, and mock outage stale fallback', async () => {
    const snapshot = mergePolicies({
      identity: { user_id: 'p4', dept: 'it', roles: ['admin'], clearance: 'secret' },
      institution: { default_veluga_mode: true, policy_guard_mode: 'dry-run' },
      org: { kb_scopes: ['policy:internal'], default_skills: ['system-self-help'] },
      project: null,
      user: {},
      session: {}
    });
    expect(snapshot.project).toBeUndefined();
    expect(snapshot.active_kb_scopes).toEqual(['policy:internal']);
    expect(snapshot.effective.retention_default_days).toBe(1825);

    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-policy-'));
    await writeFile(path.join(dir, 'institution.yaml'), '{"default_veluga_mode":true,"policy_guard_mode":"dry-run"}');
    await writeFile(path.join(dir, 'org.yaml'), '{"default_skills":["system-self-help"],"kb_scopes":["law:public"]}');
    await writeFile(path.join(dir, 'user.yaml'), '{}');
    await writeFile(path.join(dir, 'project.yaml'), '{"allowed_scopes":["law:public"]}');
    const identity = { user_id: 'u', dept: 'd', roles: [], clearance: 'internal' as const };
    const service = new MockPolicyService({ policyDir: dir, identity });
    const first = await service.fetchAll();
    expect(first.stale).toBeUndefined();
    const outage = new MockPolicyService({ policyDir: dir, identity, simulateOutage: true });
    await expect(outage.fetchAll()).rejects.toThrow(/no cached/);
  });

  it('issues mock SSO tokens and keeps the token vault in memory', async () => {
    const provider = new InternalSsoProvider('secret');
    const token = await provider.login({ user_id: 'u1', dept: 'd', roles: ['r'], clearance: 'internal' });
    const vault = new InMemoryTokenVault();
    vault.save(token);
    expect(vault.load()?.token).toContain('.');
    await expect(provider.resolve(token.token)).resolves.toMatchObject({ user_id: 'u1' });
    await expect(provider.resolve(`${token.token}x`)).rejects.toThrow(/signature/);
  });
});
