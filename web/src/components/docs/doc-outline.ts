/**
 * Document outline (table of contents) extracted from a BlockNote document.
 *
 * Pure helpers + shared types. The outline is derived from the editor's live
 * block model so headings stay current while editing, and each entry carries
 * the BlockNote block id used to scroll the editor to that heading.
 */

export interface OutlineHeading {
  /** BlockNote block id — rendered to the DOM as `[data-id]`, used for scrolling. */
  id: string;
  /** Heading level, 1–6. */
  level: number;
  /** Plain-text heading content. */
  text: string;
}

/**
 * The active document's outline plus a callback to scroll the editor to a
 * heading. Published by the active dock panel, consumed by the sidebar.
 */
export interface DocOutlineState {
  headings: OutlineHeading[];
  scrollTo: (headingId: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = { id?: string; type?: string; props?: any; content?: any; children?: AnyBlock[] };

function inlineToString(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((node) => {
      if (!node || typeof node !== 'object') return '';
      const n = node as { type?: string; text?: string; content?: unknown };
      if (n.type === 'text') return n.text ?? '';
      // Links wrap their visible text in a nested content array.
      if (n.type === 'link') return inlineToString(n.content);
      return '';
    })
    .join('');
}

/**
 * Walk a BlockNote document (depth-first, document order) and collect every
 * heading block into a flat outline. Blocks without an id or with empty text
 * are skipped — an outline entry needs both a scroll target and a label.
 */
export function extractOutline(blocks: readonly AnyBlock[]): OutlineHeading[] {
  const out: OutlineHeading[] = [];

  const walk = (list: readonly AnyBlock[]) => {
    for (const block of list) {
      if (block.type === 'heading' && block.id) {
        const text = inlineToString(block.content).trim();
        const level = Number(block.props?.level) || 1;
        if (text) out.push({ id: block.id, level, text });
      }
      if (block.children?.length) walk(block.children);
    }
  };

  walk(blocks);
  return out;
}

/** Shallow structural equality for two outlines (same ids, levels, and text in order). */
export function headingsEqual(a: readonly OutlineHeading[], b: readonly OutlineHeading[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h.id === b[i].id && h.level === b[i].level && h.text === b[i].text);
}
