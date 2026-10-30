/**
 * Minimal hash router (no dependency). Hash routes work with the Vite dev server, a static build
 * and the backend's OAuth redirect ("/#/dashboard") without any server rewrite rules.
 *
 *   #/                   landing page
 *   #/models             model catalogue (public)
 *   #/explore/<modelId>  3D explorer
 * Everything is open: there are no accounts.
 */

import { useEffect, useState } from 'react';

export type RouteName = 'landing' | 'models' | 'explore' | 'notFound';

export interface Route {
  name: RouteName;
  /** explore: the model id */
  param: string | null;
  query: Record<string, string>;
  /** the raw hash path, e.g. "#/explore/rc_frame" */
  path: string;
}

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  const path = `#/${segments.join('/')}`;
  const route = (name: RouteName, param: string | null = null): Route => ({ name, param, query, path });
  if (segments.length === 0) return route('landing');
  switch (segments[0]) {
    case 'models': return route('models');
    case 'explore': return segments[1] && /^[A-Za-z0-9_.-]+$/.test(segments[1]) ? route('explore', segments[1]) : route('models');
    default: return route('notFound');
  }
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) window.location.replace(target);
  else window.location.hash = target;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
