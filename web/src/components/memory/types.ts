export type MemoryKind = 'permanent' | 'fleeting';

export interface FleetingRecord {
  id: number;
  content: string;
  type: string;
  tags?: unknown;
  createdAt: string;
  dismissedAt?: string | null;
}

export interface MemorySelection {
  id: number;
  kind: MemoryKind;
  /** Populated when kind === 'fleeting' so MemoryDetail avoids a redundant fetch. */
  fleetingData?: FleetingRecord;
}

export type MemorySubtype = 'decision' | 'pattern' | 'fact' | 'convention' | 'insight';

export const SUBTYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  pattern: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  fact: 'bg-green-500/15 text-green-400 border-green-500/20',
  convention: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  insight: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
};

export const SUBTYPES: { value: MemorySubtype; label: string }[] = [
  { value: 'decision', label: 'Decision' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'fact', label: 'Fact' },
  { value: 'convention', label: 'Convention' },
  { value: 'insight', label: 'Insight' },
];

export type FleetingType = 'capture' | 'question' | 'blocker' | 'idea' | 'reference';

export const FLEETING_TYPES: { value: FleetingType; label: string }[] = [
  { value: 'capture', label: 'Capture' },
  { value: 'question', label: 'Question' },
  { value: 'blocker', label: 'Blocker' },
  { value: 'idea', label: 'Idea' },
  { value: 'reference', label: 'Reference' },
];
