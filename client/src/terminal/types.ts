import type { IPty } from 'node-pty';
import type { CircularBuffer } from './circular-buffer.js';

export type SessionState = 'active' | 'suspended';

export interface PersistentSession {
  ptyProcess: IPty;
  sessionId: string;
  workingDir: string;
  command?: string;
  state: SessionState;
  outputBuffer: CircularBuffer;
  lastActivity: number;
  suspendedAt?: number;
  initialCommandSent: boolean;
}
