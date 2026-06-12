import type { PmNode, TextQuoteSelector } from "./types";

/**
 * Convert a character offset in doc.textContent into a ProseMirror position.
 * doc.textContent concatenates text nodes with no separators; we count text
 * characters in traversal order to produce a consistent mapping.
 *
 * Accepts textOffset === total text length as the position just after the
 * final text node (fixes orphaned end-of-document anchors).
 */
function textOffsetToPmPos(doc: PmNode, textOffset: number): number {
  let count = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result !== -1) return false;
    if (node.isText) {
      const len = node.text!.length;
      if (count + len >= textOffset) {
        result = pos + (textOffset - count);
        return false;
      }
      count += len;
    }
  });
  return result;
}

/** Chars at the end of `a` that match the end of `b` */
function trailingOverlap(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/** Chars at the start of `a` that match the start of `b` */
function leadingOverlap(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function contextScore(fullText: string, start: number, selector: TextQuoteSelector): number {
  const prefixCtx = fullText.slice(Math.max(0, start - selector.prefix.length), start);
  const suffixCtx = fullText.slice(
    start + selector.exact.length,
    start + selector.exact.length + selector.suffix.length,
  );
  const ps = selector.prefix ? trailingOverlap(prefixCtx, selector.prefix) / selector.prefix.length : 1;
  const ss = selector.suffix ? leadingOverlap(suffixCtx, selector.suffix) / selector.suffix.length : 1;
  return (ps + ss) / 2;
}

function findOccurrences(text: string, needle: string): number[] {
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    const idx = text.indexOf(needle, pos);
    if (idx === -1) break;
    positions.push(idx);
    pos = idx + 1;
  }
  return positions;
}

/**
 * Find the best ProseMirror `{ from, to }` range for a TextQuoteSelector.
 *
 * Strategy:
 * 1. Exact match → pick by prefix/suffix context score
 * 2. Normalised fallback (collapse whitespace, case-insensitive)
 * 3. null → thread shows as orphaned in sidebar
 */
export function findTextQuoteMatch(
  doc: PmNode,
  selector: TextQuoteSelector,
): { from: number; to: number } | null {
  const fullText = doc.textContent;

  // 1. Exact match
  const occurrences = findOccurrences(fullText, selector.exact);
  const matchLen = selector.exact.length;

  // 2. Normalised fallback — build a position map so normalized match offsets
  //    translate back to the correct original-document offsets.
  //    map[i] = index in fullText corresponding to normStr[i].
  if (occurrences.length === 0) {
    const normExact = selector.exact.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normExact) {
      const map: number[] = [];
      let normStr = '';
      let inWhitespace = false;
      for (let i = 0; i < fullText.length; i++) {
        const ch = fullText[i];
        if (/\s/.test(ch)) {
          if (normStr.length === 0) continue; // trim leading
          if (!inWhitespace) {
            map.push(i);
            normStr += ' ';
            inWhitespace = true;
          }
        } else {
          inWhitespace = false;
          map.push(i);
          normStr += ch.toLowerCase();
        }
      }
      // trim trailing space (mirrors .trim())
      if (normStr.endsWith(' ')) {
        normStr = normStr.slice(0, -1);
        map.pop();
      }

      const normOccurrences = findOccurrences(normStr, normExact);
      if (normOccurrences.length > 0) {
        // Context scoring stays in normalised space; use a normalised selector
        // so suffix window offset uses normExact.length, not original length.
        const normSelector = {
          exact: normExact,
          prefix: selector.prefix.replace(/\s+/g, ' ').toLowerCase(),
          suffix: selector.suffix.replace(/\s+/g, ' ').toLowerCase(),
        };
        let bestNormStart = normOccurrences[0];
        let bestScore = contextScore(normStr, bestNormStart, normSelector);
        for (let i = 1; i < normOccurrences.length; i++) {
          const s = contextScore(normStr, normOccurrences[i], normSelector);
          if (s > bestScore) {
            bestScore = s;
            bestNormStart = normOccurrences[i];
          }
        }
        // Map normalized start/end back to original offsets.
        const normEnd = bestNormStart + normExact.length - 1;
        const origFrom = map[bestNormStart];
        const origTo =
          normEnd < map.length ? map[normEnd] + 1 : fullText.length;

        const from = textOffsetToPmPos(doc, origFrom);
        const to = textOffsetToPmPos(doc, origTo);
        if (from === -1 || to === -1) return null;
        return { from, to };
      }
    }
  }

  if (occurrences.length === 0) return null;

  // Pick best candidate by context score (exact-match path)
  let bestStart = occurrences[0];
  let bestScore = contextScore(fullText, bestStart, selector);
  for (let i = 1; i < occurrences.length; i++) {
    const s = contextScore(fullText, occurrences[i], selector);
    if (s > bestScore) {
      bestScore = s;
      bestStart = occurrences[i];
    }
  }

  const from = textOffsetToPmPos(doc, bestStart);
  const to = textOffsetToPmPos(doc, bestStart + matchLen);
  if (from === -1 || to === -1) return null;

  return { from, to };
}
