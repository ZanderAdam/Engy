interface InlineSegment {
  text: string;
  code: boolean;
}

export function inlineCodeSegments(text: string): InlineSegment[] {
  return text
    .split(/`([^`\n]+)`/)
    .map((part, index) => ({ text: part, code: index % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}
