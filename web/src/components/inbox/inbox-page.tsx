'use client';

import { useIsMobile } from '@/hooks/use-mobile';
import { MobileIdentityBar } from '@/components/layout/mobile-identity-bar';
import { InboxView } from './inbox-view';

export function InboxPage() {
  const isMobile = useIsMobile();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isMobile && <MobileIdentityBar />}
      <InboxView />
    </div>
  );
}
