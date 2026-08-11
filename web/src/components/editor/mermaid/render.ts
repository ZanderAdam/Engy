/**
 * Lazy mermaid runtime wrapper. Loads mermaid on first call so it never appears
 * in the document-editor initial chunk and never runs server-side.
 */

export type MermaidTheme = 'default' | 'dark' | 'cyberpunk';

type MermaidModule = typeof import('mermaid').default;

let mermaidPromise: Promise<MermaidModule> | null = null;
let initializedTheme: MermaidTheme | null = null;

// Neon variables on mermaid's customizable `base` theme, matching the
// cyberpunk flavor's xterm/Monaco palette.
const CYBERPUNK_THEME_CONFIG = {
  theme: 'base',
  themeVariables: {
    darkMode: true,
    background: '#0d060a',
    primaryColor: '#2a1520',
    primaryTextColor: '#ffd9d4',
    primaryBorderColor: '#ff2a4d',
    secondaryColor: '#0a2a30',
    tertiaryColor: '#1a0d14',
    lineColor: '#00f0ff',
    textColor: '#ffd9d4',
    clusterBkg: '#140a10',
    clusterBorder: '#7a2233',
    edgeLabelBackground: '#1a0d14',
    titleColor: '#ff6b5e',
    noteBkgColor: '#2a2405',
    noteTextColor: '#fcee0a',
    noteBorderColor: '#fcee0a',
    actorBkg: '#1a0d14',
    actorBorder: '#ff2a4d',
    actorTextColor: '#ffd9d4',
    signalColor: '#00f0ff',
    signalTextColor: '#ffd9d4',
  },
} as const;

function themeConfig(theme: MermaidTheme) {
  return theme === 'cyberpunk' ? CYBERPUNK_THEME_CONFIG : { theme };
}

async function getMermaid(theme: MermaidTheme): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  const m = await mermaidPromise;
  if (initializedTheme !== theme) {
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: 'inherit',
      ...themeConfig(theme),
    });
    initializedTheme = theme;
  }
  return m;
}

type RenderResult = { svg: string } | { error: string };

let renderCounter = 0;

export async function renderDiagram(
  id: string,
  code: string,
  theme: MermaidTheme,
): Promise<RenderResult> {
  if (!code.trim()) {
    return { error: 'Empty diagram' };
  }
  try {
    const m = await getMermaid(theme);
    await m.parse(code);
    // Mermaid's render() leaves DOM artifacts keyed by id. Using a fresh id
    // per call avoids stale-DOM collisions across re-renders of the same block.
    const safeId = `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${++renderCounter}`;
    const { svg } = await m.render(safeId, code);
    // Strip height="100%" so the SVG height comes from the viewBox aspect ratio
    // (otherwise SVG fills 100% of an undefined parent height = 0). Keep
    // width="100%" — combined with mermaid's style="max-width: <px>" this yields
    // "fill width up to intrinsic width", which is what we want.
    const cleaned = svg.replace(/\sheight="100%"/g, '');
    return { svg: cleaned };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
