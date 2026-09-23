const METADATA_KEYS = new Set([
  'type',
  'uuid',
  'source_uuid',
  'toolUseID',
  'timestamp',
  'model',
  'origin',
  'commandMode',
  'command',
  'hookName',
  'hookEvent',
  'durationMs',
  'exitCode',
  // `content` holds the hook output the model sees; `stdout` repeats it and `stderr` is not sent.
  'stdout',
  'stderr',
  'path',
  'filePath',
  'filename',
  'displayPath',
  // Name lists repeat the entries that `addedLines` and `content` already hold.
  'names',
  'addedNames',
  'addedTypes',
  'removedNames',
  'removedTypes',
  'readdedNames',
  'wireHiddenNames',
  'pendingMcpServers',
  'failedMcpServers',
]);

// These kinds record the system prompt, the tool schemas and the root CLAUDE.md files.
// The baseline already holds that context, so counting them would count it twice.
const RECORD_KINDS = new Set(['prompt_snapshot', 'instructions', 'deferred_tools_record']);

const LABEL_KEY_BY_KIND: Record<string, string> = {
  nested_memory: 'path',
  file: 'filename',
  edited_text_file: 'filename',
  hook_success: 'hookName',
};

interface AttachmentMeasure {
  kind: string;
  label: string;
  chars: number;
}

export function measureAttachment(attachment: Record<string, unknown>): AttachmentMeasure | null {
  const kind = typeof attachment.type === 'string' && attachment.type ? attachment.type : 'unknown';
  if (RECORD_KINDS.has(kind)) return null;
  const labelKey = LABEL_KEY_BY_KIND[kind];
  const labelValue = labelKey ? attachment[labelKey] : undefined;
  return {
    kind,
    label: typeof labelValue === 'string' ? labelValue : '',
    chars: countTextChars(attachment),
  };
}

function countTextChars(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countTextChars(item), 0);
  }
  if (!value || typeof value !== 'object') return 0;

  let chars = 0;
  for (const [key, child] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) chars += countTextChars(child);
  }
  return chars;
}
