'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { ContainerConfig } from '@/server/db/schema';

export interface ContainerSettingsData {
  containerEnabled: boolean;
  containerConfig: ContainerConfig;
  maxConcurrency: number;
  autoStart: boolean;
}

interface ContainerSettingsProps {
  initialData: ContainerSettingsData;
  onChange: (data: ContainerSettingsData) => void;
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function listToLines(items: string[] | undefined): string {
  return items?.join('\n') ?? '';
}

function envVarsToLines(envVars: Record<string, string> | undefined): string {
  if (!envVars) return '';
  return Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function linesToEnvVars(text: string): Record<string, string> | undefined {
  const lines = linesToList(text);
  if (lines.length === 0) return undefined;
  const result: Record<string, string> = {};
  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    if (key) {
      result[key] = line.slice(eqIdx + 1).trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function ContainerSettings({ initialData, onChange }: ContainerSettingsProps) {
  const [containerEnabled, setContainerEnabled] = useState(initialData.containerEnabled);
  const [autoStart, setAutoStart] = useState(initialData.autoStart);
  const [maxConcurrency, setMaxConcurrency] = useState(initialData.maxConcurrency);
  const [idleTimeout, setIdleTimeout] = useState(initialData.containerConfig?.idleTimeout ?? 30);
  const [domains, setDomains] = useState(listToLines(initialData.containerConfig?.allowedDomains));
  const [packages, setPackages] = useState(listToLines(initialData.containerConfig?.extraPackages));
  const [envVars, setEnvVars] = useState(envVarsToLines(initialData.containerConfig?.envVars));

  function emit(overrides: Partial<{
    containerEnabled: boolean;
    autoStart: boolean;
    maxConcurrency: number;
    idleTimeout: number;
    domains: string;
    packages: string;
    envVars: string;
  }>) {
    const enabled = overrides.containerEnabled ?? containerEnabled;
    const start = overrides.autoStart ?? autoStart;
    const concurrency = overrides.maxConcurrency ?? maxConcurrency;
    const timeout = overrides.idleTimeout ?? idleTimeout;
    const doms = overrides.domains ?? domains;
    const pkgs = overrides.packages ?? packages;
    const vars = overrides.envVars ?? envVars;

    onChange({
      containerEnabled: enabled,
      autoStart: start,
      maxConcurrency: concurrency,
      containerConfig: {
        allowedDomains: linesToList(doms),
        extraPackages: linesToList(pkgs),
        envVars: linesToEnvVars(vars),
        idleTimeout: timeout,
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="container-enabled">Enable container</Label>
        <Switch
          id="container-enabled"
          checked={containerEnabled}
          onCheckedChange={(checked) => {
            setContainerEnabled(checked);
            emit({ containerEnabled: checked });
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="container-auto-start">Auto start</Label>
        <Switch
          id="container-auto-start"
          checked={autoStart}
          onCheckedChange={(checked) => {
            setAutoStart(checked);
            emit({ autoStart: checked });
          }}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="container-max-concurrency">Max concurrency</Label>
          <Input
            id="container-max-concurrency"
            type="number"
            min={1}
            value={maxConcurrency}
            onChange={(e) => {
              const val = Math.max(1, parseInt(e.target.value) || 1);
              setMaxConcurrency(val);
              emit({ maxConcurrency: val });
            }}
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="container-idle-timeout">Idle timeout (min)</Label>
          <Input
            id="container-idle-timeout"
            type="number"
            min={1}
            value={idleTimeout}
            onChange={(e) => {
              const val = Math.max(1, parseInt(e.target.value) || 1);
              setIdleTimeout(val);
              emit({ idleTimeout: val });
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="container-domains">Allowed domains</Label>
        <Textarea
          id="container-domains"
          className="font-mono"
          rows={3}
          placeholder={'example.com\napi.custom.io'}
          value={domains}
          onChange={(e) => {
            setDomains(e.target.value);
            emit({ domains: e.target.value });
          }}
        />
        <p className="text-xs text-muted-foreground">One domain per line</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="container-packages">Extra packages</Label>
        <Textarea
          id="container-packages"
          className="font-mono"
          rows={3}
          placeholder={'python3\ncurl'}
          value={packages}
          onChange={(e) => {
            setPackages(e.target.value);
            emit({ packages: e.target.value });
          }}
        />
        <p className="text-xs text-muted-foreground">One apt package per line</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="container-envvars">Environment variables</Label>
        <Textarea
          id="container-envvars"
          className="font-mono"
          rows={3}
          placeholder={'API_KEY=secret\nNODE_ENV=production'}
          value={envVars}
          onChange={(e) => {
            setEnvVars(e.target.value);
            emit({ envVars: e.target.value });
          }}
        />
        <p className="text-xs text-muted-foreground">KEY=value, one per line</p>
      </div>
    </div>
  );
}
