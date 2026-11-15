import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Inbox,
  AlertCircle,
  Flame,
} from 'lucide-react';
import type { Source, VodItem, Category, UserTaxonomyConfig, LocalCategory } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { buildCategoryTree, resolveSemanticTag } from '../lib/taxonomyHelper';
import { fetchVodListWithCache } from '../lib/vodCache';
import { LazyImage } from './ui/LazyImage';

interface HomeViewProps {
  activeSource: Source | undefined;
  onSelectVod: (vod: VodItem) => void;
  onQuickPlay: (vod: VodItem) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  activeSource,
  onSelectVod,
  onQuickPlay,
}) => {
  const [items, setItems] = useState<VodItem[]>([]);
  const [classes, setClasses] = useState<Category[]>([]);
  const [selectedLocalCatId, setSelectedLocalCatId] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [taxonomy, setTaxonomy] = useState<UserTaxonomyConfig | null>(null);

  useEffect(() => {
    api.getTaxonomy().then(setTaxonomy).catch(console.error);
    if (activeSource) {
      api.getSourceClasses(activeSource.id).then((cls) => {
        if (cls && cls.length > 0) {
          setClasses(cls);
        }
      }).catch(console.error);
    }
  }, [activeSource]);

  const categoryTree = useMemo(() => buildCategoryTree(classes), [classes]);

  // Dynamically resolve local categories, filtering out 18+ when adult mode is off
  const displayLocalCategories = useMemo<LocalCategory[]>(() => {
    if (!taxonomy) return [];
    let list = [...taxonomy.categories];
    if (!taxonomy.adult_mode) {
      list = list.filter((c) => !c.bind_tags.includes('#18plus'));
    }
    return list;
  }, [taxonomy]);

  // Determine effective type_id based on selected local category
  // Selected Local Category object from User's config
  const activeLocalCategory = useMemo<LocalCategory | undefined>(() => {
    if (!taxonomy || selectedLocalCatId === 'all') return undefined;
    return displayLocalCategories.find((c) => c.id === selectedLocalCatId);
  }, [displayLocalCategories, selectedLocalCatId, taxonomy]);

  const matchedClasses = useMemo(() => {
    if (!activeLocalCategory) return [];
    const bindTags = activeLocalCategory.bind_tags || [];
    const matched = classes.filter((c) => {
      if (bindTags.includes('#18plus')) {
        if (activeSource?.adult_type_ids?.includes(c.type_id)) {
          return true;
        }
      }
      const tag = resolveSemanticTag(c.type_id, activeSource, categoryTree);
      return tag && bindTags.includes(tag);
    });

    const hasChildren = matched.some((c) => c.type_pid && c.type_pid !== '0');
    if (hasChildren) {
      return matched.filter(
        (c) =>
          !categoryTree.childrenMap.has(c.type_id) &&
          c.type_name !== activeLocalCategory.name
      );
    }
    return matched;
  }, [classes, activeLocalCategory, activeSource, categoryTree]);

  // Determine effective type_id based on selected local category (joining subcategories to aggregate full channel)
  const effectiveTypeId = useMemo(() => {
    if (!activeLocalCategory) return undefined;
    if (matchedClasses.length === 0) return null;
    const targetIds = matchedClasses.map((c) => c.type_id).filter(Boolean);
    if (targetIds.length > 1) {
      return targetIds.join(',');
    }
    return targetIds[0];
  }, [activeLocalCategory, matchedClasses]);

  // Fetch with Stale-While-Revalidate Instant Cache
  useEffect(() => {
    if (!activeSource) return;

    let isMounted = true;
    setErrorMsg(null);

    // If a channel is selected, but has NO mapped classes in this source:
    if (activeLocalCategory && matchedClasses.length === 0) {
      setItems([]);
      setTotalCount(0);
      setPageCount(1);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    fetchVodListWithCache(
      {
        sourceId: activeSource.id,
        typeId: effectiveTypeId ?? undefined,
        page: currentPage,
      },
      {
        onImmediate: (cached) => {
          if (!isMounted) return;
          setItems(cached.list);
          if (cached.classes && cached.classes.length > 0) {
            setClasses(cached.classes);
          }
          setCurrentPage(cached.page || 1);
          setPageCount(cached.pagecount || 1);
          setTotalCount(cached.total || 0);
          setIsLoading(false); // Instant 0ms render!
        },
      }
    )
      .then((res) => {
        if (!isMounted) return;
        setItems(res.list);
        if (res.classes && res.classes.length > 0) {
          setClasses(res.classes);
        }
        setCurrentPage(res.page || 1);
        setPageCount(res.pagecount || 1);
        setTotalCount(res.total || 0);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeSource, effectiveTypeId, selectedLocalCatId, currentPage]);

  const handleCategorySelect = (catId: string) => {
    setSelectedLocalCatId(catId);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pageCount) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Category Filter Pills (rendered dynamically from user taxonomy config) */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-border/80">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <button
            onClick={() => handleCategorySelect('all')}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
              selectedLocalCatId === 'all'
                ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                : 'bg-secondary/70 hover:bg-secondary text-secondary-foreground'
            )}
          >
            全部
          </button>
          {displayLocalCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => handleCategorySelect(c.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5',
                selectedLocalCatId === c.id
                  ? c.id === '18plus' || c.bind_tags.includes('#18plus')
                    ? 'bg-rose-600 text-white font-semibold shadow-sm'
                    : 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : c.id === '18plus' || c.bind_tags.includes('#18plus')
                    ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 border border-rose-500/30 font-medium'
                    : 'bg-secondary/70 hover:bg-secondary text-secondary-foreground'
              )}
            >
              {(c.id === '18plus' || c.bind_tags.includes('#18plus')) && (
                <Flame className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span>{c.name}</span>
            </button>
          ))}
        </div>

        {totalCount > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {totalCount} 部影视资源
          </span>
        )}
      </div>

      {/* Loading Skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="flex flex-col space-y-2">
              <div className="w-full aspect-[2/3] bg-muted rounded-xl animate-pulse border border-border/40" />
              <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
              <div className="h-3 bg-muted/70 rounded animate-pulse w-1/2" />
            </div>
          ))}
        </div>
      ) : errorMsg ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mb-3">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">接口获取失败</h3>
          <p className="text-xs text-muted-foreground max-w-sm mb-4">{errorMsg}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => p)}
            className="gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>重试</span>
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">
            {activeLocalCategory && matchedClasses.length === 0
              ? `【${activeLocalCategory.name}】在此采集源下未绑定任何分类`
              : '未找到影视资源'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {activeLocalCategory && matchedClasses.length === 0
              ? '当前采集源尚未将任何分类映射至该频道，您可在【设置 → 采集源分类映射】中进行绑定'
              : '该分类下暂无资源，或请尝试切换其它采集源'}
          </p>
        </div>
      ) : (
        /* Cinema Poster Grid with Lazy Loading */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {items.map((vod) => (
            <div
              key={vod.vod_id}
              onClick={() => onSelectVod(vod)}
              className="group flex flex-col cursor-pointer select-none"
            >
              {/* Poster Card */}
              <div className="relative w-full aspect-[2/3] bg-card rounded-xl overflow-hidden border border-border/80 transition-all duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                <LazyImage
                  src={vod.vod_pic}
                  alt={vod.vod_name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />

                <div className="absolute top-1.5 right-1.5">
                  {vod.vod_remarks && (
                    <span className="px-1.5 py-0.5 bg-black/75 backdrop-blur border border-white/10 text-[10px] font-medium text-white rounded-md shadow-sm">
                      {vod.vod_remarks}
                    </span>
                  )}
                </div>

                {vod.vod_score && (
                  <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 backdrop-blur border border-white/10 text-amber-300 text-[10px] font-semibold rounded-md font-mono">
                    ★ {vod.vod_score}
                  </div>
                )}

                {/* Hover Play Button Overlay */}
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

              {/* Title and Category Meta */}
              <div className="pt-2">
                <h3
                  className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary truncate transition-colors"
                  title={vod.vod_name}
                >
                  {vod.vod_name}
                </h3>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                  <span className="truncate">{vod.type_name || '综合'}</span>
                  <span className="truncate opacity-80">{vod.vod_year || vod.vod_area || ''}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !errorMsg && pageCount > 1 && (
        <div className="mt-8 mb-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>上一页</span>
          </Button>

          <span className="px-3 py-1 text-xs text-muted-foreground font-mono">
            {currentPage} / {pageCount}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= pageCount}
          >
            <span>下一页</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
};
