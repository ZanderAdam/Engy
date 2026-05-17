# Components

Feature components for the Next.js 16 + React 19 frontend. See `../../CLAUDE.md` for the UI stack overview.

`ui/` holds shadcn primitives and has its own rules — see `./ui/CLAUDE.md`.

## Conventions

- All interactive components are `"use client"`. Server Components are the exception — opt in only when there's a measurable reason and no client hooks.
- Class composition: `cn()` from `@/lib/utils`. Tailwind v4 syntax; no `tailwind.config.js`-style theme extension here.
- Dark mode only — `<html className="dark">` is fixed. Use the dark palette directly; don't write `dark:` variants.
- Icons: both `lucide-react` and `@remixicon/react` are in use. Match the icon set already used in the file/feature you're editing rather than introducing a new one.
- Toasts: `sonner` (mounted via `ui/sonner.tsx`).

## Data layer

- tRPC via `trpc` from `@/lib/trpc` (TanStack Query v5 underneath). Default `staleTime: 30s`, `retry: 1`, no refetch on focus (see `providers.tsx`).
- Mutations should call `utils.<router>.<proc>.invalidate()` for affected queries, OR subscribe to the relevant broadcast (see below). Don't manually `setQueryData` unless invalidation is too coarse.

## Real-time updates

- **Don't open WebSockets from components.** Subscribe via `useFileChangeContext()` (`@/contexts/file-change-context`) for FS events, or the equivalent context for task/question/terminal-session events.
- New broadcast types: add the event in `server/ws/broadcast.ts`, then surface it via a new context (or extend an existing one). Components consume only contexts.

## Layout & structure

- Three-panel resizable layout lives in `layout/`. Don't duplicate panel logic in features — compose.
- Terminal infrastructure (`terminal/`), diff viewer (`diff/`), BlockNote editor (`editor/`), kanban/eisenhower views (`projects/task-views/`) are feature islands — keep their internal state local, expose minimal props.
- `providers.tsx` is the top-level wiring (ThemeProvider + trpc.Provider + QueryClientProvider). Don't add app state here — use a dedicated context in `@/contexts/`.

## Tests

- Component tests are colocated (`foo.tsx` → `foo.test.ts(x)`). Prefer testing hooks and pure helpers; full DOM tests via `jsdom` are fine but should target behavior, not class names.
- No mocks for the DB — components don't talk to the DB directly anyway. Mock the tRPC layer at the call site when needed.
