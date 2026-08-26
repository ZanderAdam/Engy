import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workspaces } from '../db/schema';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { createVoiceWebSocketServer, isVoiceEnabledForWorkspace } from './voice-server';

describe('voice opt-in gate', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function createWorkspace(slug: string, voiceEnabled?: boolean) {
    ctx.db
      .insert(workspaces)
      .values({ name: slug, slug, ...(voiceEnabled === undefined ? {} : { voiceEnabled }) })
      .run();
  }

  describe('isVoiceEnabledForWorkspace', () => {
    it('[FR-TG1.7] should deny a workspace that never opted in', () => {
      createWorkspace('quiet');
      expect(isVoiceEnabledForWorkspace('quiet')).toBe(false);
    });

    it('[FR-TG1.9] should deny a workspace that opted out', () => {
      createWorkspace('quiet', false);
      expect(isVoiceEnabledForWorkspace('quiet')).toBe(false);
    });

    it('[FR-TG1.9] should allow a workspace that opted in', () => {
      createWorkspace('loud', true);
      expect(isVoiceEnabledForWorkspace('loud')).toBe(true);
    });

    it('[FR-TG1.9] should deny an unknown slug', () => {
      expect(isVoiceEnabledForWorkspace('no-such-workspace')).toBe(false);
    });

    it('[FR-TG1.9] should deny a missing slug', () => {
      expect(isVoiceEnabledForWorkspace(null)).toBe(false);
      expect(isVoiceEnabledForWorkspace(undefined)).toBe(false);
      expect(isVoiceEnabledForWorkspace('')).toBe(false);
    });
  });

  describe('server construction', () => {
    it('[FR-TG1.7] should not fetch or write any model asset', () => {
      createWorkspace('quiet');
      const wss = createVoiceWebSocketServer();
      expect(fs.existsSync(path.join(ctx.tmpDir, 'models'))).toBe(false);
      wss.close();
    });
  });
});
