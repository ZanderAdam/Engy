import type { IPty } from 'node-pty';
import type { Terminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';

export type SessionState = 'active' | 'suspended';

export interface PersistentSession {
  ptyProcess: IPty;
  sessionId: string;
  workingDir: string;
  command?: string;
  state: SessionState;
  screen: Terminal;
  serializeAddon: SerializeAddon;
  lastActivity: number;
  suspendedAt?: number;
  initialCommandSent: boolean;
}
