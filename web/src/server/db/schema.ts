import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import type { GhPrCheck } from '@engy/common';
// Type-only, relative (not `@/`) so drizzle-kit can load this file standalone.
import type { WorkspaceAgentSettings } from '../../lib/agent-types';

// ── Workspaces ──────────────────────────────────────────────────────

export interface ContainerConfig {
  allowedDomains?: string[];
  extraPackages?: string[];
  envVars?: Record<string, string>;
  idleTimeout?: number;
}

export type { ExecutionBackend } from '@engy/common';

export interface CoderConfig {
  workspace: string;
  repoBasePath: string;
}

export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  repos: text('repos', { mode: 'json' }).$type<string[]>().default([]),
  docsDir: text('docs_dir'),
  planSkill: text('plan_skill'),
  implementSkill: text('implement_skill'),
  // Agent CLI new terminals default to (claude | codex | future). Plain text,
  // not an enum, so adding an agent needs only an agent-types registry entry —
  // validated against that registry at the router, never a schema migration.
  defaultAgentType: text('default_agent_type').default('claude'),
  // Per-agent overrides ({ [agentTypeId]: { active, mode, planSkill,
  // implementSkill } }), same registry-validated-at-the-router approach.
  // Absent key = active with the agent's default mode/skills.
  agentSettings: text('agent_settings', { mode: 'json' }).$type<WorkspaceAgentSettings>(),
  earsBdd: integer('ears_bdd', { mode: 'boolean' }).default(false),
  splitWorktrees: integer('split_worktrees', { mode: 'boolean' }).default(false),
  // Quick actions only — background executions already get a worktree from
  // the daemon runner.
  agentWorktrees: integer('agent_worktrees', { mode: 'boolean' }).default(false),
  containerEnabled: integer('container_enabled', { mode: 'boolean' }).default(false),
  containerConfig: text('container_config', { mode: 'json' }).$type<ContainerConfig>(),
  executionBackend: text('execution_backend', { enum: ['devcontainer', 'coder'] }).default(
    'devcontainer',
  ),
  coderConfig: text('coder_config', { mode: 'json' }).$type<CoderConfig>(),
  maxConcurrency: integer('max_concurrency').default(1),
  autoAgentCompletion: text('auto_agent_completion', { enum: ['pr', 'merge'] }).default('pr'),
  remoteEnabled: integer('remote_enabled', { mode: 'boolean' }).default(false),
  voiceEnabled: integer('voice_enabled', { mode: 'boolean' }).default(false),
  // Separate from voiceEnabled: speaking back is its own choice, and it
  // downloads its own voice model.
  ttsEnabled: integer('tts_enabled', { mode: 'boolean' }).default(false),
  autoStart: integer('auto_start', { mode: 'boolean' }).default(false),
  autoCiFix: integer('auto_ci_fix', { mode: 'boolean' }).default(false),
  autoReviewOnRequest: integer('auto_review_on_request', { mode: 'boolean' }).default(false),
  prScope: text('pr_scope', { enum: ['mine', 'review'] }).default('mine'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  projects: many(projects),
  permanentMemories: many(permanentMemories),
  fleetingMemories: many(fleetingMemories),
  frontmatterEntries: many(frontmatter),
}));

// ── Projects ────────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status', {
    enum: ['planning', 'active', 'completing', 'archived'],
  })
    .notNull()
    .default('planning'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  projectDir: text('project_dir'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  tasks: many(tasks),
}));

// ── Task Groups ─────────────────────────────────────────────────────

