export type FileClass = 'implementation' | 'test' | 'docs' | 'generated' | 'lockfile';

export interface LineCount {
  added: number;
  removed: number;
}

interface AttributeRule {
  matcher: RegExp;
  generated?: boolean;
  documentation?: boolean;
}

export const FILE_CLASS_ORDER: readonly FileClass[] = [
  'implementation',
  'test',
  'docs',
  'generated',
  'lockfile',
];

export const FILE_CLASS_LABELS: Record<FileClass, string> = {
  implementation: 'Implementation',
  test: 'Tests',
  docs: 'Docs',
  generated: 'Generated',
  lockfile: 'Lockfiles',
};

export const COLLAPSED_BY_DEFAULT: ReadonlySet<FileClass> = new Set(['generated', 'lockfile']);

const LOCKFILE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum|[^/]*\.lock)$/;
const GENERATED =
  /(?:^|\/)(?:dist|generated)\/|\.snap$|\.min\.[^/]+$|(?:^|\/)meta\/[^/]*_snapshot\.json$/;
const TEST = /\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:__tests__|tests?)\//;
const DOCS = /\.md$|(?:^|\/)docs\//;

function globToRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
  const body = pattern.replace(/^\//, '');
  let source = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '*' && body[i + 1] === '*') {
      const followedBySlash = body[i + 2] === '/';
      source += followedBySlash ? '(?:.*/)?' : '.*';
      i += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(anchored ? `^${source}$` : `(?:^|/)${source}$`);
}

function readFlag(attribute: string, name: string): boolean | null | undefined {
  if (attribute === name || attribute === `${name}=true`) return true;
  if (attribute === `-${name}` || attribute === `${name}=false`) return false;
  if (attribute === `!${name}`) return null;
  return undefined;
}

export function parseGitattributes(text: string): AttributeRule[] {
  const rules: AttributeRule[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...attributes] = line.split(/\s+/);
    const rule: AttributeRule = { matcher: globToRegex(pattern) };
    let relevant = false;
    for (const attribute of attributes) {
      const generated = readFlag(attribute, 'linguist-generated');
      const documentation = readFlag(attribute, 'linguist-documentation');
      if (generated !== undefined) {
        rule.generated = generated ?? undefined;
        relevant = true;
      }
      if (documentation !== undefined) {
        rule.documentation = documentation ?? undefined;
        relevant = true;
      }
    }
    if (relevant) rules.push(rule);
  }
  return rules;
}

function attributesFor(
  path: string,
  rules: AttributeRule[],
): Pick<AttributeRule, 'generated' | 'documentation'> {
  const attributes: Pick<AttributeRule, 'generated' | 'documentation'> = {};
  for (const rule of rules) {
    if (!rule.matcher.test(path)) continue;
    if ('generated' in rule) attributes.generated = rule.generated;
    if ('documentation' in rule) attributes.documentation = rule.documentation;
  }
  return attributes;
}

export function classifyPath(path: string, rules: AttributeRule[] = []): FileClass {
  const attributes = attributesFor(path, rules);
  if (attributes.generated === true) return 'generated';
  if (attributes.documentation === true) return 'docs';
  if (LOCKFILE.test(path)) return 'lockfile';
  if (attributes.generated !== false && GENERATED.test(path)) return 'generated';
  if (TEST.test(path)) return 'test';
  if (DOCS.test(path)) return 'docs';
  return 'implementation';
}

export function classifyPaths(
  paths: string[],
  rules: AttributeRule[] = [],
): Map<string, FileClass> {
  return new Map(paths.map((path) => [path, classifyPath(path, rules)]));
}

export function orderByClass<T extends { path: string }>(
  files: T[],
  classes: Map<string, FileClass>,
): T[] {
  const rank = (file: T) => FILE_CLASS_ORDER.indexOf(classes.get(file.path) ?? 'implementation');
  return [...files].sort((a, b) => rank(a) - rank(b));
}

export function countPatchLines(patch: string): LineCount {
  const count: LineCount = { added: 0, removed: 0 };
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      count.added++;
    } else if (inHunk && line.startsWith('-')) {
      count.removed++;
    }
  }
  return count;
}

export function implementationLines(total: LineCount, others: LineCount[]): LineCount {
  const sum = (key: keyof LineCount) => others.reduce((acc, other) => acc + other[key], 0);
  return {
    added: Math.max(0, total.added - sum('added')),
    removed: Math.max(0, total.removed - sum('removed')),
  };
}
