'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getSnoozeOptions, parseCustomSnooze } from './snooze-times';

interface SnoozeMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: Date) => void;
}

function SnoozeForm({ onSnooze }: Pick<SnoozeMenuProps, 'onSnooze'>) {
  const [custom, setCustom] = useState('');
  const now = new Date();
  const customUntil = parseCustomSnooze(custom, now);

  return (
    <div className="flex flex-col gap-2">
      {getSnoozeOptions(now).map((option) => (
        <Button
          key={option.id}
          variant="outline"
          className="justify-between"
          onClick={() => onSnooze(option.until)}
        >
          {option.label}
        </Button>
      ))}
      <div className="flex items-center gap-2">
        <Input
          type="datetime-local"
          aria-label="Custom snooze date and time"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <Button disabled={!customUntil} onClick={() => customUntil && onSnooze(customUntil)}>
          Snooze
        </Button>
      </div>
    </div>
  );
}

export function SnoozeMenu({ open, onOpenChange, onSnooze }: SnoozeMenuProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Snooze until</DialogTitle>
          <DialogDescription>The item returns to the inbox at that time.</DialogDescription>
        </DialogHeader>
        <SnoozeForm onSnooze={onSnooze} />
      </DialogContent>
    </Dialog>
  );
}