export const taskGroups = sqliteTable('task_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  milestoneRef: text('milestone_ref'),
  name: text('name').notNull(),
  status: text('status', {
    enum: ['planned', 'active', 'review', 'complete'],
  })
    .notNull()
    .default('planned'),
  numInMilestone: integer('num_in_milestone').notNull().default(0),
  repos: text('repos', { mode: 'json' }).$type<string[]>(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const taskGroupsRelations = relations(taskGroups, ({ one, many }) => ({
  project: one(projects, {
    fields: [taskGroups.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
  agentSessions: many(agentSessions),
}));

// ── Tasks ───────────────────────────────────────────────────────────

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  milestoneRef: text('milestone_ref'),
  taskGroupId: integer('task_group_id').references(() => taskGroups.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['backlog', 'todo', 'in_progress', 'review', 'done'],
  })
    .notNull()
    .default('todo'),
  type: text('type', { enum: ['ai', 'human'] })
    .notNull()
    .default('human'),
  importance: text('importance', { enum: ['important', 'not_important'] }).default('not_important'),
  urgency: text('urgency', { enum: ['urgent', 'not_urgent'] }).default('not_urgent'),
  needsPlan: integer('needs_plan', { mode: 'boolean' }).notNull().default(true),
  specId: text('spec_id'),
  subStatus: text('sub_status', {
    enum: ['planning', 'implementing', 'blocked', 'failed', 'plan_review'],
  }),
  sessionId: text('session_id'),
  feedback: text('feedback'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── Questions ──────────────────────────────────────────────────────

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export const questions = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  sessionId: text('session_id').notNull(),
  documentPath: text('document_path'),
  context: text('context'),
  question: text('question').notNull(),
  header: text('header').notNull(),
  options: text('options', { mode: 'json' }).$type<QuestionOption[]>(),
  multiSelect: integer('multi_select', { mode: 'boolean' }).default(false),
  answer: text('answer'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  answeredAt: text('answered_at'),
});

export const questionsRelations = relations(questions, ({ one }) => ({
  task: one(tasks, {
    fields: [questions.taskId],
    references: [tasks.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  taskGroup: one(taskGroups, {
    fields: [tasks.taskGroupId],
    references: [taskGroups.id],
  }),
  questions: many(questions),
}));

// ── Task Dependencies (join table) ──────────────────────────────────

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    blockerTaskId: integer('blocker_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('task_dep_unique').on(table.taskId, table.blockerTaskId)],
);

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  task: one(tasks, {
    fields: [taskDependencies.taskId],
    references: [tasks.id],
  }),
  blockerTask: one(tasks, {
    fields: [taskDependencies.blockerTaskId],
    references: [tasks.id],
  }),
}));

// ── Agent Sessions ──────────────────────────────────────────────────

export const agentSessions = sqliteTable('agent_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().unique(),
  taskGroupId: integer('task_group_id').references(() => taskGroups.id, { onDelete: 'set null' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  executionMode: text('execution_mode', {
    enum: ['group', 'task', 'milestone', 'planning'],
  }),
  completionSummary: text('completion_summary'),
  worktreePath: text('worktree_path'),
  branch: text('branch'),
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status', {
    enum: ['active', 'paused', 'stopped', 'completed', 'submitted'],
  })
    .notNull()
    .default('active'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const agentSessionsRelations = relations(agentSessions, ({ one }) => ({
  taskGroup: one(taskGroups, {
    fields: [agentSessions.taskGroupId],
    references: [taskGroups.id],
  }),
  task: one(tasks, {
    fields: [agentSessions.taskId],
    references: [tasks.id],
  }),
}));

// ── Permanent Memories ──────────────────────────────────────────────

export type MemorySubtype = 'decision' | 'pattern' | 'fact' | 'convention' | 'insight';

export const permanentMemories = sqliteTable('permanent_memories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  subtype: text('subtype', {
    enum: ['decision', 'pattern', 'fact', 'convention', 'insight'],
  })
    .notNull()
    .default('fact'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  repo: text('repo'),
  confidence: real('confidence').default(1.0),
  keywords: text('keywords', { mode: 'json' }).$type<string[]>().default([]),
  themes: text('themes', { mode: 'json' }).$type<string[]>().default([]),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  linkedMemories: text('linked_memories', { mode: 'json' }).$type<string[]>().default([]),
  scenarioIds: text('scenario_ids', { mode: 'json' }).$type<string[]>().default([]),
  sources: text('sources', { mode: 'json' }).$type<string[]>().default([]),
  filePath: text('file_path'),
  supersededById: integer('superseded_by_id'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const permanentMemoriesRelations = relations(permanentMemories, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [permanentMemories.workspaceId],
    references: [workspaces.id],
  }),
  supersededBy: one(permanentMemories, {
    fields: [permanentMemories.supersededById],
    references: [permanentMemories.id],
    relationName: 'supersededBy',
  }),
}));

// ── Fleeting Memories ───────────────────────────────────────────────

export const fleetingMemories = sqliteTable('fleeting_memories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  type: text('type', {
    enum: ['capture', 'question', 'blocker', 'idea', 'reference'],
  })
    .notNull()
    .default('capture'),
  source: text('source', { enum: ['agent', 'user', 'system'] })
    .notNull()
    .default('agent'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  promoted: integer('promoted', { mode: 'boolean' }).notNull().default(false),
  promotedFromId: integer('promoted_from_id').references(() => permanentMemories.id, {
    onDelete: 'set null',
  }),
  promotedAt: text('promoted_at'),
  dismissedAt: text('dismissed_at'),
  sources: text('sources', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const fleetingMemoriesRelations = relations(fleetingMemories, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [fleetingMemories.workspaceId],
    references: [workspaces.id],
  }),
  promotedFrom: one(permanentMemories, {
    fields: [fleetingMemories.promotedFromId],
    references: [permanentMemories.id],
  }),
}));

