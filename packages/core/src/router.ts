import { signal, Signal } from './signals.js';
import { h } from './dom.js';
import type { AgentChild } from './types.js';

export interface RouteMatch {
  path: string;
  params: Record<string, string>;
  searchParams: URLSearchParams;
}

const initialPath = typeof window !== 'undefined' ? window.location.pathname : '/';
const initialSearch = typeof window !== 'undefined' ? window.location.search : '';
const initialHash = typeof window !== 'undefined' ? window.location.hash : '';

export const currentPath: Signal<string> = signal(initialPath, { name: 'router.path' });
export const currentSearch: Signal<string> = signal(initialSearch, { name: 'router.search' });
export const currentHash: Signal<string> = signal(initialHash, { name: 'router.hash' });

let popstateRegistered = false;
if (typeof window !== 'undefined' && !popstateRegistered) {
  popstateRegistered = true;
  window.addEventListener('popstate', () => {
    currentPath.value = window.location.pathname;
    currentSearch.value = window.location.search;
    currentHash.value = window.location.hash;
  });
}

export function navigate(
  to: string,
  options: { replace?: boolean; scroll?: boolean } = {}
): void {
  if (typeof window === 'undefined') return;

  const url = new URL(to, window.location.origin);
  const newPath = url.pathname;
  const newSearch = url.search;
  const newHash = url.hash;

  if (options.replace) {
    window.history.replaceState({}, '', to);
  } else {
    window.history.pushState({}, '', to);
  }

  currentPath.value = newPath;
  currentSearch.value = newSearch;
  currentHash.value = newHash;

  if (options.scroll !== false) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*' || pattern === '/*') return {};
  if (pattern === pathname) return {};

  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length && !pattern.endsWith('/*')) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const val = pathParts[i];

    if (p.startsWith(':')) {
      const paramName = p.slice(1);
      params[paramName] = decodeURIComponent(val || '');
    } else if (p === '*') {
      return params;
    } else if (p !== val) {
      return null;
    }
  }

  return params;
}

export interface LinkProps {
  href: string;
  class?: string;
  className?: string;
  children?: any;
  replace?: boolean;
  scroll?: boolean;
  onClick?: (e: MouseEvent) => void;
  [key: string]: any;
}

export function Link(props: LinkProps): AgentChild {
  const { href, class: cls, className, children, replace, scroll, onClick, ...rest } = props;
  const classVal = cls || className || '';

  const handleClick = (e: MouseEvent) => {
    if (onClick) onClick(e);
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    ) {
      return;
    }
    // Check if internal relative or same-origin link
    if (href.startsWith('/') || href.startsWith('#')) {
      e.preventDefault();
      navigate(href, { replace, scroll });
    }
  };

  return h(
    'a',
    {
      href,
      class: classVal,
      onClick: handleClick,
      ...rest,
    },
    children
  );
}

export interface RouterProps {
  routes: Record<string, (match: RouteMatch) => AgentChild>;
  fallback?: (match: RouteMatch) => AgentChild;
}

export function Router(props: RouterProps): AgentChild {
  const path = currentPath.value;
  const search = currentSearch.value;
  const searchParams = new URLSearchParams(search);

  // 1. Direct exact match
  if (props.routes[path]) {
    return props.routes[path]({ path, params: {}, searchParams });
  }

  // 2. Pattern match
  for (const [pattern, handler] of Object.entries(props.routes)) {
    const params = matchPath(pattern, path);
    if (params) {
      return handler({ path, params, searchParams });
    }
  }

  // 3. Fallback / 404
  if (props.fallback) {
    return props.fallback({ path, params: {}, searchParams });
  }

  return null;
}
