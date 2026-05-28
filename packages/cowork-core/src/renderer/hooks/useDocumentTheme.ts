import { useEffect, useState } from 'react';

function isLightTheme(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.documentElement.classList.contains('light');
}

export function useDocumentTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (isLightTheme() ? 'light' : 'dark'));

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(isLightTheme() ? 'light' : 'dark');
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
