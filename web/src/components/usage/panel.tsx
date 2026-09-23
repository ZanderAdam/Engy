'use client';

import { RiInformationLine } from '@remixicon/react';
import { useState } from 'react';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PanelProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Panel({ title, action, children }: PanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

interface PanelTab {
  value: string;
  label: string;
  action?: React.ReactNode;
  content: React.ReactNode;
}

export function TabbedPanel({ tabs }: { tabs: PanelTab[] }) {
  const [active, setActive] = useState(tabs[0].value);
  const action = tabs.find((tab) => tab.value === active)?.action;

  return (
    <Card>
      <Tabs value={active} onValueChange={setActive}>
        <CardHeader>
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
        <CardContent>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </CardContent>
      </Tabs>
    </Card>
  );
}

export function EstimateNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <RiInformationLine className="mt-0.5 size-3.5 shrink-0" />
      <span>
        All dollar figures are{' '}
        <strong className="font-medium">estimated costs at API list prices</strong>. Subscription
        billing does not charge per token. These numbers show usage, not an invoice.
        {children}
      </span>
    </p>
  );
}
