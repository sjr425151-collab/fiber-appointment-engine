import { existsSync, readFileSync } from 'node:fs';

/**
 * Resource hints for lazily loaded parts of the app, read from Vite's build
 * manifest. Without them the browser discovers the platform's JS and CSS only
 * after the main bundle runs (main → PlatformApp → page), which delays the
 * first paint of /savings pages on slow mobile connections. The fiber site's
 * pages get no hints, so its loading is unchanged.
 */
interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
}
type Manifest = Record<string, ManifestChunk>;

export interface Preloads {
  scripts: string[];
  styles: string[];
}

const NONE: Preloads = { scripts: [], styles: [] };

/** Collects a chunk's file, its CSS and its static imports, skipping the entry (already in the page). */
function collect(manifest: Manifest, key: string, out: Preloads, seen: Set<string>) {
  const c = manifest[key];
  if (!c || c.isEntry || seen.has(key)) return;
  seen.add(key);
  out.scripts.push(`/${c.file}`);
  for (const css of c.css ?? []) out.styles.push(`/${css}`);
  for (const i of c.imports ?? []) collect(manifest, i, out, seen);
}

const PLATFORM_PAGES: [RegExp, string][] = [
  [/^\/savings$/, 'src/platform/pages/Home.tsx'],
  [/^\/savings\/assess$/, 'src/platform/pages/Assess.tsx'],
  [/^\/savings\/results\/[^/]+$/, 'src/platform/pages/Results.tsx'],
  [/^\/savings\/design$/, 'src/platform/pages/DesignSystem.tsx'],
];

/** Returns a function giving the preloads for a /savings path (empty if no manifest, e.g. in tests). */
export function platformPreloader(manifestPath: string): (path: string) => Preloads {
  if (!existsSync(manifestPath)) return () => NONE;
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    return () => NONE;
  }
  const cache = new Map<string, Preloads>();
  return (path) => {
    const page = PLATFORM_PAGES.find(([re]) => re.test(path))?.[1] ?? '';
    const hit = cache.get(page);
    if (hit) return hit;
    const out: Preloads = { scripts: [], styles: [] };
    const seen = new Set<string>();
    collect(manifest, 'src/platform/PlatformApp.tsx', out, seen);
    if (page) collect(manifest, page, out, seen);
    const unique = { scripts: [...new Set(out.scripts)], styles: [...new Set(out.styles)] };
    cache.set(page, unique);
    return unique;
  };
}