// ── Frontmatter Index ───────────────────────────────────────────────

export type FrontmatterCollection = 'system' | 'docs' | 'projects' | 'memory';

export const frontmatter = sqliteTable(
  'frontmatter',
  {
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    collection: text('collection', {
      enum: ['system', 'docs', 'projects', 'memory'],
    }).notNull(),
    path: text('path').notNull(),
    data: text('data').notNull(),
    indexedAt: text('indexed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.path] }),
    index('idx_frontmatter_collection').on(table.workspaceId, table.collection),
  ],
);

export const frontmatterRelations = relations(frontmatter, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [frontmatter.workspaceId],
    references: [workspaces.id],
  }),
}));

// ── Comments ────────────────────────────────────────────────────────

export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  documentPath: text('document_path').notNull(),
  anchorStart: integer('anchor_start'),
  anchorEnd: integer('anchor_end'),
  content: text('content').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const commentsRelations = relations(comments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [comments.workspaceId],
    references: [workspaces.id],
  }),
}));

// ── Comment Threads (BlockNote native) ─────────────────────────────
// TODO: drop legacy `comments` table once migration to threads is complete

export const commentThreads = sqliteTable('comment_threads', {
  id: text('id').primaryKey(),
  workspaceId: integer('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  documentPath: text('document_path').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  resolvedBy: text('resolved_by'),
  resolvedAt: text('resolved_at'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const commentThreadsRelations = relations(commentThreads, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [commentThreads.workspaceId],
    references: [workspaces.id],
  }),
  comments: many(threadComments),
}));

