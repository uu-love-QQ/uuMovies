import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Inbox,
  AlertCircle,
  Flame,
  ShieldCheck,
} from 'lucide-react';
import type { Source, VodItem, Category, UserTaxonomyConfig, LocalCategory } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { buildCategoryTree, resolveSemanticTag } from '../lib/taxonomyHelper';
import { fetchVodListWithCache } from '../lib/vodCache';
import { LazyImage } from './ui/LazyImage';

interface CategoriesViewProps {
  activeSource: Source | undefined;
  onSelectVod: (vod: VodItem) => void;
  onQuickPlay: (vod: VodItem) => void;
}

const REGIONS = ['全部', '大陆', '香港', '台湾', '美国', '韩国', '日本', '英国', '法国', '泰国'];
const YEARS = ['全部', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017'];

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  activeSource,
  onSelectVod,
  onQuickPlay,
}) => {
  const [taxonomy, setTaxonomy] = useState<UserTaxonomyConfig | null>(null);
  const [classes, setClasses] = useState<Category[]>([]);
  const [selectedLocalCatId, setSelectedLocalCatId] = useState<string>('all');
  const [selectedSubId, setSelectedSubId] = useState<string>('all');
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [selectedYear, setSelectedYear] = useState<string>('全部');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [items, setItems] = useState<VodItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load user taxonomy and source classes whenever activeSource changes or on mount
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

  // Category Tree Graph for resolving PID cascade and inheritance
  const categoryTree = useMemo(() => {
    return buildCategoryTree(classes);
  }, [classes]);

  // Dynamically resolve local categories, including 18+ channel when adult mode is active
  // Dynamically resolve local categories, filtering out 18+ when adult mode is off
  const displayLocalCategories = useMemo<LocalCategory[]>(() => {
    if (!taxonomy) return [];
    let list = [...taxonomy.categories];
    if (!taxonomy.adult_mode) {
      list = list.filter((c) => !c.bind_tags.includes('#18plus'));
    }
    return list;
  }, [taxonomy]);

  // Selected Local Category object from User's config
  const activeLocalCategory = useMemo<LocalCategory | undefined>(() => {
    if (!taxonomy || selectedLocalCatId === 'all') return undefined;
    return displayLocalCategories.find((c) => c.id === selectedLocalCatId);
  }, [displayLocalCategories, selectedLocalCatId, taxonomy]);

  // Subcategories mapped to the active local category
  // Subcategories mapped to the active local category (excluding container parent categories that have children)
  const mappedSubCategories = useMemo<Category[]>(() => {
    if (!activeLocalCategory) return [];
    const bindTags = activeLocalCategory.bind_tags || [];

    const matched = classes.filter((c) => {
      if (bindTags.includes('#18plus')) {
        if (activeSource?.adult_type_ids?.includes(c.type_id)) {
          return true;
        }
      }
      const resolvedTag = resolveSemanticTag(c.type_id, activeSource, categoryTree);
      return resolvedTag && bindTags.includes(resolvedTag);
    });

    // If there are child classes, exclude container parent categories so Row 2 does not repeat '[电影]'
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

  // Determine effective type_id for AppleCMS query (joining subcategories for 'all' to aggregate complete channel)
  const effectiveTypeId = useMemo(() => {
    if (selectedSubId !== 'all') {
      return selectedSubId;
    }
    if (activeLocalCategory) {
      if (mappedSubCategories.length === 0) {
        return null; // Local category selected, but NO mapped classes exist in this source
      }
      const targetIds = mappedSubCategories.map((c) => c.type_id).filter(Boolean);
      if (targetIds.length > 1) {
        return targetIds.join(',');
      }
      return targetIds[0];
    }
    return undefined; // All channels
  }, [selectedSubId, activeLocalCategory, mappedSubCategories]);

  // Fetch videos with 0ms Stale-While-Revalidate Instant Cache
  useEffect(() => {
    if (!activeSource) return;

    let isMounted = true;
    setErrorMsg(null);

    // If an explicit channel is chosen, but has NO mapped subcategories in this source:
    if (activeLocalCategory && mappedSubCategories.length === 0) {
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
      .then((fresh) => {
        if (!isMounted) return;
        setItems(fresh.list);
        if (fresh.classes && fresh.classes.length > 0) {
          setClasses(fresh.classes);
        }
        setCurrentPage(fresh.page || 1);
        setPageCount(fresh.pagecount || 1);
        setTotalCount(fresh.total || 0);
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
  }, [activeSource, effectiveTypeId, selectedLocalCatId, selectedSubId, currentPage]);

  // Client-side filtering (fuzzy region + year)
  const matchesRegion = (vod: VodItem, reg: string) => {
    if (reg === '全部') return true;
    const text = `${vod.vod_area || ''} ${vod.type_name || ''}`;
    if (reg === '大陆')
      return (
        text.includes('大陆') ||
        text.includes('内地') ||
        text.includes('国产') ||
        text.includes('华语')
      );
    if (reg === '香港') return text.includes('香港') || text.includes('港');
    if (reg === '台湾') return text.includes('台湾') || text.includes('台');
    if (reg === '美国') return text.includes('美国') || text.includes('美') || text.includes('欧美');
    if (reg === '韩国') return text.includes('韩国') || text.includes('韩');
    if (reg === '日本') return text.includes('日本') || text.includes('日');
    if (reg === '泰国') return text.includes('泰国') || text.includes('泰');
    if (reg === '英国') return text.includes('英国') || text.includes('英');
    if (reg === '法国') return text.includes('法国') || text.includes('法');
    return text.includes(reg);
  };

  const matchesYear = (vod: VodItem, yr: string) => {
    if (yr === '全部') return true;
    const text = `${vod.vod_year || ''} ${vod.vod_time || ''}`;
    return text.includes(yr);
  };

  const filteredItems = useMemo(() => {
    return items.filter((vod) => {
      if (!matchesRegion(vod, selectedRegion)) return false;
      if (!matchesYear(vod, selectedYear)) return false;
      return true;
    });
  }, [items, selectedRegion, selectedYear]);

  const handleLocalCategoryChange = (catId: string) => {
    setSelectedLocalCatId(catId);
    setSelectedSubId('all');
    setCurrentPage(1);
  };

  const handleSubChange = (tid: string) => {
    setSelectedSubId(tid);
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
      {/* Modern Card Filter Box (CC-Switch aesthetic) */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5 transition-colors">
        {/* Row 1: 用户自定义标准分类 (Level 1 User Taxonomy) */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-semibold w-16 flex-shrink-0">
            频道主类:
          </span>
          <div className="flex flex-wrap gap-1.5 items-center">
            <button
              onClick={() => handleLocalCategoryChange('all')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                selectedLocalCatId === 'all'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : 'bg-secondary/70 hover:bg-secondary text-secondary-foreground'
              )}
            >
              全部频道
            </button>
            {displayLocalCategories.map((c) => (
              <button
                key={c.id}
                onClick={() => handleLocalCategoryChange(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5',
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
        </div>

        {/* Row 2: 源站映射细分子类 (Level 2 Source Subcategories) */}
        {activeLocalCategory && (
          <div className="flex items-center gap-3 pt-3 border-t border-border/70">
            <span className="text-xs text-muted-foreground font-semibold w-16 flex-shrink-0">
              {activeLocalCategory.name}细分:
            </span>
            {mappedSubCategories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => handleSubChange('all')}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer',
                    selectedSubId === 'all'
                      ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                      : 'bg-secondary/60 hover:bg-secondary text-secondary-foreground'
                  )}
                >
                  全部{activeLocalCategory.name}
                </button>
                {mappedSubCategories.map((sub) => (
                  <button
                    key={sub.type_id}
                    onClick={() => handleSubChange(sub.type_id)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap',
                      selectedSubId === sub.type_id
                        ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                        : 'bg-secondary/60 hover:bg-secondary text-secondary-foreground'
                    )}
                  >
                    {sub.type_name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/80">
                当前采集源尚未为此频道映射细分类别，请在【设置 → 采集源分类映射】中配置
              </span>
            )}
          </div>
        )}

        {/* Row 3: 地区筛选 */}
        <div className="flex items-center gap-3 pt-3 border-t border-border/70">
          <span className="text-xs text-muted-foreground font-semibold w-16 flex-shrink-0">
            地区筛选:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRegion(r)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer',
                  selectedRegion === r
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'bg-secondary/60 hover:bg-secondary text-secondary-foreground'
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Row 4: 年份筛选 */}
        <div className="flex items-center gap-3 pt-3 border-t border-border/70">
          <span className="text-xs text-muted-foreground font-semibold w-16 flex-shrink-0">
            上映年份:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {YEARS.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer',
                  selectedYear === y
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'bg-secondary/60 hover:bg-secondary text-secondary-foreground'
                )}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Meta Bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {activeLocalCategory ? activeLocalCategory.name : '全部频道'}
            {selectedSubId !== 'all' &&
              ` · ${classes.find((s) => s.type_id === selectedSubId)?.type_name}`}
            {selectedRegion !== '全部' && ` · ${selectedRegion}`}
            {selectedYear !== '全部' && ` · ${selectedYear}`}
          </span>
          <span className="text-muted-foreground/80 font-mono">({totalCount} 部)</span>
        </div>

        <div className="flex items-center gap-2">
          {taxonomy?.adult_mode ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/10 border border-rose-500/30 text-rose-500 font-mono font-medium flex items-center gap-1">
              <Flame className="w-3 h-3 text-rose-500" /> 18+ 模式已开启
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono font-medium flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-500" /> 未成年人内容保护
            </span>
          )}
          <span className="font-mono text-muted-foreground">
            第 {currentPage} / {pageCount} 页
          </span>
        </div>
      </div>

      {/* Grid */}
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
          <h3 className="text-sm font-semibold text-foreground mb-1">分类加载失败</h3>
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
      ) : filteredItems.length === 0 ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">
            {activeLocalCategory && mappedSubCategories.length === 0
              ? `【${activeLocalCategory.name}】在此采集源下未绑定映射分类`
              : '未找到符合当前条件的影视资源'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {activeLocalCategory && mappedSubCategories.length === 0
              ? '当前采集源尚未将任何分类映射至该频道，您可在【设置 → 采集源分类映射】中进行绑定'
              : '若所选分类涉及成人分级或已被屏蔽，可在设置中调整规则'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {filteredItems.map((vod) => (
            <div
              key={vod.vod_id}
              onClick={() => onSelectVod(vod)}
              className="group flex flex-col cursor-pointer select-none"
            >
              {/* Poster with Lazy Loading & Hover Play */}
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
