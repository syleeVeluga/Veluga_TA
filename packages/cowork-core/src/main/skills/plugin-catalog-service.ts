import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginCatalogItem, PluginComponentCounts } from '../../renderer/types';
import { isPathWithinRoot } from '../tools/path-containment';

interface CachedCatalog {
  expiresAt: number;
  data: PluginCatalogItem[];
}

const CLAUDE_PLUGINS_URL = 'https://claude.com/plugins';
const CACHE_TTL_MS = 60_000;
const DEFAULT_USER_AGENT = 'veluga-plugin-catalog/3.0';
const DETAIL_FETCH_CONCURRENCY = 8;

const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  mcp: 0,
};

class HttpRequestError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

interface VelugaCatalogManifest {
  plugins?: VelugaCatalogEntry[];
}

interface VelugaCatalogEntry {
  name?: string;
  description?: string;
  version?: string;
  authorName?: string;
  pluginId?: string;
  path?: string;
  catalogSource?: 'veluga-marketplace' | 'veluga-offline-bundle';
}

export class PluginCatalogService {
  private readonly fetchFn: typeof fetch;
  private readonly velugaCatalogPath?: string;
  private cache: CachedCatalog | null = null;

  constructor(fetchFn: typeof fetch = fetch, options?: { velugaCatalogPath?: string }) {
    this.fetchFn = fetchFn;
    this.velugaCatalogPath = options?.velugaCatalogPath;
  }

  async listAvailablePlugins(
    forceRefresh = false,
    installableOnly = false
  ): Promise<PluginCatalogItem[]> {
    const velugaPlugins = await this.listVelugaPlugins(installableOnly);
    const marketplacePlugins = await this.listAnthropicPlugins(forceRefresh, installableOnly);
    return [...velugaPlugins, ...marketplacePlugins].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listVelugaPlugins(installableOnly = false): Promise<PluginCatalogItem[]> {
    const indexPath = this.velugaCatalogPath || process.env.VELUGA_PLUGIN_CATALOG_PATH;
    if (!indexPath) {
      return [];
    }
    if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
      return [];
    }

    const manifest = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as VelugaCatalogManifest;
    const indexDir = path.dirname(indexPath);
    const items = (manifest.plugins || [])
      .map((entry) => this.readVelugaCatalogEntry(entry, indexDir))
      .filter((item): item is PluginCatalogItem => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return installableOnly ? items.filter((item) => item.installable) : items;
  }

  async listAnthropicPlugins(
    forceRefresh = false,
    installableOnly = false
  ): Promise<PluginCatalogItem[]> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return installableOnly
        ? this.cache.data.filter((plugin) => plugin.installable)
        : this.cache.data;
    }

