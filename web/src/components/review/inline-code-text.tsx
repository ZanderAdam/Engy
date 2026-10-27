import { inlineCodeSegments } from '@/lib/inline-code';

export function InlineCodeText({ text }: { text: string }) {
  return inlineCodeSegments(text).map((segment, index) =>
    segment.code ? (
      <code key={index} className="bg-muted px-1 font-mono text-[11px] text-foreground">
        {segment.text}
      </code>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}
