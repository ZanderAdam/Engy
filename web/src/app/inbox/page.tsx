'use client';

import { EventsProvider } from '@/contexts/events-context';
import { InboxPage } from '@/components/inbox/inbox-page';

export default function InboxRoute() {
  return (
    <EventsProvider workspaceSlug="">
      <InboxPage />
    </EventsProvider>
  );
}