export const threadComments = sqliteTable('thread_comments', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => commentThreads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  body: text('body', { mode: 'json' }).$type<unknown>(),
  reactions: text('reactions', { mode: 'json' })
    .$type<Array<{ emoji: string; createdAt: string; userIds: string[] }>>()
    .default([]),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const threadCommentsRelations = relations(threadComments, ({ one }) => ({
  thread: one(commentThreads, {
    fields: [threadComments.threadId],
    references: [commentThreads.id],
  }),
}));

// ── Pull Requests ────────────────────────────────────────────────────

export const prs = sqliteTable(
  'prs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    headBranch: text('head_branch').notNull(),
    headSha: text('head_sha'),
    author: text('author').notNull(),
    isDraft: integer('is_draft', { mode: 'boolean' }).notNull().default(false),
    ciStatus: text('ci_status', {
      enum: ['pending', 'passing', 'failing', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    checks: text('checks', { mode: 'json' }).$type<GhPrCheck[]>().notNull(),
    commentCount: integer('comment_count').notNull().default(0),
    authoredByViewer: integer('authored_by_viewer', { mode: 'boolean' }).notNull().default(false),
    reviewDecision: text('review_decision'),
    repoFullName: text('repo_full_name'),
    baseRef: text('base_ref'),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    reviewRequests: text('review_requests', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    lastFailedHeadSha: text('last_failed_head_sha'),
    autoFixAttempts: integer('auto_fix_attempts').notNull().default(0),
    autoFixTotalAttempts: integer('auto_fix_total_attempts').notNull().default(0),
    attentionReason: text('attention_reason'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('prs_repo_number_unique').on(table.repo, table.number),
    index('idx_prs_repo').on(table.repo),
  ],
);

export const reviewWorktrees = sqliteTable(
  'review_worktrees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoPath: text('repo_path').notNull(),
    repoFullName: text('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    worktreePath: text('worktree_path').notNull(),
    headRefName: text('head_ref_name').notNull(),
    headSha: text('head_sha').notNull(),
    createdByReview: integer('created_by_review', { mode: 'boolean' }).notNull(),
    autoReviewedSha: text('auto_reviewed_sha'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex('review_worktrees_pr_unique').on(table.repoFullName, table.prNumber)],
);

// ── Terminal Sessions ───────────────────────────────────────────────

// Mirror of the in-memory terminalSessionMeta map (web/src/server/trpc/context.ts)
// so terminal sessions survive a server restart. The meta blob is owned and
// typed by the WS layer.
export const terminalSessions = sqliteTable('terminal_sessions', {
  // Natural text PK (browser-generated session UUID) instead of the usual
  // integer autoincrement id: this mirror table is only ever keyed by
  // sessionId and nothing references it, so a surrogate id would add nothing.
  sessionId: text('session_id').primaryKey(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── Terminal Session History ────────────────────────────────────────────────

// Permanent log of agent terminal sessions for the "resume" feature. One row
// per agent-CLI conversation thread (keyed by agent session id or resumedFrom).
// Rows survive session closure and are capped at 50 per workspace bucket.
export const terminalSessionHistory = sqliteTable(
  'terminal_session_history',
  {
    sessionId: text('session_id').primaryKey(),
    agentType: text('agent_type').notNull(),
    workingDir: text('working_dir').notNull(),
    scopeLabel: text('scope_label').notNull(),
    summary: text('summary').notNull(),
    workspaceSlug: text('workspace_slug'),
    projectSlug: text('project_slug'),
    worktreeBranch: text('worktree_branch'),
    containerMode: text('container_mode'),
    startedAt: text('started_at').notNull(),
    closedAt: text('closed_at'),
  },
  (table) => [index('idx_tsh_workspace_started').on(table.workspaceSlug, table.startedAt)],
);

// ── Usage Analytics ─────────────────────────────────────────────────

// Scan bookkeeping: one row per transcript file on disk, mirroring
// the daemon's `UsageScanFileState` wire type 1:1 so `refresh()` can hand the
// whole map back as `knownFiles` on the next scan without translation.
export const usageScanFile = sqliteTable('usage_scan_file', {
  path: text('path').primaryKey(),
  sizeBytes: integer('size_bytes').notNull(),
  mtimeMs: integer('mtime_ms').notNull(),
  firstLineDate: text('first_line_date'),
  lastLineDate: text('last_line_date'),
  lastScanAt: text('last_scan_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const usageSession = sqliteTable(
  'usage_session',
  {
    sessionId: text('session_id').primaryKey(),
    slug: text('slug').notNull(),
    cwd: text('cwd'),
    gitBranch: text('git_branch'),
    repoRoot: text('repo_root'),
    // A subagent row's sessionId is its agent id; parentSessionId is the
    // spawning session. From `agent-<id>.jsonl` + its `.meta.json` sidecar.
    parentSessionId: text('parent_session_id'),
    isSubagent: integer('is_subagent', { mode: 'boolean' }).notNull().default(false),
    agentType: text('agent_type'),
    agentDescription: text('agent_description'),
    engyWorkspaceId: integer('engy_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    engyProjectId: integer('engy_project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    model: text('model').notNull(),
    startedAt: text('started_at'),
    // Local calendar date the daemon's machine saw the session start on
    // (YYYY-MM-DD). `startedAt` is UTC, so filtering by it alone can bucket a
    // session under the wrong day whenever local time and UTC disagree.
    startedDate: text('started_date'),
    endedAt: text('ended_at'),
    apiCalls: integer('api_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    thinkingTokens: integer('thinking_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWrite1hTokens: integer('cache_write_1h_tokens').notNull().default(0),
    cacheWrite5mTokens: integer('cache_write_5m_tokens').notNull().default(0),
    webSearchRequests: integer('web_search_requests').notNull().default(0),
    webFetchRequests: integer('web_fetch_requests').notNull().default(0),
    estCostCents: integer('est_cost_cents').notNull().default(0),
    // Enrichment from ~/.claude/usage-data/session-meta/<session>.json — best-effort, may be absent.
    firstPrompt: text('first_prompt'),
    durationMinutes: real('duration_minutes'),
    linesAdded: integer('lines_added'),
    linesRemoved: integer('lines_removed'),
    filesModified: integer('files_modified'),
    gitCommits: integer('git_commits'),
    toolErrors: integer('tool_errors'),
    // Auto-compaction events — attribution caps at each boundary, so this is
    // what explains a session's cost shape not otherwise visible in the totals.
    compactions: integer('compactions').notNull().default(0),
    baseContextTokens: integer('base_context_tokens').notNull().default(0),
  },
  (table) => [
    index('idx_usage_session_slug').on(table.slug),
    index('idx_usage_session_repo_root').on(table.repoRoot),
    index('idx_usage_session_workspace').on(table.engyWorkspaceId),
    index('idx_usage_session_project').on(table.engyProjectId),
    index('idx_usage_session_parent').on(table.parentSessionId),
  ],
);

export const usageSessionRelations = relations(usageSession, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [usageSession.engyWorkspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [usageSession.engyProjectId],
    references: [projects.id],
  }),
}));

// Time series, pre-bucketed for charts. `date` leads the key because a session
// can cross midnight — bucketing by the call's own timestamp keeps every
// date-range query exact at the edges. `sessionId` is part of the key too:
// without it, rows from every session sharing a date/slug/model collide, and a
// rescan could not replace one session's rows without corrupting its
// neighbours. Readers sum across sessions.
export const usageSessionDaily = sqliteTable(
  'usage_session_daily',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    slug: text('slug').notNull(),
    model: text('model').notNull(),
    // Split out so overview can report subagent spend as its own share
    // without losing per-day accuracy to a session-level (midnight-crossing)
    // approximation — totals simply sum across both values.
    isSubagent: integer('is_subagent', { mode: 'boolean' }).notNull().default(false),
    apiCalls: integer('api_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    thinkingTokens: integer('thinking_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWrite1hTokens: integer('cache_write_1h_tokens').notNull().default(0),
    cacheWrite5mTokens: integer('cache_write_5m_tokens').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.model] }),
    index('idx_usage_session_daily_date').on(table.date),
    index('idx_usage_session_daily_session').on(table.sessionId),
  ],
);

// Per-tool rollup — the "what's burning it" table.
export const usageTool = sqliteTable(
  'usage_tool',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    toolName: text('tool_name').notNull(),
    calls: integer('calls').notNull().default(0),
    resultChars: integer('result_chars').notNull().default(0),
    resultTokensEst: integer('result_tokens_est').notNull().default(0),
    inputChars: integer('input_chars').notNull().default(0),
    attributedTokenTurns: integer('attributed_token_turns').notNull().default(0),
    // Micro-cents, not cents — rounding every row here and summing the rounded
    // values at query time zeroes most sub-cent rows (thousands of them).
    // Round once, in the router, after summing.
    attributedCostMicroCents: integer('attributed_cost_micro_cents').notNull().default(0),
    p50ResultChars: integer('p50_result_chars').notNull().default(0),
    p95ResultChars: integer('p95_result_chars').notNull().default(0),
    maxResultChars: integer('max_result_chars').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    images: integer('images').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.toolName] }),
    index('idx_usage_tool_date').on(table.date),
    index('idx_usage_tool_session').on(table.sessionId),
  ],
);

// Modeled token-turns by content kind (tool result / tool input / assistant
// text / image / thinking / injected attachment). Priced directly at the
// session's cache-read rate; the shortfall against measured cost is the
// unattributable per-call baseline.
export const usageCause = sqliteTable(
  'usage_cause',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    kind: text('kind', {
      enum: ['toolResult', 'toolInput', 'text', 'image', 'thinking', 'attachment'],
    }).notNull(),
    tokenTurns: integer('token_turns').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.kind] }),
    index('idx_usage_cause_date').on(table.date),
    index('idx_usage_cause_session').on(table.sessionId),
  ],
);

