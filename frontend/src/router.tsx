import React, { createContext, useContext, useEffect, useState } from 'react';

export type RoutePath = '/' | '/accounts' | '/settings' | '/playground';

interface RouterContextType {
  path: RoutePath;
  navigate: (to: RoutePath) => void;
}

const RouterContext = createContext<RouterContextType>({
  path: '/',
  navigate: () => {},
});

function getPathFromHash(): RoutePath {
  if (typeof window === 'undefined') return '/';
  const hash = window.location.hash.replace(/^#/, '');
  const clean = hash.split('?')[0];
  if (clean === '/accounts' || clean === '/settings' || clean === '/playground') {
    return clean;
  }
  return '/';
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState<RoutePath>(getPathFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setPath(getPathFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (to: RoutePath) => {
    if (typeof window !== 'undefined') {
      window.location.hash = to;
    }
    setPath(to);
  };

  return (
    <RouterContext.Provider value={{ path, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}
