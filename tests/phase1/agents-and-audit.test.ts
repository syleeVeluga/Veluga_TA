import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditLogger } from '../../packages/veluga-main/src/audit-logger.js';
import { IntentRouter } from '../../packages/veluga-main/src/agents/intent-router.js';
import { planGeneralAnswer } from '../../packages/veluga-main/src/agents/general-planner.js';
import { respondGeneral } from '../../packages/veluga-main/src/agents/general-responder.js';
import { PolicyGuard } from '../../packages/veluga-main/src/agents/policy-guard.js';
import { interceptTools } from '../../packages/veluga-main/src/tool-interceptor.js';
import { handleUserMessage } from '../../packages/veluga-main/src/ipc-middleware.js';
import { handleSystemSelfHelp } from '../../skills/core/system-self-help/handler.js';
import { makePolicy } from './helpers.js';

describe('Phase1 agents, audit, guard, and skills', () => {
  it('routes fast-path utterances without LLM invocations', async () => {
    const policy = makePolicy();
    const router = new IntentRouter();
    await expect(router.classify('안녕', policy)).resolves.toMatchObject({ fast_path_hit: 'greeting' });
    await expect(router.classify('고마워요', policy)).resolves.toMatchObject({ fast_path_hit: 'thanks' });
    await expect(router.classify('확인', policy)).resolves.toMatchObject({ fast_path_hit: 'ack' });
    await expect(router.classify('/help', policy)).resolves.toMatchObject({
      fast_path_hit: 'self_help',
      suggested_skills: ['system-self-help']
    });
    expect(router.metrics.llm_invocations_count).toBe(0);
  });

  it('classifies a 100 item golden-like sample above the PRD threshold', async () => {
    const policy = makePolicy();
    const router = new IntentRouter();
    const samples = Array.from({ length: 100 }, (_, index) => {
      if (index < 25) return { text: `일반적인 보고서 정리 방법 ${index}`, mode: 'general' };
      if (index < 50) return { text: `프로젝트 첨부 문서 요약 ${index}`, mode: 'project_only' };
      if (index < 75) return { text: `올해 세액공제 법령 근거 ${index}`, mode: 'kb_grounded' };
      return { text: `프로젝트 문서와 KB 정책 비교 ${index}`, mode: 'mixed' };
    });
    let correct = 0;
    for (const sample of samples) {
      const plan = await router.classify(sample.text, policy);
      if (plan.answer_mode === sample.mode) correct += 1;
    }
    expect(correct / samples.length).toBeGreaterThanOrEqual(0.85);
  });

  it('applies planner confidence rules and responder parametric tags', () => {
    const high = planGeneralAnswer('보고서를 깔끔하게 정리하는 일반적인 원칙은?');
    const low = planGeneralAnswer('올해 R&D 세액공제 제도는?');
    const refused = planGeneralAnswer('이 소송에서 이길 법률 자문을 해줘');
    expect(high.confidence).toBe('high');
    expect(low.confidence).toBe('low');
    expect(low.escalate_to_kb?.suggested_scopes).toContain('tax:public');
    expect(refused.confidence).toBe('refuse');

    const response = respondGeneral(low, '핵심은 요건과 증빙을 분리하는 것입니다.');
    expect(response.text).toContain('[parametric:low]');
    expect(response.escalation_offered).toBe(true);
    expect(response.citation_tags).toEqual([{ kind: 'parametric', level: 'low' }]);
  });

  it('writes append-only audit logs, masks PII, and dry-run guard does not block', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-audit-'));
    const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
    await audit.init();
    const policy = makePolicy();
    const guard = new PolicyGuard(audit);
    guard.register({ name: 'shell.write', privilege: 'WRITE_LOCAL' });
    const decision = guard.onBeforeCall('unknown.tool', { phone: '010-1234-5678' }, { session: { id: 's1' }, policy });
    expect(decision).toEqual({ kind: 'allow' });
    expect(audit.all()[0].event_type).toBe('tool.unregistered');
    expect(audit.all()[0].payload_json).toContain('[PHONE-MASKED]');

    audit.append({
      session_id: 's1',
      user_id: 'u1',
      event_type: 'policy.violation_detected',
      payload: { rrn: '900101-1234567', bank: '123-45-678901' },
      policy_version_id: policy.policy_version_id
    });
    const rows = audit.all();
    expect(rows).toHaveLength(2);
    expect(rows[1].hash_prev).toBe(rows[0].hash_self);
    expect(rows[1].payload_json).toContain('[RRN-MASKED]');
    expect(rows[1].payload_json).toContain('[BANK-MASKED]');
    expect(() => audit.unsafeExec("UPDATE audit_log SET event_type = 'x' WHERE id = 1")).toThrow(/append-only/);
    expect(() => audit.unsafeExec('DELETE FROM audit_log WHERE id = 1')).toThrow(/append-only/);
  });

  it('intercepts 100 percent of wrapped tool calls and records audit events', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-tool-'));
    const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
    await audit.init();
    const policy = makePolicy();
    const guard = new PolicyGuard(audit);
    guard.register({ name: 'echo', privilege: 'PUBLIC' });
    const tools = interceptTools(
      [{ name: 'echo', execute: async (value: unknown) => ({ value }) }],
      { guard, audit, sessionId: 's1', policy }
    );
    await expect(tools[0].execute('hello')).resolves.toEqual({ value: 'hello' });
    expect(audit.all().filter((row) => row.event_type === 'tool.called')).toHaveLength(1);
  });

  it('blocks wrapped tool execution when enforce-mode policy requires approval', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'veluga-tool-block-'));
    const audit = new AuditLogger(path.join(dir, 'audit.sqlite'));
    await audit.init();
    const policy = makePolicy({
      institution: {
        approval_for_destructive: 'required',
        policy_guard_mode: 'enforce'
      }
    });
    const guard = new PolicyGuard(audit);
    guard.register({ name: 'write-file', privilege: 'WRITE_LOCAL' });
    let executed = false;
    const tools = interceptTools(
      [
        {
          name: 'write-file',
          execute: (_value: unknown) => {
            executed = true;
            return 'wrote';
          }
        }
      ],
      { guard, audit, sessionId: 's1', policy }
    );

    await expect(tools[0].execute('hello')).rejects.toThrow(/requires approval/);
    expect(executed).toBe(false);
    expect(audit.all().filter((row) => row.event_type === 'tool.called')).toHaveLength(0);
  });

  it('answers self-help from PolicyContext only and preserves mode-off fallback', async () => {
    const policy = makePolicy();
    const selfHelp = handleSystemSelfHelp({ policyContext: policy });
    expect(selfHelp).toContain('system-self-help');
    expect(selfHelp).not.toContain('style-card:');
    expect(await handleUserMessage('/help', policy, () => 'fallback')).toContain('Veluga로 할 수 있는 것');

    const offPolicy = makePolicy({ session: { enable_veluga_orchestration: false } });
    await expect(handleUserMessage('안녕', offPolicy, () => 'open cowork fallback')).resolves.toBe('open cowork fallback');
  });
});