// Per-call cache-read size within one session, in call order — feeds the
// session drill-down's context-growth timeline. Scoped to a single session
// at read time, never a date range, so it carries no `date` column.
export const usageCall = sqliteTable(
  'usage_call',
  {
    sessionId: text('session_id').notNull(),
    callIndex: integer('call_index').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.callIndex] })],
);

// Cost by tool input field (`Agent.prompt`, `Bash.command`, ...) — what the
// model *writes* into context, not just what it reads back.
export const usageField = sqliteTable(
  'usage_field',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    tool: text('tool').notNull(),
    field: text('field').notNull(),
    calls: integer('calls').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    tokenTurns: integer('token_turns').notNull().default(0),
    // Micro-cents — see usageTool.attributedCostMicroCents for why.
    attributedCostMicroCents: integer('attributed_cost_micro_cents').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.tool, table.field] }),
    index('idx_usage_field_date').on(table.date),
    index('idx_usage_field_session').on(table.sessionId),
  ],
);

// Per-file-path rollup — "which files am I paying to re-read".
export const usageFile = sqliteTable(
  'usage_file',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    filePath: text('file_path').notNull(),
    tool: text('tool').notNull(),
    reads: integer('reads').notNull().default(0),
    edits: integer('edits').notNull().default(0),
    writes: integer('writes').notNull().default(0),
    totalChars: integer('total_chars').notNull().default(0),
    tokensEst: integer('tokens_est').notNull().default(0),
    attributedTokenTurns: integer('attributed_token_turns').notNull().default(0),
    // Micro-cents — see usageTool.attributedCostMicroCents for why.
    attributedCostMicroCents: integer('attributed_cost_micro_cents').notNull().default(0),
    ext: text('ext').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.filePath] }),
    index('idx_usage_file_date').on(table.date),
    index('idx_usage_file_session').on(table.sessionId),
  ],
);

