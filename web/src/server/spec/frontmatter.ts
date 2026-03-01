import yaml from 'js-yaml';

export type SpecStatus = 'draft' | 'ready' | 'approved' | 'active' | 'completed';
export type SpecType = 'buildable' | 'vision';

export interface SpecFrontmatter {
  title: string;
  status: SpecStatus;
  type: SpecType;
}

interface ParsedSpec {
  frontmatter: SpecFrontmatter;
  body: string;
  raw: Record<string, unknown>;
}

const DEFAULTS: SpecFrontmatter = { title: '', status: 'draft', type: 'buildable' };
const DELIMITER = '---';

export function parseFrontmatter(content: string): ParsedSpec {
  if (!content.startsWith(DELIMITER)) {
    return { frontmatter: { ...DEFAULTS }, body: content, raw: {} };
  }

  const endIndex = content.indexOf(`\n${DELIMITER}`, DELIMITER.length);
  if (endIndex === -1) {
    return { frontmatter: { ...DEFAULTS }, body: content, raw: {} };
  }

  const yamlBlock = content.slice(DELIMITER.length + 1, endIndex);
  const body = content.slice(endIndex + DELIMITER.length + 2).replace(/^\n/, '');

  let raw: Record<string, unknown>;
  try {
    const parsed = yaml.load(yamlBlock);
    if (typeof parsed !== 'object' || parsed === null) {
      return { frontmatter: { ...DEFAULTS }, body, raw: {} };
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return { frontmatter: { ...DEFAULTS }, body, raw: {} };
  }

  const frontmatter: SpecFrontmatter = {
    title: typeof raw.title === 'string' ? raw.title : DEFAULTS.title,
    status: isValidStatus(raw.status) ? raw.status : DEFAULTS.status,
    type: isValidType(raw.type) ? raw.type : DEFAULTS.type,
  };

  return { frontmatter, body, raw };
}

export function serializeFrontmatter(
  frontmatter: SpecFrontmatter,
  body: string,
  raw?: Record<string, unknown>,
): string {
  const data: Record<string, unknown> = raw ? { ...raw, ...frontmatter } : { ...frontmatter };
  const yamlStr = yaml.dump(data, { lineWidth: -1 }).trimEnd();
  return `${DELIMITER}\n${yamlStr}\n${DELIMITER}\n${body}`;
}

function isValidStatus(value: unknown): value is SpecStatus {
  return typeof value === 'string' && ['draft', 'ready', 'approved', 'active', 'completed'].includes(value);
}

function isValidType(value: unknown): value is SpecType {
  return typeof value === 'string' && ['buildable', 'vision'].includes(value);
}