    try {
      const homeHtml = await this.fetchText(CLAUDE_PLUGINS_URL);
      const slugs = this.extractPluginSlugs(homeHtml);
      const detailErrors: string[] = [];
      const pluginCandidates = await this.mapWithConcurrency(
        slugs,
        DETAIL_FETCH_CONCURRENCY,
        async (slug) => {
          try {
            return await this.readMarketplacePlugin(slug);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            detailErrors.push(`${slug}: ${message}`);
            return null;
          }
        }
      );

      const data = pluginCandidates
        .filter((plugin): plugin is PluginCatalogItem => plugin !== null)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (slugs.length > 0 && data.length === 0 && detailErrors.length > 0) {
        throw new Error(
          `All plugin detail requests failed (${detailErrors.length}/${slugs.length}). First error: ${detailErrors[0]}`
        );
      }

      return this.setAndFilterCache(data, installableOnly);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch plugin catalog: ${message}`);
    }
  }

  async downloadPlugin(_pluginName: string, _targetRootPath: string): Promise<string> {
    throw new Error(
      'Direct plugin download is no longer supported. Install via Claude CLI instead.'
    );
  }

  private readVelugaCatalogEntry(
    entry: VelugaCatalogEntry,
    indexDir: string
  ): PluginCatalogItem | null {
    if (!entry.path) {
      return null;
    }

    const pluginRootPath = path.resolve(indexDir, entry.path);
    if (!isPathWithinRoot(pluginRootPath, indexDir)) {
      return null;
    }
    if (!fs.existsSync(pluginRootPath) || !fs.statSync(pluginRootPath).isDirectory()) {
      return null;
    }

    const manifest = this.readLocalPluginManifest(pluginRootPath);
    const name = entry.name || manifest?.name || path.basename(pluginRootPath);
    const pluginId = entry.pluginId || this.sanitizePluginId(name);
    const componentCounts = this.detectComponentCounts(pluginRootPath, manifest);

    return {
      name,
      description: entry.description || manifest?.description,
      version: entry.version || manifest?.version,
      authorName: entry.authorName || this.resolveAuthorName(manifest?.author),
      installable: true,
      hasManifest: Boolean(manifest),
      componentCounts,
      skillCount: componentCounts.skills,
      hasSkills: componentCounts.skills > 0,
      pluginId,
      installCommand: `veluga plugin install ${pluginId}`,
      detailUrl: pluginRootPath,
      catalogSource: entry.catalogSource || 'veluga-offline-bundle',
      localPath: pluginRootPath,
    };
  }

  private async readMarketplacePlugin(slug: string): Promise<PluginCatalogItem | null> {
    const detailUrl = `${CLAUDE_PLUGINS_URL}/${slug}`;
    const html = await this.fetchText(detailUrl);
    const installCommand = this.extractInstallCommand(html);
    const pluginId = this.extractPluginId(installCommand);

    if (!installCommand || !pluginId) {
      return null;
    }

    const name = this.extractPluginName(html, slug);
    const description = this.extractMetaDescription(html);
    const authorName = this.extractAuthorName(html);

    return {
      name,
      description,
      version: undefined,
      authorName,
      installable: true,
      hasManifest: false,
      componentCounts: { ...EMPTY_COUNTS },
      skillCount: 0,
      hasSkills: false,
      pluginId,
      installCommand,
      detailUrl,
      catalogSource: 'claude-marketplace',
    };
  }

  private extractPluginSlugs(html: string): string[] {
    const slugs = new Set<string>();
    const matches = html.matchAll(
      // eslint-disable-next-line no-useless-escape
      /\bhref\s*=\s*(?:"(?:https?:\/\/claude\.com)?\/plugins\/([^"#?\/]+)\/?"|'(?:https?:\/\/claude\.com)?\/plugins\/([^'#?\/]+)\/?')/gi
    );
    for (const match of matches) {
      const slug = decodeURIComponent((match[1] ?? match[2] ?? '').trim());
      if (slug) {
        slugs.add(slug);
      }
    }
    return [...slugs];
  }

  private extractInstallCommand(html: string): string | undefined {
    const match = html.match(/\bdata-copy\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    if (!match) {
      const fallbackMatch = this.decodeHtml(html).match(
        /claude plugin (?:install|add)\s+[^\s"'`<]+/i
      );
      return fallbackMatch?.[0];
    }
    const value = this.decodeHtml((match[1] || match[2] || '').trim());
    if (!/^claude plugin (?:install|add)\s+/i.test(value)) {
      return undefined;
    }
    return value;
  }

  private extractPluginId(installCommand: string | undefined): string | undefined {
    if (!installCommand) {
      return undefined;
    }
    const match = installCommand.match(/^claude plugin (?:install|add)\s+([^\s"'`]+)/i);
    return match?.[1];
  }

  private extractPluginName(html: string, fallbackSlug: string): string {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = this.decodeHtml(titleMatch[1]).trim();
      const shortTitle = title.replace(/\s*[–-]\s*Claude Plugin.*$/i, '').trim();
      if (shortTitle) {
        return shortTitle;
      }
    }
    return fallbackSlug;
  }

  private extractMetaDescription(html: string): string | undefined {
    const direct = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
    if (direct?.[1]) {
      return this.decodeHtml(direct[1]).trim();
    }

    const reversed = html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
    if (reversed?.[1]) {
      return this.decodeHtml(reversed[1]).trim();
    }

    return undefined;
  }

  private extractAuthorName(html: string): string | undefined {
    const byLabelPattern = /Made by<\/div>\s*<a[^>]*>\s*<div[^>]*>([^<]+)<\/div>/i;
    const match = html.match(byLabelPattern);
    if (!match?.[1]) {
      return undefined;
    }

    const value = this.decodeHtml(match[1]).trim();
    return value || undefined;
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>
  ): Promise<R[]> {
    if (values.length === 0) {
      return [];
    }

    const output: R[] = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        output[currentIndex] = await mapper(values[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return output;
  }

  private setAndFilterCache(
    data: PluginCatalogItem[],
    installableOnly: boolean
  ): PluginCatalogItem[] {
    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    };
    return installableOnly ? data.filter((plugin) => plugin.installable) : data;
  }

  private readLocalPluginManifest(pluginRootPath: string): (VelugaCatalogEntry & {
    author?: string | { name?: string };
    commands?: string | string[];
    agents?: string | string[];
    hooks?: string | Record<string, unknown>;
    mcpServers?: string | Record<string, unknown>;
  }) | null {
    const manifestPath = path.join(pluginRootPath, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  }

  private detectComponentCounts(
    pluginRootPath: string,
    manifest: ReturnType<PluginCatalogService['readLocalPluginManifest']>
  ): PluginComponentCounts {
    return {
      skills: this.countSkills(pluginRootPath),
      commands: this.countMarkdownComponent(
        pluginRootPath,
        this.resolveComponentPaths(manifest?.commands, ['./commands'])
      ),
      agents: this.countMarkdownComponent(
        pluginRootPath,
        this.resolveComponentPaths(manifest?.agents, ['./agents'])
      ),
      hooks: this.countHooks(pluginRootPath, manifest),
      mcp: this.countMcp(pluginRootPath, manifest),
    };
  }

  private countSkills(pluginRootPath: string): number {
    const skillsRoot = path.join(pluginRootPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return 0;
    }
    return fs.readdirSync(skillsRoot, { withFileTypes: true }).reduce((count, entry) => {
      if (!entry.isDirectory()) {
        return count;
      }
      return fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')) ? count + 1 : count;
    }, 0);
  }

  private countMarkdownComponent(pluginRootPath: string, relativePaths: string[]): number {
    const files = new Set<string>();
    for (const relativePath of relativePaths) {
      const targetPath = this.resolveSafePath(pluginRootPath, relativePath);
      if (!targetPath || !fs.existsSync(targetPath)) {
        continue;
      }
      const stat = fs.statSync(targetPath);
      if (stat.isFile() && targetPath.toLowerCase().endsWith('.md')) {
        files.add(targetPath);
        continue;
      }
      if (!stat.isDirectory()) {
        continue;
      }
      for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          files.add(path.join(targetPath, entry.name));
        }
      }
    }
    return files.size;
  }

  private countHooks(
    pluginRootPath: string,
    manifest: ReturnType<PluginCatalogService['readLocalPluginManifest']>
  ): number {
    if (manifest?.hooks && typeof manifest.hooks === 'object') {
      return 1;
    }
    const hookPath = this.resolveSafePath(
      pluginRootPath,
      typeof manifest?.hooks === 'string' ? manifest.hooks : './hooks/hooks.json'
    );
    return hookPath && fs.existsSync(hookPath) ? 1 : 0;
  }

  private countMcp(
    pluginRootPath: string,
    manifest: ReturnType<PluginCatalogService['readLocalPluginManifest']>
  ): number {
    if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
      return 1;
    }
    const mcpPath = this.resolveSafePath(
      pluginRootPath,
      typeof manifest?.mcpServers === 'string' ? manifest.mcpServers : './.mcp.json'
    );
    return mcpPath && fs.existsSync(mcpPath) ? 1 : 0;
  }

  private resolveComponentPaths(
    value: string | string[] | undefined,
    fallback: string[]
  ): string[] {
    if (!value) {
      return fallback;
    }
    return Array.isArray(value) ? value : [value];
  }

  private resolveSafePath(rootPath: string, relativePath: string): string | null {
    const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/')) {
      return null;
    }
    const resolved = path.resolve(rootPath, normalized);
    return isPathWithinRoot(resolved, rootPath) ? resolved : null;
  }

  private sanitizePluginId(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || `plugin-${Date.now()}`;
  }

  private resolveAuthorName(author: string | { name?: string } | undefined): string | undefined {
    if (!author) {
      return undefined;
    }
    return typeof author === 'string' ? author : author.name;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchFn(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new HttpRequestError(
        response.status,
        url,
        `Request failed (${response.status}) for ${url}${message ? `: ${message}` : ''}`
      );
    }

    return response.text();
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (!text) {
        return '';
      }
      return text.slice(0, 200);
    } catch {
      return '';
    }
  }
}