// Injected context items (`attachment` transcript entries), keyed by the
// attachment type and a label: file path, hook name, or '' for a kind with no item.
export const usageContextItem = sqliteTable(
  'usage_context_item',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull(),
    label: text('label').notNull().default(''),
    count: integer('count').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    tokenTurns: integer('token_turns').notNull().default(0),
    // Micro-cents — see usageTool.attributedCostMicroCents for why.
    attributedCostMicroCents: integer('attributed_cost_micro_cents').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.kind, table.label] }),
    index('idx_usage_context_item_date').on(table.date),
    index('idx_usage_context_item_session').on(table.sessionId),
  ],
);

// Single most expensive tool calls — payload size × later-calls-in-session ×
// rate, one row per call. The reducer keeps only the top 20 of each session.
// `field` is the input field the preview was drawn from (null when the call
// carried no input).
export const usageExpensiveCall = sqliteTable(
  'usage_expensive_call',
  {
    date: text('date').notNull(),
    sessionId: text('session_id').notNull(),
    callIndex: integer('call_index').notNull(),
    tool: text('tool').notNull(),
    field: text('field'),
    tokens: integer('tokens').notNull().default(0),
    tokenTurns: integer('token_turns').notNull().default(0),
    // Micro-cents — see usageTool.attributedCostMicroCents for why.
    attributedCostMicroCents: integer('attributed_cost_micro_cents').notNull().default(0),
    preview: text('preview').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.sessionId, table.callIndex] }),
    index('idx_usage_expensive_call_date').on(table.date),
    index('idx_usage_expensive_call_session').on(table.sessionId),
  ],
);

