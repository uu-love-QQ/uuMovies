import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Sparkles,
  Play,
  Globe,
  X,
  History,
  Inbox,
  Loader2,
} from 'lucide-react';
import type { Source, VodItem } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import { LazyImage } from './ui/LazyImage';

interface SearchViewProps {
  initialQuery?: string;
  sources: Source[];
  activeSourceId: string;
  onSelectVod: (vod: VodItem) => void;
  onQuickPlay: (vod: VodItem) => void;
}
const normalizeTitle = (s: string) => {
  return s
    .toLowerCase()
    .replace(/[【】\[\]\(\)（）\s·\-_:：/]/g, '')
    .replace(/4k|1080p|720p|hd|bd|tc|ts|国语|粤语|中字|更新至?\d+集?|全\d+集|完结|抢先版?/gi, '')
    .replace(/第1季|s1/g, '第一季')
    .replace(/第2季|s2/g, '第二季')
    .replace(/第3季|s3/g, '第三季')
    .trim();
};

const isSameShow = (a: VodItem, b: VodItem): boolean => {
  const na = normalizeTitle(a.vod_name);
  const nb = normalizeTitle(b.vod_name);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  if (a.vod_pic && b.vod_pic) {
    const sa = a.vod_pic.split('?')[0].split('/').pop()?.split('.')[0] || '';
    const sb = b.vod_pic.split('?')[0].split('/').pop()?.split('.')[0] || '';
    if (sa && sb && sa.length > 8 && sa === sb) return true;
  }
  return false;
};

const extractTextCore = (s: string): string => {
  return s
    .replace(/19\d{2}|20\d{2}/g, '')
    .replace(/第[一二三四五六七八九十0-9]+[季部篇]|s\d+/gi, '')
    .replace(/4k|1080p|720p|hd|bd|tc|ts|国语|粤语|中字|抢先版|电影解说/gi, '')
    .trim();
};

const isItemRelevant = (itemName: string, query: string): boolean => {
  const cleanItem = itemName.toLowerCase().replace(/[\s\-_:：·/【】\[\]\(\)（）]/g, '');
  const cleanQuery = query.toLowerCase().replace(/[\s\-_:：·/【】\[\]\(\)（）]/g, '');
  if (!cleanQuery || !cleanItem) return false;

  const queryHasAlpha = /[\p{L}\p{Script=Han}]/u.test(cleanQuery);
  const itemHasAlpha = /[\p{L}\p{Script=Han}]/u.test(cleanItem);

  if (queryHasAlpha && !itemHasAlpha) {
    return false;
  }

  if (cleanItem.includes(cleanQuery) || cleanQuery.includes(cleanItem)) {
    return true;
  }

  const textQuery = extractTextCore(cleanQuery);
  const textItem = extractTextCore(cleanItem);

  if (textQuery) {
    if (textItem.includes(textQuery) || textQuery.includes(textItem)) {
      return true;
    }

    const queryChars = new Set(textQuery.split('').filter((c) => /[\p{L}\p{Script=Han}]/u.test(c)));
    const itemChars = new Set(textItem.split('').filter((c) => /[\p{L}\p{Script=Han}]/u.test(c)));
    let intersection = 0;
    for (const c of queryChars) {
      if (itemChars.has(c)) intersection++;
    }

    if (queryChars.size >= 3) {
      if (intersection >= 3 || intersection * 2 >= queryChars.size) {
        return true;
      }
    } else if (queryChars.size > 0) {
      if (intersection === queryChars.size) {
        return true;
      }
    }
  } else {
    return cleanItem.includes(cleanQuery);
  }

  return false;
};

const mergeIncomingItems = (existing: VodItem[], incoming: VodItem[]): VodItem[] => {
  const list = [...existing];
  for (const item of incoming) {
    const srcName = item.source_name || '默认源';
    const idx = list.findIndex((ex) => isSameShow(ex, item));
    if (idx >= 0) {
      const ex = list[idx];
      const stations = ex.source_stations ? [...ex.source_stations] : [ex.source_name || '默认源'];
      if (!stations.includes(srcName)) {
        stations.push(srcName);
      }
      const lines = [...ex.play_lines];
      for (const l of item.play_lines) {
        const fullTitle = l.title.includes(srcName) ? l.title : `${srcName} · ${l.title}`;
        if (!lines.some((existingLine) => existingLine.title === fullTitle)) {
          lines.push({ ...l, title: fullTitle });
        }
      }
      list[idx] = {
        ...ex,
        source_stations: stations,
        play_lines: lines,
        vod_pic: ex.vod_pic || item.vod_pic,
        vod_content: ex.vod_content || item.vod_content,
        vod_remarks: ex.vod_remarks || item.vod_remarks,
      };
    } else {
      const stations = item.source_stations && item.source_stations.length > 0 ? item.source_stations : [srcName];
      const lines = item.play_lines.map((l) => ({
        ...l,
        title: l.title.includes(srcName) ? l.title : `${srcName} · ${l.title}`,
      }));
      list.push({ ...item, source_stations: stations, play_lines: lines });
    }
  }
  return list;
};

