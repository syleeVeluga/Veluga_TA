import mermaid from 'mermaid';
import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = 'dark' | 'light';

function configForTheme(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    flowchart: {
      htmlLabels: false,
    },
  };
}

let activeTheme: MermaidTheme = 'dark';

mermaid.initialize(configForTheme(activeTheme));

export function configureMermaid(theme: MermaidTheme): void {
  if (theme === activeTheme) {
    return;
  }
  activeTheme = theme;
  mermaid.initialize(configForTheme(theme));
}

export { mermaid };