// A `reducerVersion` change makes the next refresh re-read every transcript on disk.
export const usageSealedDate = sqliteTable('usage_sealed_date', {
  date: text('date').primaryKey(),
  sealedAt: text('sealed_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  reducerVersion: integer('reducer_version').notNull().default(1),
});

// Seeded but editable — a rate change is a row update, not a deploy. Rates
// are stored as micro-cents per token (1 cent = 1,000,000 micro-cents) so
// every column is an exact integer: micro-cents/token = $-per-MTok × 100.
export const usagePricing = sqliteTable('usage_pricing', {
  model: text('model').primaryKey(),
  inputMicroCentsPerToken: integer('input_micro_cents_per_token').notNull(),
  outputMicroCentsPerToken: integer('output_micro_cents_per_token').notNull(),
  cacheWrite1hMicroCentsPerToken: integer('cache_write_1h_micro_cents_per_token').notNull(),
  cacheWrite5mMicroCentsPerToken: integer('cache_write_5m_micro_cents_per_token').notNull(),
  cacheReadMicroCentsPerToken: integer('cache_read_micro_cents_per_token').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── PR Inbox ────────────────────────────────────────────────────────

export const INBOX_EVENT_KINDS = [
  'review_requested',
  'mentioned',
  'commented',
  'approved',
  'changes_requested',
  'reviewed',
  'ci_failed',
  'ci_passed',
  'auto_fix_attention',
  'merged',
  'closed',
  'reopened',
  'pushed',
  'assigned',
] as const;

export const inboxItems = sqliteTable(
  'inbox_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoFullName: text('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    githubThreadId: text('github_thread_id'),
    workspaceId: integer('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    repoPath: text('repo_path'),
    title: text('title').notNull(),
    url: text('url').notNull(),
    latestReason: text('latest_reason', { enum: INBOX_EVENT_KINDS }),
    bucket: text('bucket', { enum: ['priority', 'other'] })
      .notNull()
      .default('other'),
    unread: integer('unread', { mode: 'boolean' }).notNull().default(true),
    lastEventAt: text('last_event_at').notNull(),
    lastReadAt: text('last_read_at'),
    snoozedUntil: text('snoozed_until'),
    doneAt: text('done_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('uq_inbox_items_repo_pr').on(table.repoFullName, table.prNumber),
    index('idx_inbox_items_workspace').on(table.workspaceId),
    index('idx_inbox_items_done_at').on(table.doneAt),
  ],
);

export const inboxEvents = sqliteTable(
  'inbox_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INBOX_EVENT_KINDS }).notNull(),
    actor: text('actor'),
    summary: text('summary').notNull(),
    url: text('url'),
    at: text('at').notNull(),
    sourceKey: text('source_key').notNull(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('uq_inbox_events_source_key').on(table.sourceKey),
    index('idx_inbox_events_item_at').on(table.itemId, table.at),
  ],
);
