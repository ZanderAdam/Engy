'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      toastOptions={{
        classNames: {
          toast:
            'bg-zinc-900 border-zinc-800 text-zinc-100 rounded-none shadow-lg',
          description: 'text-zinc-400',
          actionButton: 'bg-zinc-100 text-zinc-900 rounded-none',
          cancelButton: 'bg-zinc-800 text-zinc-400 rounded-none',
        },
      }}
    />
  );
}
