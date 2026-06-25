import { useEffect, useState } from "react";

export interface VsCodeTheme {
  "--vscode-editor-background": string;
  "--vscode-editor-foreground": string;
  "--vscode-button-background": string;
  "--vscode-button-foreground": string;
  "--vscode-button-hoverBackground": string;
  "--vscode-input-background": string;
  "--vscode-input-foreground": string;
  "--vscode-input-border": string;
  "--vscode-focusBorder": string;
  "--vscode-activityBar-background": string;
  "--vscode-panel-background": string;
  "--vscode-panel-border": string;
  "--vscode-sideBar-background": string;
  "--vscode-list-activeSelectionBackground": string;
  "--vscode-list-activeSelectionForeground": string;
  "--vscode-list-hoverBackground": string;
  "--vscode-scrollbarSlider-background": string;
  "--vscode-scrollbarSlider-hoverBackground": string;
  "--vscode-statusBar-background": string;
  "--vscode-statusBar-foreground": string;
  "--vscode-errorForeground": string;
  "--vscode-warningForeground": string;
}

const VARIABLES: (keyof VsCodeTheme)[] = [
  "--vscode-editor-background",
  "--vscode-editor-foreground",
  "--vscode-button-background",
  "--vscode-button-foreground",
  "--vscode-button-hoverBackground",
  "--vscode-input-background",
  "--vscode-input-foreground",
  "--vscode-input-border",
  "--vscode-focusBorder",
  "--vscode-activityBar-background",
  "--vscode-panel-background",
  "--vscode-panel-border",
  "--vscode-sideBar-background",
  "--vscode-list-activeSelectionBackground",
  "--vscode-list-activeSelectionForeground",
  "--vscode-list-hoverBackground",
  "--vscode-scrollbarSlider-background",
  "--vscode-scrollbarSlider-hoverBackground",
  "--vscode-statusBar-background",
  "--vscode-statusBar-foreground",
  "--vscode-errorForeground",
  "--vscode-warningForeground",
];

function readTheme(): VsCodeTheme {
  const styles = getComputedStyle(document.documentElement);
  const theme = {} as VsCodeTheme;
  for (const key of VARIABLES) {
    theme[key] = styles.getPropertyValue(key).trim() || "#000000";
  }
  return theme;
}

/**
 * Reads VS Code theme CSS variables and re-reads them when the VS Code
 * `vscode-webview-theme` data attribute changes.
 */
export function useTheme(): VsCodeTheme {
  const [theme, setTheme] = useState<VsCodeTheme>(() => readTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-vscode-theme-kind"],
    });
    // Fallback: re-read after a short delay to catch theme injection.
    const timeout = setTimeout(() => setTheme(readTheme()), 50);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, []);

  return theme;
}

export function cssVar(theme: VsCodeTheme, name: keyof VsCodeTheme, fallback?: string): string {
  return theme[name] || fallback || "";
}
