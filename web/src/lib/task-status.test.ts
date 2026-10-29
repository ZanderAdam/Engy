import { describe, it, expect } from 'vitest';
import {
  KANBAN_LANES,
  isClosedTaskStatus,
  kanbanLaneOf,
  statusAfterLaneDrop,
  taskStatusSchema,
} from './task-status';

describe('task status', () => {
  describe('taskStatusSchema', () => {
    it("should accept 'wont_do'", () => {
      expect(taskStatusSchema.parse('wont_do')).toBe('wont_do');
    });
  });

  describe('isClosedTaskStatus', () => {
    it('should treat done and wont_do as closed', () => {
      expect(isClosedTaskStatus('done')).toBe(true);
      expect(isClosedTaskStatus('wont_do')).toBe(true);
    });

    it('should treat other statuses as open', () => {
      for (const status of ['backlog', 'todo', 'in_progress', 'review']) {
        expect(isClosedTaskStatus(status)).toBe(false);
      }
    });
  });

  describe('kanbanLaneOf', () => {
    it('[FR-TASK-250] should place wont_do tasks in the done lane', () => {
      expect(kanbanLaneOf('wont_do')).toBe('done');
    });

    it('should place other statuses in their own lane', () => {
      for (const lane of KANBAN_LANES) {
        expect(kanbanLaneOf(lane)).toBe(lane);
      }
    });

    it('[FR-TASK-250] should not have a separate wont_do lane', () => {
      expect(KANBAN_LANES).not.toContain('wont_do');
    });
  });

  describe('statusAfterLaneDrop', () => {
    it('[FR-TASK-250] should set done when a card is dropped on the Done lane', () => {
      expect(statusAfterLaneDrop('review', 'done')).toBe('done');
    });

    it('[FR-TASK-250] should keep wont_do when the card is dropped inside the Done lane', () => {
      expect(statusAfterLaneDrop('wont_do', 'done')).toBeNull();
    });

    it('should set the lane status when a wont_do card leaves the Done lane', () => {
      expect(statusAfterLaneDrop('wont_do', 'todo')).toBe('todo');
    });
  });
});
