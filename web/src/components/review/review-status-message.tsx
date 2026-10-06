import type { ReactNode } from 'react';
import { RiAlertLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';

export function ReviewStatusMessage({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-20 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

export function ReviewErrorMessage({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <ReviewStatusMessage icon={<RiAlertLine className="size-5 text-destructive" />} title={title}>
      <p className="max-w-md break-words font-mono text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" size="xs" onClick={onRetry}>
        Retry
      </Button>
    </ReviewStatusMessage>
  );
}
