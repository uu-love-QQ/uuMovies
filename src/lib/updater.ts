import { useSyncExternalStore } from 'react';
import { api, isRunningInTauri } from '../services/api';
import type { UpdateInfo } from '../types';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_MIN_GAP_MS = 30 * 60 * 1000;
const DISMISS_KEY = 'uumovies.update.dismissed_version';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  info: UpdateInfo | null;
  error: string | null;
  progress: number;
  downloaded: number;
  total: number;
  currentVersion: string;
  dismissedVersion: string | null;
  lastCheckedAt: number | null;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

let state: UpdaterState = {
  status: 'idle',
  info: null,
  error: null,
  progress: 0,
  downloaded: 0,
  total: 0,
  currentVersion: '',
  dismissedVersion: readDismissed(),
  lastCheckedAt: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<UpdaterState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeUpdater(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUpdaterState(): UpdaterState {
  return state;
}

export function useUpdater(): UpdaterState {
  return useSyncExternalStore(subscribeUpdater, getUpdaterState, getUpdaterState);
}

let autoCheckEnabled = true;
export function setAutoCheckEnabled(enabled: boolean) {
  autoCheckEnabled = enabled;
}

let inFlightCheck: Promise<void> | null = null;

export async function checkForUpdates(manual = false): Promise<void> {
  if (!isRunningInTauri()) return;
  if (!manual && !autoCheckEnabled) return;
  if (
    !manual &&
    state.lastCheckedAt &&
    Date.now() - state.lastCheckedAt < AUTO_CHECK_MIN_GAP_MS
  ) {
    return;
  }
  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = (async () => {
    setState({ status: 'checking', error: manual ? null : state.error });
    try {
      const info = await api.checkAppUpdate();
      setState({
        info,
        currentVersion: info.current_version,
        lastCheckedAt: Date.now(),
        status: info.available ? 'available' : 'up-to-date',
        error: null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({
        status: manual ? 'error' : state.status,
        error: manual ? message : null,
        lastCheckedAt: Date.now(),
      });
      console.warn('检查更新失败:', message);
    } finally {
      inFlightCheck = null;
    }
  })();

  return inFlightCheck;
}

export async function installUpdate(): Promise<void> {
  const info = state.info;
  if (!info || !info.available) return;

  if (!info.install_supported || !info.download_url) {
    try {
      await api.openExternalUrl(info.html_url);
    } catch (e) {
      setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  setState({
    status: 'downloading',
    error: null,
    progress: 0,
    downloaded: 0,
    total: info.download_size,
  });

  try {
    await api.installAppUpdate(info.download_url, info.sha256, info.latest_version, (event) => {
      if (event.type === 'progress') {
        const total = event.data.total || info.download_size || 0;
        setState({
          downloaded: event.data.downloaded,
          total,
          progress: total > 0 ? Math.min(1, event.data.downloaded / total) : 0,
        });
      } else if (event.type === 'verifying') {
        setState({ status: 'verifying' });
      } else if (event.type === 'installing') {
        setState({ status: 'installing' });
      }
    });
    setState({ status: 'installing' });
  } catch (e) {
    setState({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function dismissUpdate(version?: string) {
  const target = version || state.info?.latest_version || '';
  try {
    localStorage.setItem(DISMISS_KEY, target);
  } catch {
    // ignore storage failures
  }
  setState({ dismissedVersion: target });
}

let watcherStarted = false;

export function startUpdateWatcher() {
  if (watcherStarted || !isRunningInTauri()) return;
  watcherStarted = true;

  void api
    .getAppVersion()
    .then((version) => setState({ currentVersion: version }))
    .catch(() => {});

  window.setTimeout(() => {
    void checkForUpdates();
  }, 3000);
  window.setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForUpdates();
    }
  });
}
