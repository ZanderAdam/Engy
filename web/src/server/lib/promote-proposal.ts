import { getStore } from '../search/qmd-store';
import { runQmdSearch } from '../search/qmd-search';

interface MemoryProposal {
  title: string;
  subtype: 'decision' | 'pattern' | 'fact' | 'convention' | 'insight';
  keywords: string[];
  themes: string[];
  tags: string[];
  confidence: number;
  rationale: string;
  linkedMemories: string[];
}

const SUBTYPE_GUIDE = `Subtype classification:
- decision: "we chose X over Y because Z"
- pattern: "how X works, the recurring shape"
- fact: "X is true / X exists / X has these properties"
- convention: "the team rule / when to do X"
- insight: "something non-obvious / a learning / a gotcha"`;

function buildPrompt(content: string, similarTitles: string[]): string {
  const similarSection =
    similarTitles.length > 0
      ? `\nSimilar existing memories (for context):\n${similarTitles.map((t) => `- ${t}`).join('\n')}\n`
      : '';

  return `You are a knowledge curator. Classify and enrich this memory note with structured metadata.

${SUBTYPE_GUIDE}

Memory content:
"""
${content}
"""
${similarSection}
Return ONLY a JSON object with these fields (no markdown, no explanation):
{
  "title": "<concise title, max 80 chars, describes the core insight>",
  "subtype": "<one of: decision, pattern, fact, convention, insight>",
  "keywords": ["<3-8 specific retrieval terms: method names, nouns central to this claim>"],
  "themes": ["<1-4 high-level areas e.g. error-handling, auth, performance>"],
  "tags": ["<1-4 broad labels e.g. architecture, dx, security>"],
  "confidence": <0.7-1.0 reflecting how clear/certain this claim is>,
  "rationale": "<one sentence explaining subtype choice>",
  "linkedMemories": []
}`;
}

function parseProposal(text: string): MemoryProposal | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const subtypes = ['decision', 'pattern', 'fact', 'convention', 'insight'] as const;
    const subtype = subtypes.includes(raw.subtype as (typeof subtypes)[number])
      ? (raw.subtype as (typeof subtypes)[number])
      : 'fact';

    return {
      title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : '',
      subtype,
      keywords: Array.isArray(raw.keywords) ? (raw.keywords as string[]).slice(0, 8) : [],
      themes: Array.isArray(raw.themes) ? (raw.themes as string[]).slice(0, 4) : [],
      tags: Array.isArray(raw.tags) ? (raw.tags as string[]).slice(0, 4) : [],
      confidence:
        typeof raw.confidence === 'number'
          ? Math.min(1.0, Math.max(0.0, raw.confidence))
          : 0.8,
      rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
      linkedMemories: Array.isArray(raw.linkedMemories) ? (raw.linkedMemories as string[]) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Propose frontmatter metadata for a fleeting memory using the local LLM.
 *
 * Uses the LlamaCpp instance embedded in the qmd store (same model that powers
 * hybrid search, query expansion, and reranking). Returns null when QMD_SKIP=1
 * or when the model/store is unavailable.
 */
export async function proposeMemoryMetadata(
  content: string,
  workspaceSlug: string,
): Promise<MemoryProposal | null> {
  if (process.env.QMD_SKIP === '1') {
    return null;
  }

  let similarTitles: string[] = [];
  try {
    const hits = await runQmdSearch(workspaceSlug, content, 'memory', 5, 'hybrid', undefined);
    similarTitles = hits.map((h) => h.title).filter(Boolean);
  } catch {
    // similarity search is best-effort; proceed without it
  }

  const prompt = buildPrompt(content, similarTitles);

  try {
    const store = await getStore(workspaceSlug);
    const llm = store.internal.llm;
    if (!llm) return null;

    const result = await llm.generate(prompt, { maxTokens: 400, temperature: 0.2 });
    if (!result) return null;

    return parseProposal(result.text);
  } catch {
    return null;
  }
}
