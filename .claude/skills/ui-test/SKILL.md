---
name: ui-test
description: "This skill should be used after any UI change and before a commit that touches pages, components or dialogs, and when the user asks to 'test the UI', 'validate the UX', 'check the DX', 'run a UX pass', 'test it in the browser', 'playwright check', or 'run user personas'. Drives a fresh dev instance with playwright-cli through tester subagents that act as real users, checks the change works, finds UX and DX problems, and files what is out of scope as tasks. Use it even when the change looks small and the user did not ask for UX feedback."
---

# UI Test

Prove a UI change works in a real browser, and find what a real user or developer would trip on.

Unit tests prove the code does what the author planned. This skill checks that the plan makes sense from the outside: the fix is visible, errors tell the user what to do, and the next step is easy to find.

## Pick a mode

| Mode | When | Testers |
|---|---|---|
| **Change check** (default) | Any UI change, before commit | 1 tester, on the changed surfaces and the flows next to them |
| **Full sweep** | The user asks for "full", "all surfaces", "UX validation", or a release check | The 6 personas in `references/personas.md`, then a second pass for what they missed |

Do not run a full sweep unless the user asks. It costs a lot of tokens and takes about an hour.

## Workflow

### 1. Define the scope

Change check: read the diff, map each changed file to its route or surface, then find the FRs for those areas with `trace` or `search`. Write down 3 to 8 acceptance checks in the form "do X, see Y". Add the task or plan text if there is one.

Full sweep: read the area list in `references/personas.md`. Get the open tasks with `listTasks`, so that testers do not report known items.

Read the FRs in both modes. They state what is intended. A tester who does not know the design reports intended behaviour as a bug, and the user must then correct it.

### 2. Start a fresh instance

Test the code in the checkout that holds the change. For a full sweep with no change, make a new worktree from main with `EnterWorktree`.

1. If `pnpm dev` already runs for this checkout, use it. A second instance for the same checkout fails.
2. In a fresh worktree, run `pnpm install --frozen-lockfile` first. Without it, `pnpm dev` fails with `tsx: not found`.
3. Run `pnpm dev` in the background and read the port from `[dev] web + client running on http://localhost:<port>`.
4. Confirm that this instance uses `.dev-engy/`, and map the port to this checkout with `lsof`. Port 3000 with no `ENGY_DIR` override is prod. Do not test against prod, and do not use any other running instance, because tester data would stay in it.
5. A fresh `.dev-engy/` has no workspaces. Create one with `workspace.create` over tRPC, backed by a tiny git repo in the scratchpad. Seed the data each check needs, such as a project and tasks.
6. If the web server crashes or serves stale code while the daemon stays up, stop it, run `rm -rf web/.next/dev/cache`, and start it again.

### 3. Brief the testers

Build each tester prompt from `references/tester-brief.md`. Fill in every placeholder. A tester knows only what the prompt says.

- Change check: use the brief with the acceptance checks as its scope. Dispatch one `general-purpose` agent with `model: 'sonnet'`.
- Full sweep: use one brief per persona. Give each tester a separate playwright session name and findings file.

Run testers one at a time on one instance. Engy syncs its tab bar across browser sessions, so parallel testers move each other's tabs. To run in parallel, give each tester a separate worktree and instance.

Start the mobile persona last, so that the instance has content. Give each later tester the list of findings so far, so that it does not report them again.

### 4. Check the findings

Tester reports are claims. Before you act on one:

1. **Reproduce** every high finding, and any finding that you will fix now, with your own playwright session.
2. **Compare with the FRs.** If an FR states the behaviour, it is intended. Drop the finding, or report it to the user as a design question.
3. **Search for duplicates** with `search` and `listTasks`. Update an existing task when it covers the same problem.
4. **Find the cause** for high findings. Read the code, and give a `file:line`. Two symptoms often have one cause.

Severity:

- **High:** data loss, a failed main flow, or a false success.
- **Medium:** the user can finish, but only with a workaround or by guessing.
- **Low:** polish, labels, and rare edge cases.

### 5. Act on the result

Change check:

- A failed acceptance check blocks the commit. Fix it and test again.
- Fix a UX or DX problem that the change itself caused.
- File each other finding as a task with `createTask`. Do not widen the change to fix it.

Full sweep:

- Create a task group with `createTaskGroup`, then one task per finding, with the steps, expected result, actual result, severity and screenshot path.
- Give the user a ranked short list of the biggest problems, and let the user pick what to fix.

Standalone task groups are valid. Use the `projectId` of the project in the context, so that the group shows on the project pages.

### 6. Clean up

Close every playwright session, stop any agent sessions and terminals that testers started, and stop the dev server if this run started it. Delete only data that this run created. Keep the worktree if it holds the change. For a full sweep, remove the worktree with `ExitWorktree`.

If a step of this skill or its tools gave friction, file a task with the steps, the expected result and the actual result.

### 7. Report

Lead with the verdict: **PASS** or **FAIL**. Then give:

- Each acceptance check, with its result and evidence.
- Findings by severity, with task IDs.
- Console errors.
- What you could not test, and why.

Do not say PASS for a surface that nobody opened. Say that it was not tested.

## Rules for playwright-cli

- Run `pnpm exec playwright-cli -s=<session> <command>` from the checkout. The bare name is not on PATH.
- Use `open` once to start the session, then `goto` to change page. A second `open` can relaunch the browser and wipe localStorage and the viewport.
- Use a separate session name per tester, because the default session is shared. Chrome can be absent: add `--browser=chromium`, after a one-time `pnpm exec playwright-cli install-browser chromium`.
- Prefer `snapshot`, `click`, `fill`, `press`, `console` and `screenshot`. In a worktree, the Bash guard blocks `eval`, so use a snapshot or screenshot.
- Save screenshots in the scratchpad, not in the repo.

## Additional resources

- `references/tester-brief.md`: the prompt template for each tester, with the UX and DX checklist and the findings format.
- `references/personas.md`: the personas and surfaces for a full sweep.
