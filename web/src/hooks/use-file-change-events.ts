'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';

interface FileChangeMessage {
  type: 'FILE_CHANGE';
  payload: {
    workspaceSlug: string;
    path: string;
    eventType: 'add' | 'change' | 'unlink';
  };
}

export function useFileChangeEvents(workspaceSlug: string, projectSlug: string) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let msg: FileChangeMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type !== 'FILE_CHANGE') return;
        if (msg.payload.workspaceSlug !== workspaceSlug) return;
        if (msg.payload.eventType !== 'add') return;

        const planMatch = msg.payload.path.match(/\/plans\/([^/]+)\.plan\.md$/);
        if (!planMatch) return;

        const taskSlug = planMatch[1];

        utils.project.getBySlug.invalidate();

        toast(`Plan ready for ${taskSlug}`, {
          action: {
            label: 'Review',
            onClick: () => {
              router.push(
                `/w/${workspaceSlug}/projects/${projectSlug}/docs?file=plans/${taskSlug}.plan.md`,
              );
            },
          },
        });
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [workspaceSlug, projectSlug, utils, router]);
}
