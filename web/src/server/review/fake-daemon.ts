import WebSocket from 'ws';
import type { AppState } from '../trpc/context';

interface FakeWorktree {
  branch: string | null;
  dirty: boolean;
  head: string;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
}

export interface FakeDaemon {
  calls: string[];
  worktrees: Map<string, FakeWorktree>;
  refs: Map<string, string>;
  remoteHeads: Map<number, string>;
  failures: Set<string>;
}

interface Message {
  type: string;
  payload: Record<string, unknown> & { requestId: string };
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

export function installFakeDaemon(state: AppState): FakeDaemon {
  const daemon: FakeDaemon = {
    calls: [],
    worktrees: new Map(),
    refs: new Map(),
    remoteHeads: new Map(),
    failures: new Set(),
  };

  function answer(pendingMap: Map<string, Pending>, msg: Message, compute: () => unknown): void {
    const pending = pendingMap.get(msg.payload.requestId);
    if (!pending) return;
    pendingMap.delete(msg.payload.requestId);
    try {
      if (daemon.failures.has(msg.type)) throw new Error(`${msg.type} failed`);
      pending.resolve(compute() as never);
    } catch (err) {
      pending.reject(err as Error);
    }
  }

  function requireWorktree(worktreePath: unknown): FakeWorktree {
    const worktree = daemon.worktrees.get(worktreePath as string);
    if (!worktree) throw new Error(`No worktree at ${String(worktreePath)}`);
    return worktree;
  }

  function handle(msg: Message): void {
    const { payload } = msg;
    daemon.calls.push(msg.type);
    switch (msg.type) {
      case 'GIT_REMOTE_URL_REQUEST':
        answer(state.pendingGitRemoteUrl as never, msg, () => {
          throw new Error(`${String(payload.repoDir)} is not a git repository`);
        });
        break;
      case 'GIT_FETCH_REQUEST':
        answer(state.pendingGitFetch as never, msg, () => {
          if (!payload.refspec && daemon.failures.has('GIT_FETCH_BASE')) {
            throw new Error('base fetch failed');
          }
          const number = Number(/refs\/pull\/(\d+)\/head/.exec(payload.refspec as string)?.[1]);
          const sha = daemon.remoteHeads.get(number);
          if (sha) daemon.refs.set(`refs/engy/pr/${number}`, sha);
          return { remote: 'origin' };
        });
        break;
      case 'GIT_STATUS_REQUEST':
        answer(state.pendingGitStatus as never, msg, () => {
          const worktree = requireWorktree(payload.repoDir);
          const files = worktree.dirty ? [{ path: 'a.ts', status: 'modified', staged: false }] : [];
          return { files, branch: worktree.branch ?? '', head: worktree.head };
        });
        break;
      case 'GIT_RESET_HARD_REQUEST':
        answer(state.pendingGitResetHard as never, msg, () => {
          const worktree = requireWorktree(payload.repoDir);
          if (worktree.dirty) throw codedError('dirty', 'DIRTY');
          worktree.head = daemon.refs.get(payload.ref as string) ?? worktree.head;
        });
        break;
      case 'GIT_DELETE_REFS_REQUEST':
        answer(state.pendingGitDeleteRefs as never, msg, () => {
          for (const ref of payload.refs as string[]) daemon.refs.delete(ref);
        });
        break;
      case 'GIT_WORKTREE_LIST_REQUEST':
        answer(state.pendingGitWorktreeList as never, msg, () => ({
          worktrees: [
            { path: '/repos/app', branch: 'main', isMain: true, isLocked: false },
            ...[...daemon.worktrees].map(([path, worktree]) => ({
              path,
              branch: worktree.branch,
              isMain: false,
              isLocked: false,
            })),
          ],
        }));
        break;
      case 'WORKTREE_ADD_REQUEST':
        answer(state.pendingWorktreeAdd as never, msg, () => {
          const worktreePath = payload.worktreePath as string;
          const branch = payload.branch as string;
          const head = daemon.refs.get(payload.baseRef as string);
          if (!head) throw new Error(`invalid reference: ${String(payload.baseRef)}`);
          daemon.worktrees.set(worktreePath, { branch, dirty: false, head });
          daemon.refs.set(`refs/heads/${branch}`, head);
          return { worktreePath, branch };
        });
        break;
      case 'WORKTREE_REMOVE_REQUEST':
        answer(state.pendingWorktreeRemove as never, msg, () => {
          const worktree = requireWorktree(payload.worktreePath);
          if (worktree.dirty && !payload.force) throw codedError('dirty', 'DIRTY');
          daemon.worktrees.delete(payload.worktreePath as string);
        });
        break;
    }
  }

  state.daemon = {
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: (raw: string) => {
      const msg = JSON.parse(raw) as Message;
      queueMicrotask(() => handle(msg));
    },
  } as unknown as WebSocket;

  return daemon;
}
