import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { workspaces } from '../db/schema.js';

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const db = getDb();
  const base = generateSlug(name);
  let slug = base;
  let counter = 2;

  while (true) {
    const existing = db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
    if (!existing) return slug;
    slug = `${base}-${counter}`;
    counter++;
  }
}
