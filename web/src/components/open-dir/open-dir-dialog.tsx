/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DirPathInput } from '@/components/dir-path-input';

interface OpenDirDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpenDirDialog({ open, onOpenChange }: OpenDirDialogProps) {
  const nav = useVirtualNavigate();
  const [inputValue, setInputValue] = useState('');
  const seededRef = useRef(false);

  const { data: homeData } = trpc.file.home.useQuery(undefined, { enabled: open, retry: false });

  useEffect(() => {
    if (!open) {
      setInputValue('');
      seededRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (open && homeData?.path && !seededRef.current) {
      seededRef.current = true;
      setInputValue(homeData.path + '/');
    }
  }, [open, homeData]);

  const openPath =
    inputValue.endsWith('/') && inputValue !== '/' ? inputValue.slice(0, -1) : inputValue;

  function handleOpen() {
    if (!openPath) return;
    onOpenChange(false);
    nav.push(`/open?path=${encodeURIComponent(openPath)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-3 p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Open Directory</DialogTitle>
        </DialogHeader>

        <DirPathInput
          value={inputValue}
          onChange={setInputValue}
          variant="inline"
          placeholder="/Users/you/docs"
          autoFocus
          onEnter={handleOpen}
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!openPath} onClick={handleOpen}>
            Open
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
