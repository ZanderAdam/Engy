import { getLanguageFromPath } from '@/components/editor/language-map';
import { isLanguageSupported } from './refractor-highlighter';

/**
 * Monaco's language ids and Prism's grammar names mostly agree. These are the
 * ones that don't — mapping them keeps `language-map.ts` the single extension
 * table for both editors.
 */
const MONACO_TO_PRISM: Record<string, string> = {
  shell: 'bash',
  html: 'markup',
  xml: 'markup',
  bat: 'batch',
  'objective-c': 'objectivec',
  dockerfile: 'docker',
};

export function toPrismLanguage(monacoLanguage: string): string | null {
  if (monacoLanguage === 'plaintext') return null;
  return MONACO_TO_PRISM[monacoLanguage] ?? monacoLanguage;
}

/**
 * Prism grammar for a path, or null when there is none to highlight with.
 * Callers must treat null as "render unhighlighted": `refractor.highlight`
 * throws on a grammar that was never registered.
 */
export function diffLanguage(filePath: string): string | null {
  const language = toPrismLanguage(getLanguageFromPath(filePath));
  return language && isLanguageSupported(language) ? language : null;
}
