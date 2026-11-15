export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'amber' | 'indigo' | 'emerald' | 'rose' | 'cyan' | 'zinc';

export interface ThemeSettings {
  mode: ThemeMode;
  accent: AccentColor;
}

const THEME_STORAGE_KEY = 'movies_theme_settings';

export const ACCENT_COLORS: { id: AccentColor; name: string; hex: string; bgClass: string }[] = [
  { id: 'amber', name: '琥珀橙 (CC 经典)', hex: '#f97316', bgClass: 'bg-orange-500' },
  { id: 'indigo', name: '极光蓝 (科技)', hex: '#6366f1', bgClass: 'bg-indigo-500' },
  { id: 'emerald', name: '翡翠绿 (清新)', hex: '#10b981', bgClass: 'bg-emerald-500' },
  { id: 'rose', name: '蔷薇红 (浪漫)', hex: '#f43f5e', bgClass: 'bg-rose-500' },
  { id: 'cyan', name: '天青色 (流光)', hex: '#06b6d4', bgClass: 'bg-cyan-500' },
  { id: 'zinc', name: '极简白 (黑白)', hex: '#71717a', bgClass: 'bg-zinc-500' },
];

export function getThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to parse theme settings', e);
  }
  return {
    mode: 'dark',
    accent: 'amber',
  };
}

let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

export function applyTheme(settings: ThemeSettings): void {
  const root = document.documentElement;

  // Determine dark or light
  let isDark = true;
  if (settings.mode === 'light') {
    isDark = false;
  } else if (settings.mode === 'dark') {
    isDark = true;
  } else if (settings.mode === 'system') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Attach system listener if not attached
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQueryListener) {
      mql.removeEventListener('change', mediaQueryListener);
    }
    mediaQueryListener = (e: MediaQueryListEvent) => {
      if (getThemeSettings().mode === 'system') {
        if (e.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };
    mql.addEventListener('change', mediaQueryListener);
  }

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  // Set accent attribute
  root.setAttribute('data-accent', settings.accent || 'amber');

  // Persist
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save theme settings', e);
  }
}
