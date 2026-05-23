import { existsSync } from 'node:fs';
import path from 'node:path';
import { mergePolicies, type MergePolicyInput, type ProjectPolicyInput } from '../../policy-service/src/merge.js';
import type { PolicyContextSnapshot, ProjectMeta } from '../../shared-types/src/index.js';
import { readProjectYaml } from './project-yaml.js';

export interface ProjectOpenResult {
  project: ProjectMeta | null;
  policy: PolicyContextSnapshot;
  reentry_banner: { summary: string; action: 'resume' } | null;
}

export function openProject(rootPath: string, baseInput: MergePolicyInput): ProjectOpenResult {
  const filePath = path.join(rootPath, 'project.yaml');
  if (!existsSync(filePath)) {
    return {
      project: null,
      policy: mergePolicies({ ...baseInput, project: null }),
      reentry_banner: null
    };
  }

  const projectYaml = readProjectYaml(filePath);
  const projectPolicy: ProjectPolicyInput = {
    project_id: projectYaml.project_id,
    active_skills: projectYaml.overrides?.active_skills ?? [],
    external_apis: projectYaml.overrides?.external_apis,
    audit_log: projectYaml.overrides?.audit_log,
    unverified_quotes: projectYaml.overrides?.unverified_quotes,
    approval_for_destructive: projectYaml.overrides?.approval_for_destructive,
    retention_default_days: projectYaml.overrides?.retention_default_days
  };
  const policy = mergePolicies({ ...baseInput, project: projectPolicy });
  const project: ProjectMeta = {
    project_id: projectYaml.project_id,
    owner: projectYaml.owner,
    root_path: rootPath,
    active_skills: projectYaml.overrides?.active_skills ?? [],
    style_card_id: projectYaml.style_card_id,
    last_session_summary: projectYaml.last_session_summary,
    last_session_at: projectYaml.last_session_at
  };
  return {
    project,
    policy,
    reentry_banner: projectYaml.last_session_summary
      ? { summary: projectYaml.last_session_summary, action: 'resume' }
      : null
  };
}
