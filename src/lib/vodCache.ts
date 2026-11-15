import type { VodResponse } from '../types';
import { api } from '../services/api';

interface CacheEntry {
  data: VodResponse;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();

function getCacheKey(sourceId: string, typeId?: string, page: number = 1): string {
  return `${sourceId}__${typeId || 'all'}__p${page}`;
}

export function getCachedVodList(
  sourceId: string,
  typeId?: string,
  page: number = 1
): VodResponse | null {
  const key = getCacheKey(sourceId, typeId, page);
  const entry = memoryCache.get(key);
  if (!entry) return null;

  // Stale-while-revalidate: return entry even if expired, but trigger refresh
  return entry.data;
}

export function setCachedVodList(
  sourceId: string,
  typeId: string | undefined,
  page: number,
  data: VodResponse
): void {
  const key = getCacheKey(sourceId, typeId, page);
  memoryCache.set(key, {
    data,
    timestamp: Date.now(),
  });

  // Limit memory cache size to 150 entries
  if (memoryCache.size > 150) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
}

export function clearVodCache(sourceId?: string): void {
  if (sourceId) {
    for (const key of Array.from(memoryCache.keys())) {
      if (key.startsWith(`${sourceId}__`)) {
        memoryCache.delete(key);
      }
    }
  } else {
    memoryCache.clear();
  }
}

/**
 * Fetch VOD list with instant Stale-While-Revalidate caching:
 * - If cache exists, immediately invokes onData with cached results (0ms instant switch!)
 * - If cache is stale or missing, fetches fresh data in background and updates UI smoothly.
 */
export async function fetchVodListWithCache(
  params: {
    sourceId: string;
    typeId?: string;
    page?: number;
  },
  callbacks: {
    onImmediate?: (data: VodResponse) => void;
  }
): Promise<VodResponse> {
  const page = params.page || 1;
  const key = getCacheKey(params.sourceId, params.typeId, page);
  const cached = memoryCache.get(key);

  if (cached) {
    if (callbacks.onImmediate) {
      callbacks.onImmediate(cached.data);
    }
    // If cache is still very fresh (< 60s), avoid network spam entirely
    if (Date.now() - cached.timestamp < 60 * 1000) {
      return cached.data;
    }
  }

  // Fetch fresh data
  const fresh = await api.fetchVodList({
    sourceId: params.sourceId,
    typeId: params.typeId,
    page,
  });

  setCachedVodList(params.sourceId, params.typeId, page, fresh);
  return fresh;
}
