'use client';

import { RiInformationLine } from '@remixicon/react';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PanelProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Panel({ title, description, action, children }: PanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EstimateNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
      <span>
        All dollar figures are <strong className="font-medium">estimated, at API list rates</strong>
        . Subscription billing is not per-token, so these measure consumption, not an invoice.
        {children}
      </span>
    </p>
  );
}
