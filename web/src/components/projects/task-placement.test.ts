import { describe, it, expect } from 'vitest';
import { groupChoices, placeInGroup, placeInMilestone } from './task-placement';

const groups = [
  { id: 1, milestoneRef: 'm1' },
  { id: 2, milestoneRef: 'm2' },
  { id: 3, milestoneRef: null },
];

describe('task placement', () => {
  describe('groupChoices', () => {
    it('[FR-TASK-220] should list only the groups of the chosen milestone', () => {
      const placement = { milestoneRef: 'm1', taskGroupId: null };

      expect(groupChoices(groups, placement).map((g) => g.id)).toEqual([1]);
    });

    it('[FR-TASK-220] should list every group when no milestone is chosen', () => {
      expect(groupChoices(groups, { milestoneRef: null, taskGroupId: null })).toEqual(groups);
    });

    it('[FR-TASK-220] should keep the current group listed when it sits in another milestone', () => {
      const placement = { milestoneRef: 'm1', taskGroupId: 2 };

      expect(groupChoices(groups, placement).map((g) => g.id)).toEqual([1, 2]);
    });
  });

  describe('placeInMilestone', () => {
    it('[FR-TASK-220] should keep the group when it belongs to the new milestone', () => {
      const placement = { milestoneRef: null, taskGroupId: 1 };

      expect(placeInMilestone(placement, 'm1', groups)).toEqual({
        milestoneRef: 'm1',
        taskGroupId: 1,
      });
    });

    it('[FR-TASK-220] should clear the group when it belongs to another milestone', () => {
      const placement = { milestoneRef: 'm1', taskGroupId: 1 };

      expect(placeInMilestone(placement, 'm2', groups)).toEqual({
        milestoneRef: 'm2',
        taskGroupId: null,
      });
    });

    it('[FR-TASK-220] should keep a standalone group when the milestone is cleared', () => {
      const placement = { milestoneRef: 'm1', taskGroupId: 3 };

      expect(placeInMilestone(placement, null, groups)).toEqual({
        milestoneRef: null,
        taskGroupId: 3,
      });
    });
  });

  describe('placeInGroup', () => {
    it('[FR-TASK-220] should move the task into the milestone of the chosen group', () => {
      const placement = { milestoneRef: null, taskGroupId: null };

      expect(placeInGroup(placement, 2, groups)).toEqual({ milestoneRef: 'm2', taskGroupId: 2 });
    });

    it('[FR-TASK-220] should keep the milestone when the group is cleared', () => {
      const placement = { milestoneRef: 'm1', taskGroupId: 1 };

      expect(placeInGroup(placement, null, groups)).toEqual({
        milestoneRef: 'm1',
        taskGroupId: null,
      });
    });
  });
});
