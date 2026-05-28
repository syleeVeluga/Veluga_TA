import mermaid from 'mermaid';
import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = 'dark' | 'light';

function configForTheme(theme: MermaidTheme): MermaidConfig {
  const isDark = theme === 'dark';

  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: 'base',
    themeVariables: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', system-ui, sans-serif",
      background: isDark ? '#22201d' : '#faf9f4',
      mainBkg: isDark ? '#2a2723' : '#fef3ee',
      primaryColor: isDark ? '#2a2723' : '#fef3ee',
      primaryBorderColor: isDark ? '#d67a52' : '#d97757',
      primaryTextColor: isDark ? '#f1ece4' : '#1a1a1a',
      secondaryColor: isDark ? '#1d1b18' : '#f5f3ed',
      secondaryBorderColor: isDark ? '#8c8378' : '#8c8c8c',
      secondaryTextColor: isDark ? '#f1ece4' : '#1a1a1a',
      tertiaryColor: isDark ? '#1b1916' : '#f2f0eb',
      tertiaryBorderColor: isDark ? '#34302a' : '#e2dfd9',
      tertiaryTextColor: isDark ? '#f1ece4' : '#1a1a1a',
      lineColor: isDark ? '#b6ada2' : '#5c5c5c',
      textColor: isDark ? '#f1ece4' : '#1a1a1a',
      edgeLabelBackground: isDark ? '#22201d' : '#faf9f4',
    },
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
