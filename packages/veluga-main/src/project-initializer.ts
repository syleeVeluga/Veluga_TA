import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PolicyContext, ProjectYaml } from '../../shared-types/src/index.js';
import { writeProjectYaml } from './project-yaml.js';

export interface ProjectInitializerOptions {
  purpose?: string;
  now?: Date;
  projectId?: string;
}

export function initializeProject(rootPath: string, policy: PolicyContext, options: ProjectInitializerOptions = {}): ProjectYaml {
  mkdirSync(rootPath, { recursive: true });
  const filePath = path.join(rootPath, 'project.yaml');
  if (existsSync(filePath)) {
    throw new Error(`project.yaml already exists: ${filePath}`);
  }

  const project: ProjectYaml = {
    project_id: options.projectId ?? `project-${stableSuffix(rootPath)}`,
    owner: policy.user.user_id,
    purpose: options.purpose ?? '',
    created_at: (options.now ?? new Date()).toISOString(),
    overrides: {
      active_skills: defaultProjectSkills(policy),
      pinned_kb_docs: []
    },
    shared_with: [],
    style_card_id: null,
    last_session_summary: null,
    last_session_at: null,
    docx_citation_style: 'footnote'
  };
  writeProjectYaml(filePath, project);
  return project;
}

function defaultProjectSkills(policy: PolicyContext): string[] {
  const defaults = new Set([...policy.org.default_skills, ...policy.active_skill_ids]);
  for (const skill of ['docx', 'style-card', 'citation-verifier']) {
    defaults.add(skill);
  }
  return [...defaults].sort();
}

function stableSuffix(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
}
