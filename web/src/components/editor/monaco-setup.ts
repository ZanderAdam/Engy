import type * as Monaco from 'monaco-editor';
import {
  ENGY_THEME_NAME,
  ENGY_CYBERPUNK_THEME_NAME,
  engyDarkTheme,
  engyCyberpunkTheme,
} from './monaco-theme';

type MonacoApi = typeof Monaco;

// The TypeScript/JavaScript language services exist on `monaco.languages.typescript`
// at runtime, but @monaco-editor/react's bundled type points at editor.api, where
// that member is only a deprecation stub. These minimal interfaces describe the
// exact slice we drive so we stay type-safe without an `any` cast.
interface TsLanguageServiceDefaults {
  setCompilerOptions(options: Record<string, unknown>): void;
  setDiagnosticsOptions(options: {
    noSemanticValidation?: boolean;
    noSyntaxValidation?: boolean;
    noSuggestionDiagnostics?: boolean;
    diagnosticCodesToIgnore?: number[];
  }): void;
  setEagerModelSync(value: boolean): void;
}

interface MonacoTypescript {
  ScriptTarget: { ESNext: number };
  ModuleKind: { ESNext: number };
  ModuleResolutionKind: { NodeJs: number };
  JsxEmit: { ReactJSX: number };
  typescriptDefaults: TsLanguageServiceDefaults;
  javascriptDefaults: TsLanguageServiceDefaults;
}

const configured = new WeakSet<MonacoApi>();

/**
 * Configures a Monaco instance once: registers the Engy theme and turns on the
 * built-in TypeScript/JavaScript language services so the editor gets real
 * IntelliSense, hover, signature help, go-to-definition, document symbols
 * (outline / Ctrl+Shift+O) and rename across the models that are open.
 *
 * Idempotent — safe to call from every editor's `beforeMount`.
 */
export function configureMonaco(monaco: MonacoApi): void {
  monaco.editor.defineTheme(ENGY_THEME_NAME, engyDarkTheme);
  monaco.editor.defineTheme(ENGY_CYBERPUNK_THEME_NAME, engyCyberpunkTheme);

  if (configured.has(monaco)) return;
  configured.add(monaco);

  const ts = (monaco.languages as unknown as { typescript: MonacoTypescript }).typescript;

  const compilerOptions: Record<string, unknown> = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    lib: ['esnext', 'dom', 'dom.iterable'],
  };

  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setCompilerOptions(compilerOptions);

  // Keep models eagerly synced so cross-model navigation works the moment a
  // file is opened, rather than only after the worker lazily picks it up.
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setEagerModelSync(true);

  // We open one file at a time without its dependency graph, so module-resolution
  // diagnostics ("cannot find module './foo'") would be pure noise. Keep syntax
  // and the useful semantic checks, silence the unresolvable-import/name codes.
  const sharedDiagnostics = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
    diagnosticCodesToIgnore: [
      2307, // Cannot find module '...'
      2792, // Cannot find module — did you mean to set 'moduleResolution'?
      2304, // Cannot find name '...'
      2305, // Module has no exported member
      6133, // '...' is declared but its value is never read
      7016, // Could not find a declaration file for module
    ],
  };

  ts.typescriptDefaults.setDiagnosticsOptions(sharedDiagnostics);
  ts.javascriptDefaults.setDiagnosticsOptions(sharedDiagnostics);
}
