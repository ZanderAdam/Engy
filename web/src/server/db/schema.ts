import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

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
  containerEnabled: integer('container_enabled', { mode: 'boolean' }).default(false),
  containerConfig: text('container_config', { mode: 'json' }).$type<ContainerConfig>(),
  executionBackend: text('execution_backend', { enum: ['devcontainer', 'coder'] }).default('devcontainer'),
  coderConfig: text('coder_config', { mode: 'json' }).$type<CoderConfig>(),
  maxConcurrency: integer('max_concurrency').default(1),
  remoteEnabled: integer('remote_enabled', { mode: 'boolean' }).default(false),
  autoStart: integer('auto_start', { mode: 'boolean' }).default(false),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  projects: many(projects),
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
  milestoneRef: text('milestone_ref'),
  name: text('name').notNull(),
  status: text('status', {
    enum: ['planned', 'active', 'review', 'complete'],
  })
    .notNull()
    .default('planned'),
  repos: text('repos', { mode: 'json' }).$type<string[]>(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const taskGroupsRelations = relations(taskGroups, ({ many }) => ({
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
    enum: ['todo', 'in_progress', 'review', 'done'],
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
    enum: ['planning', 'implementing', 'blocked', 'failed'],
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

export const taskDependencies = sqliteTable('task_dependencies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  blockerTaskId: integer('blocker_task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('task_dep_unique').on(table.taskId, table.blockerTaskId),
]);

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
  taskId: integer('task_id').references(() => tasks.id),
  executionMode: text('execution_mode', {
    enum: ['group', 'task', 'milestone'],
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

// ── Fleeting Memories ───────────────────────────────────────────────

export const fleetingMemories = sqliteTable('fleeting_memories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
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
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const fleetingMemoriesRelations = relations(fleetingMemories, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [fleetingMemories.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [fleetingMemories.projectId],
    references: [projects.id],
  }),
}));

// ── Project Memories ────────────────────────────────────────────────

export const projectMemories = sqliteTable('project_memories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  type: text('type', {
    enum: ['decision', 'fact', 'procedure', 'insight', 'preference'],
  }).notNull(),
  confidence: real('confidence').default(1.0),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const projectMemoriesRelations = relations(projectMemories, ({ one }) => ({
  project: one(projects, {
    fields: [projectMemories.projectId],
    references: [projects.id],
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
