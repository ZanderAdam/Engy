import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ── Workspaces ──────────────────────────────────────────────────────

export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  repos: text('repos', { mode: 'json' }).$type<string[]>().default([]),
  docsDir: text('docs_dir'),
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
  specPath: text('spec_path'),
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
  milestones: many(milestones),
  tasks: many(tasks),
}));

// ── Milestones ──────────────────────────────────────────────────────

export const milestones = sqliteTable('milestones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status', {
    enum: ['planned', 'planning', 'active', 'complete'],
  })
    .notNull()
    .default('planned'),
  scope: text('scope'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const milestonesRelations = relations(milestones, ({ one, many }) => ({
  project: one(projects, {
    fields: [milestones.projectId],
    references: [projects.id],
  }),
  taskGroups: many(taskGroups),
  tasks: many(tasks),
}));

// ── Task Groups ─────────────────────────────────────────────────────

export const taskGroups = sqliteTable('task_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  milestoneId: integer('milestone_id')
    .notNull()
    .references(() => milestones.id, { onDelete: 'cascade' }),
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

export const taskGroupsRelations = relations(taskGroups, ({ one, many }) => ({
  milestone: one(milestones, {
    fields: [taskGroups.milestoneId],
    references: [milestones.id],
  }),
  tasks: many(tasks),
  agentSessions: many(agentSessions),
}));

// ── Tasks ───────────────────────────────────────────────────────────

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  milestoneId: integer('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
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
  dependencies: text('dependencies', { mode: 'json' }).$type<number[]>().default([]),
  specId: text('spec_id'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  milestone: one(milestones, {
    fields: [tasks.milestoneId],
    references: [milestones.id],
  }),
  taskGroup: one(taskGroups, {
    fields: [tasks.taskGroupId],
    references: [taskGroups.id],
  }),
}));

// ── Agent Sessions ──────────────────────────────────────────────────

export const agentSessions = sqliteTable('agent_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().unique(),
  taskGroupId: integer('task_group_id').references(() => taskGroups.id, { onDelete: 'set null' }),
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status', {
    enum: ['active', 'paused', 'stopped', 'completed'],
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

// ── Plan Content ────────────────────────────────────────────────────

export const planContent = sqliteTable('plan_content', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  milestoneId: integer('milestone_id').references(() => milestones.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const planContentRelations = relations(planContent, ({ one }) => ({
  milestone: one(milestones, {
    fields: [planContent.milestoneId],
    references: [milestones.id],
  }),
  task: one(tasks, {
    fields: [planContent.taskId],
    references: [tasks.id],
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
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
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
