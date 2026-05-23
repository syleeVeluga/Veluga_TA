import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectableKbScopes, shouldShowExternalDataBanner, visibleSkills } from '../../packages/veluga-renderer/src/policy-bindings.js';
import { colors } from '../../packages/veluga-ui/theme.js';
import { createOpenAICompatibleGateway } from '../../packages/veluga-main/src/llm-gateway.js';
import { makePolicy } from './helpers.js';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const next = path.join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(next) : [next];
    })
  );
  return files.flat();
}

describe('Phase1 white-out and renderer bindings', () => {
  it('filters UI skills/scopes by PolicyContext and shows the external data banner only for general no-KB answers', () => {
    const policy = makePolicy();
    expect(visibleSkills(policy, ['system-self-help', 'style-card', 'docx-format'])).toEqual([
      'system-self-help',
      'docx-format'
    ]);
    expect(selectableKbScopes(policy, ['law:public', 'policy:internal', 'tax:public'])).toEqual([
      'law:public',
      'tax:public'
    ]);
    expect(shouldShowExternalDataBanner({ useKb: false, intentClass: 'general_qa', answerMode: 'general' })).toBe(true);
    expect(shouldShowExternalDataBanner({ useKb: true, intentClass: 'general_qa', answerMode: 'general' })).toBe(false);
    expect(colors.primary).toBe('#0B192C');
    expect(colors.secondary).toBe('#1E3E62');
  });

  it('requires internal gateway URL and contains no hardcoded public LLM endpoints in Veluga-owned code', async () => {
    expect(() => createOpenAICompatibleGateway({})).toThrow(/VELUGA_LLM_GATEWAY_URL/);
    const files = (await Promise.all(['packages/veluga-main', 'packages/veluga-renderer', 'packages/veluga-ui'].map(filesUnder))).flat();
    for (const file of files.filter((name) => /\.(ts|tsx|js|json|md)$/.test(name))) {
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/api\.(anthropic|openai)\.com/);
      expect(text, file).not.toMatch(/posthog|@sentry|@vercel\/analytics|datadog|@segment|mixpanel|react-ga/i);
    }
  });

  it('preserves Open Cowork MIT credit text and records manual verification gaps', async () => {
    const credits = await readFile('packages/veluga-ui/credits/LICENSES.md', 'utf8');
    const upstream = await readFile('docs/upstream-base.md', 'utf8');
    const verification = await readFile('docs/phase1-verification.md', 'utf8');
    expect(credits).toContain('Open Cowork');
    expect(credits).toContain('MIT License');
    expect(upstream).toContain('Attribution Record');
    expect(upstream).toContain('Open Cowork as its upstream MIT-licensed foundation');
    expect(verification).toContain('mitmproxy');
    expect(verification).toContain('Veluga Mode OFF');
  });

  it('uses Veluga product branding in packaged app metadata and primary renderer labels', async () => {
    const packageJson = JSON.parse(await readFile('packages/cowork-core/package.json', 'utf8')) as {
      name: string;
      author: string;
      description: string;
    };
    const indexHtml = await readFile('packages/cowork-core/index.html', 'utf8');
    const builderConfig = await readFile('packages/cowork-core/electron-builder.yml', 'utf8');
    const enLocale = await readFile('packages/cowork-core/src/renderer/i18n/locales/en.json', 'utf8');

    expect(packageJson.name).toBe('veluga');
    expect(packageJson.author).toBe('Veluga');
    expect(packageJson.description).toContain('Veluga AI agent desktop app');
    expect(indexHtml).toContain('<title>Veluga</title>');
    expect(builderConfig).toContain('appId: com.veluga.app');
    expect(builderConfig).toContain('productName: Veluga');
    expect(enLocale).toContain('Veluga logo');
    expect(enLocale).not.toContain('Open Cowork logo');
  });
});
