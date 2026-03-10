import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { dispatchFileSearch } from '../../ws/server';

const MAX_DEPTH = 5;

function validatePath(base: string, target: string): string {
  if (path.isAbsolute(target)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Absolute paths not allowed: ${target}` });
  }
  const resolved = path.resolve(base, target);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Path traversal detected: ${target}` });
  }
  return resolved;
}

function hasMdFiles(dirPath: string, depth: number): boolean {
  if (depth <= 0) return false;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) return true;
      if (entry.isDirectory() && hasMdFiles(path.join(dirPath, entry.name), depth - 1)) return true;
    }
  } catch {
    // ignore unreadable subdirs
  }
  return false;
}

function collectMarkdownFiles(
  rootDir: string,
  currentDir: string,
  depth: number,
): { path: string; mtime: number }[] {
  if (depth <= 0) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: { path: string; mtime: number }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: path.relative(rootDir, fullPath), mtime: stat.mtimeMs });
      } catch {
        // file may have been deleted between readdir and stat
      }
    } else if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(rootDir, fullPath, depth - 1));
    }
  }
  return files;
}

function listDir(dirPath: string): { dirs: string[]; files: string[] } {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Cannot read directory: ${dirPath}` });
  }

  const dirs: string[] = [];
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entry.name);
    } else if (entry.isDirectory() && hasMdFiles(path.join(dirPath, entry.name), MAX_DEPTH - 1)) {
      dirs.push(entry.name);
    }
  }

  return { dirs: dirs.sort(), files: files.sort() };
}

export const dirRouter = router({
  home: publicProcedure.query(() => ({ path: os.homedir() })),

  listDirs: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query(({ input }) => {
      try {
        const entries = fs.readdirSync(input.dirPath, { withFileTypes: true });
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => e.name)
          .sort();
        return { dirs };
      } catch {
        return { dirs: [] };
      }
    }),

  listFiles: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query(({ input }) => {
      if (!fs.existsSync(input.dirPath)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Directory not found: ${input.dirPath}` });
      }
      const stat = fs.statSync(input.dirPath);
      if (!stat.isDirectory()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a directory: ${input.dirPath}` });
      }
      const files = collectMarkdownFiles(input.dirPath, input.dirPath, MAX_DEPTH);
      return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
    }),

  list: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query(({ input }) => {
      if (!fs.existsSync(input.dirPath)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Directory not found: ${input.dirPath}` });
      }
      const stat = fs.statSync(input.dirPath);
      if (!stat.isDirectory()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a directory: ${input.dirPath}` });
      }
      return listDir(input.dirPath);
    }),

  read: publicProcedure
    .input(z.object({ dirPath: z.string().min(1), filePath: z.string().min(1) }))
    .query(({ input }) => {
      if (!input.filePath.endsWith('.md')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Only .md files are supported` });
      }
      const resolved = validatePath(input.dirPath, input.filePath);
      if (!fs.existsSync(resolved)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${input.filePath}` });
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Not a file: ${input.filePath}` });
      }
      return { content: fs.readFileSync(resolved, 'utf-8') };
    }),

  write: publicProcedure
    .input(z.object({ dirPath: z.string().min(1), filePath: z.string().min(1), content: z.string() }))
    .mutation(({ input }) => {
      if (!input.filePath.endsWith('.md')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Only .md files are supported` });
      }
      const resolved = validatePath(input.dirPath, input.filePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, input.content, 'utf-8');
      return { success: true };
    }),

  searchRepoFiles: publicProcedure
    .input(
      z.object({
        dirs: z.array(z.string().min(1)).min(1),
        query: z.string(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const results = await dispatchFileSearch(input.dirs, input.query, input.limit, ctx.state);
      return { results };
    }),
});
