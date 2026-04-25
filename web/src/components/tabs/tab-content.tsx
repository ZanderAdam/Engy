'use client';

import { memo } from 'react';
import { parseVirtualPath } from './tab-state';

import HomePage from '@/app/page';
import OpenPage from '@/app/open/page';
import WorkspaceLayout from '@/app/w/[workspace]/layout';
import WorkspacePage from '@/app/w/[workspace]/page';
import WorkspaceTasksPage from '@/app/w/[workspace]/tasks/page';
import WorkspaceDocsPage from '@/app/w/[workspace]/docs/page';
import WorkspaceMemoryPage from '@/app/w/[workspace]/memory/page';
import WorkspaceSpecsPage from '@/app/w/[workspace]/specs/page';
import ProjectLayout from '@/app/w/[workspace]/projects/[project]/layout';
import ProjectPage from '@/app/w/[workspace]/projects/[project]/page';
import ProjectTasksPage from '@/app/w/[workspace]/projects/[project]/tasks/page';
import ProjectDocsPage from '@/app/w/[workspace]/projects/[project]/docs/page';
import ProjectDiffsPage from '@/app/w/[workspace]/projects/[project]/diffs/page';
import ProjectCodePage from '@/app/w/[workspace]/projects/[project]/code/page';
import ProjectClaudePlansPage from '@/app/w/[workspace]/projects/[project]/claude-plans/page';

function NotFound({ path }: { path: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      No view for {path}
    </div>
  );
}

function dispatchProject(section: string | undefined): React.ReactNode {
  switch (section) {
    case undefined:
      return <ProjectPage />;
    case 'tasks':
      return <ProjectTasksPage />;
    case 'docs':
      return <ProjectDocsPage />;
    case 'diffs':
      return <ProjectDiffsPage />;
    case 'code':
      return <ProjectCodePage />;
    case 'claude-plans':
      return <ProjectClaudePlansPage />;
    default:
      return <NotFound path={`project/${section}`} />;
  }
}

function dispatchWorkspace(section: string | undefined): React.ReactNode {
  switch (section) {
    case undefined:
      return <WorkspacePage />;
    case 'tasks':
      return <WorkspaceTasksPage />;
    case 'docs':
      return <WorkspaceDocsPage />;
    case 'memory':
      return <WorkspaceMemoryPage />;
    case 'specs':
      return <WorkspaceSpecsPage />;
    default:
      return <NotFound path={`workspace/${section}`} />;
  }
}

export const TabContent = memo(function TabContent({ virtualPath }: { virtualPath: string }) {
  const path = virtualPath.split('?')[0];

  if (path.startsWith('/open')) return <OpenPage />;
  if (path === '/' || path === '') return <HomePage />;

  const { workspace, project, section } = parseVirtualPath(virtualPath);
  if (!workspace) return <HomePage />;

  if (project) {
    return (
      <WorkspaceLayout>
        <ProjectLayout>{dispatchProject(section)}</ProjectLayout>
      </WorkspaceLayout>
    );
  }

  return <WorkspaceLayout>{dispatchWorkspace(section)}</WorkspaceLayout>;
});
