// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BulkActionBar } from './bulk-action-bar';

const noop = () => {};

function render(overrides: Partial<Parameters<typeof BulkActionBar>[0]>) {
  return renderToStaticMarkup(
    createElement(BulkActionBar, {
      selectedCount: 1,
      allVisibleSelected: false,
      canCopy: true,
      canChangeStatus: true,
      canImplement: true,
      missingPlanSlugs: '',
      onSelectAll: noop,
      onGroup: noop,
      onMilestone: noop,
      onDelete: noop,
      onExecute: noop,
      onCopyIds: noop,
      onChangeStatus: noop,
      onImplement: noop,
      onCancel: noop,
      ...overrides,
    }),
  );
}

function buttonFor(html: string, label: string): string {
  const button = html.match(new RegExp(`<button(?:(?!</button>).)*${label}.*?</button>`))?.[0];
  if (!button) throw new Error(`No button labelled ${label}`);
  return button;
}

describe('BulkActionBar', () => {
  describe('plan gate', () => {
    it('[FR-TASK-310] should disable Implement and name the blocking tasks', () => {
      const html = render({ canImplement: false, missingPlanSlugs: 'engy-T1, engy-T2' });
      expect(buttonFor(html, 'Implement in terminal')).toContain(' disabled=""');
      expect(html).toContain('Needs a plan first: engy-T1, engy-T2');
    });
  });

  describe('status menu', () => {
    it('[FR-TASK-320] should enable Status when selected tasks are visible', () => {
      expect(buttonFor(render({}), 'Status')).not.toContain(' disabled=""');
    });

    it('[FR-TASK-320] should disable Status when no selected task is visible', () => {
      expect(buttonFor(render({ canChangeStatus: false }), 'Status')).toContain(' disabled=""');
    });
  });

  describe('select all', () => {
    it('[FR-TASK-280] should offer Deselect All once every visible task is selected', () => {
      expect(render({ allVisibleSelected: true })).toContain('Deselect All');
    });
  });
});