export const SearchView: React.FC<SearchViewProps> = ({
  initialQuery = '',
  sources,
  activeSourceId,
  onSelectVod,
  onQuickPlay,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<'aggregate' | 'single'>('aggregate');
  const [selectedSourceId, setSelectedSourceId] = useState(activeSourceId);
  const [results, setResults] = useState<VodItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [expandedAliases, setExpandedAliases] = useState<string[]>([]);
  const [searchProgress, setSearchProgress] = useState<{
    completed: number;
    total: number;
    source_name: string;
  } | null>(null);
  const aliasesRef = useRef<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('movies_search_history');
      if (saved) setRecentSearches(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  const saveRecentSearch = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 10);
      localStorage.setItem('movies_search_history', JSON.stringify(next));
      return next;
    });
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('movies_search_history');
  };

  const doSearch = async (kwToSearch: string) => {
    const trimmed = kwToSearch.trim();
    if (!trimmed) return;
    aliasesRef.current = [];
    setResults([]);
    setSearchProgress(null);
    setExpandedAliases([]);
    setIsSearching(true);
    setHasSearched(true);
    saveRecentSearch(trimmed);

    try {
      if (searchMode === 'aggregate') {
        const enabledSourceIds = sources.filter((s) => s.enabled).map((s) => s.id);
        await api.searchStream(trimmed, enabledSourceIds, (event) => {
          if (event.type === 'items') {
            const allowed = [trimmed, ...aliasesRef.current];
            const relevant = event.data.filter((it) =>
              allowed.some((a) => isItemRelevant(it.vod_name, a))
            );
            if (relevant.length > 0) {
              setResults((prev) => mergeIncomingItems(prev, relevant));
            }
          } else if (event.type === 'aliases') {
            aliasesRef.current = event.data;
            setExpandedAliases(event.data);
          } else if (event.type === 'progress') {
            setSearchProgress(event.data);
          } else if (event.type === 'done') {
            setIsSearching(false);
          }
        });
      } else {
        const res = await api.fetchVodList({
          sourceId: selectedSourceId,
          keyword: trimmed,
        });
        let itemsToShow = res.list;
        if (itemsToShow.length === 0) {
          const aliases = await api.expandSearchKeywords(trimmed);
          for (const alt of aliases) {
            if (alt !== trimmed) {
              const altRes = await api.fetchVodList({
                sourceId: selectedSourceId,
                keyword: alt.replace(' ', ''),
              });
              if (altRes.list.length > 0) {
                itemsToShow = altRes.list.filter((it) => isItemRelevant(it.vod_name, alt));
                break;
              }
            }
          }
        } else {
          itemsToShow = itemsToShow.filter((it) => isItemRelevant(it.vod_name, trimmed));
        }
        setResults(itemsToShow);
        setIsSearching(false);
      }
    } catch (e) {
      console.error(e);
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (initialQuery.trim()) {
      setQuery(initialQuery);
      doSearch(initialQuery);
    }
  }, [initialQuery]);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    doSearch(query);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 select-none animate-fade-in">
      {/* Search Header Container */}
      <div className="max-w-xl mx-auto mb-8">
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索电影、电视剧、动漫、演员..."
              className="pl-9 pr-8 h-10 bg-secondary/80 border-border text-foreground text-sm focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="h-10 px-5 text-xs font-semibold"
          >
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : '搜索'}
          </Button>
        </form>

        {/* Expanded Aliases Hint */}
        {expandedAliases.length > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2.5 flex-wrap">
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>别名/译名联想:</span>
            </span>
            {expandedAliases.map((alias) => (
              <button
                key={alias}
                type="button"
                onClick={() => {
                  setQuery(alias);
                  doSearch(alias);
                }}
                className={cn(
                  'px-2 py-0.5 rounded text-xs transition-colors cursor-pointer',
                  alias === query
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'bg-secondary/70 hover:bg-secondary text-secondary-foreground border border-border/80'
                )}
              >
                {alias}
              </button>
            ))}
          </div>
        )}

        {/* Search Mode & Source Select */}
        <div className="flex items-center justify-between mt-3 px-1 text-xs">
          <div className="flex items-center bg-secondary/70 p-0.5 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setSearchMode('aggregate')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors cursor-pointer',
                searchMode === 'aggregate'
                  ? 'bg-card text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Sparkles className="w-3 h-3" />
              <span>全网多源聚合</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('single')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors cursor-pointer',
                searchMode === 'single'
                  ? 'bg-card text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Globe className="w-3 h-3" />
              <span>单源搜索</span>
            </button>
          </div>

          {searchMode === 'single' && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>指定源:</span>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="bg-card border border-border rounded-md px-2 py-1 text-foreground text-xs focus:outline-none"
              >
                {sources
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>

        {/* Search History */}
        {recentSearches.length > 0 && !hasSearched && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span className="flex items-center gap-1">
                <History className="w-3.5 h-3.5" /> 最近搜索
              </span>
              <button
                type="button"
                onClick={clearRecentSearches}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentSearches.map((kw, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setQuery(kw);
                    doSearch(kw);
                  }}
                  className="px-2.5 py-1 bg-secondary hover:bg-secondary/80 border border-border text-secondary-foreground rounded-md text-xs transition-colors cursor-pointer"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {/* Real-time Streaming Progress Banner */}
      {isSearching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 bg-card border border-border rounded-xl px-3 py-2 animate-fade-in shadow-sm">
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />
          <span>
            {searchProgress
              ? `增量检索中 (${searchProgress.completed}/${searchProgress.total} 源，最新响应: ${searchProgress.source_name})`
              : '正在并发检索采集源...'}
          </span>
          <span className="text-muted-foreground font-mono ml-auto">已呈现 {results.length} 部影视</span>
        </div>
      )}

      {results.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4 text-xs text-muted-foreground">
            <span>找到 {results.length} 部匹配资源</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
            {results.map((vod, idx) => (
              <div
                key={`${vod.source_id}_${vod.vod_id}_${idx}`}
                onClick={() => onSelectVod(vod)}
                className="group flex flex-col cursor-pointer select-none"
              >
                <div className="relative w-full aspect-[2/3] bg-card rounded-xl overflow-hidden border border-border transition-all duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                  <LazyImage
                    src={vod.vod_pic}
                    alt={vod.vod_name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Badges */}
                  {vod.source_stations && vod.source_stations.length > 1 ? (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 border border-emerald-500/50 text-[10px] font-medium text-emerald-300 rounded backdrop-blur max-w-[130px] truncate shadow-sm">
                      {vod.source_stations.length}源聚合 ({vod.source_stations.join('/')})
                    </div>
                  ) : vod.source_name ? (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 border border-white/10 text-[10px] font-medium text-white/90 rounded backdrop-blur shadow-sm">
                      {vod.source_name}
                    </div>
                  ) : null}

                  {vod.vod_remarks && (
                    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-black/75 border border-white/10 text-[10px] font-medium text-white rounded backdrop-blur shadow-sm">
                      {vod.vod_remarks}
                    </div>
                  )}

                  {/* Play Hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickPlay(vod);
                      }}
                      className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transition-transform transform scale-90 group-hover:scale-100 active:scale-95 cursor-pointer"
                      title="立即播放"
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <h3
                    className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary truncate transition-colors"
                    title={vod.vod_name}
                  >
                    {vod.vod_name}
                  </h3>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                    <span className="truncate">{vod.type_name || '综合'}</span>
                    <span className="truncate opacity-75">{vod.vod_year || vod.vod_area || ''}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : isSearching ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col space-y-2">
              <div className="w-full aspect-[2/3] bg-muted rounded-xl animate-pulse border border-border/40" />
              <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
              <div className="h-3 bg-muted/70 rounded animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      ) : hasSearched ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">未找到相关影视资源</p>
          <p className="text-xs text-muted-foreground mt-1">请尝试更换关键字或在设置中启用更多采集源</p>
        </div>
      ) : null}
    </div>
  );
};
