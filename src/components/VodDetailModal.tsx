import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Bookmark,
  Calendar,
  MapPin,
  Film,
  Download,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
} from 'lucide-react';
import type { VodItem, PlayHistoryItem, DoubanMetadata, PlayLine } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

interface VodDetailModalProps {
  vod: VodItem;
  onClose: () => void;
  onPlay: (vod: VodItem, lineIdx: number, epIdx: number, initialTime?: number) => void;
}

export const VodDetailModal: React.FC<VodDetailModalProps> = ({
  vod,
  onClose,
  onPlay,
}) => {
  const [selectedLineIdx, setSelectedLineIdx] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [historyItem, setHistoryItem] = useState<PlayHistoryItem | null>(null);
  const [expandContent, setExpandContent] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [fullDetail, setFullDetail] = useState<VodItem>(vod);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [downloadToast, setDownloadToast] = useState<string | null>(null);
  const [doubanMeta, setDoubanMeta] = useState<DoubanMetadata | null>(null);
  const [isLoadingCrossLines, setIsLoadingCrossLines] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (vod.source_id && (!vod.play_lines || vod.play_lines.length === 0)) {
      setIsLoadingDetail(true);
      api
        .fetchVodDetail(vod.source_id, vod.vod_id)
        .then((detail) => {
          if (isMounted) {
            setFullDetail(detail);
            setIsLoadingDetail(false);
          }
        })
        .catch(() => {
          if (isMounted) setIsLoadingDetail(false);
        });
    } else {
      setFullDetail(vod);
    }
    return () => {
      isMounted = false;
    };
  }, [vod]);

  // Fetch Douban authoritative metadata and cross-station lines
  useEffect(() => {
    let isMounted = true;

    // 1. Authoritative Douban metadata
    api.getDoubanMetadata(vod.vod_name).then((meta) => {
      if (isMounted) setDoubanMeta(meta);
    }).catch(() => {});

    // 2. Cross-station line aggregation
    setIsLoadingCrossLines(true);
    api.aggregateCrossStationLines(vod.vod_name, vod.source_id).then((crossLines) => {
      if (!isMounted) return;
      setIsLoadingCrossLines(false);
      if (crossLines.length > 0) {
        // Merge cross-station lines into fullDetail
        setFullDetail((prev) => {
          const playLines: PlayLine[] = crossLines.map((cl) => ({
            from: cl.source_id,
            title: cl.full_title,
            episodes: cl.episodes,
          }));
          return { ...prev, play_lines: playLines };
        });
      }
    }).catch(() => {
      if (isMounted) setIsLoadingCrossLines(false);
    });

    return () => {
      isMounted = false;
    };
  }, [vod.vod_name, vod.source_id]);

  useEffect(() => {
    api.getFavorites().then((favs) => {
      setIsFavorited(
        favs.some((f) => f.vod_id === vod.vod_id && f.source_id === vod.source_id)
      );
    });

    api.getHistory().then((hist) => {
      const found = hist.find(
        (h) => h.vod_id === vod.vod_id && h.source_id === vod.source_id
      );
      if (found) setHistoryItem(found);
    });
  }, [vod]);

  const toggleFavorite = async () => {
    const res = await api.toggleFavorite({
      vod_id: fullDetail.vod_id,
      source_id: fullDetail.source_id || '',
      source_name: fullDetail.source_name || '默认源',
      vod_name: fullDetail.vod_name,
      vod_pic: fullDetail.vod_pic,
      vod_remarks: fullDetail.vod_remarks,
      type_name: fullDetail.type_name,
      vod_year: fullDetail.vod_year,
      created_at: Math.floor(Date.now() / 1000),
    });
    setIsFavorited(res);
  };

  const handleDownload = async (ep: { name: string; url: string }) => {
    try {
      await api.addDownloadTask({
        vodId: fullDetail.vod_id,
        vodName: fullDetail.vod_name,
        vodPic: fullDetail.vod_pic,
        lineTitle: currentLine ? currentLine.title : '默认线路',
        episodeName: ep.name,
        url: ep.url,
      });
      setDownloadToast(`已加入下载: ${ep.name}`);
      setTimeout(() => setDownloadToast(null), 2500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '下载添加失败';
      setDownloadToast(`下载失败: ${msg}`);
      setTimeout(() => setDownloadToast(null), 2500);
    }
  };

  const currentLine = fullDetail.play_lines[selectedLineIdx];
  const episodes = currentLine ? [...currentLine.episodes] : [];
  if (sortOrder === 'desc') {
    episodes.reverse();
  }

  const cleanContent = (fullDetail.vod_content || '暂无剧情简介')
    .replace(/<[^>]*>/g, '')
    .trim();

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto animate-fade-in select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden my-8 text-foreground"
      >
        {/* Toast */}
        {downloadToast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border text-foreground rounded-md text-xs font-medium shadow-lg animate-fade-in">
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            <span>{downloadToast}</span>
          </div>
        )}

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-1.5 bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-md border border-border transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Hero Details */}
        <div className="p-6 flex flex-col sm:flex-row gap-6 border-b border-border">
          {/* Poster */}
          <div className="relative flex-shrink-0 w-40 sm:w-44 aspect-[2/3] rounded-xl overflow-hidden bg-secondary border border-border self-center sm:self-start">
            {fullDetail.vod_pic || doubanMeta?.poster ? (
              <img
                src={fullDetail.vod_pic || doubanMeta?.poster}
                alt={fullDetail.vod_name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                <Film className="w-8 h-8 mb-1" />
                <span className="text-xs">无海报</span>
              </div>
            )}
            {fullDetail.vod_remarks && (
              <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-zinc-950/80 border border-white/10 text-zinc-300 text-[10px] font-medium rounded">
                {fullDetail.vod_remarks}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 flex flex-col justify-between min-w-0">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">
                  {doubanMeta?.canonical_title || fullDetail.vod_name}
                </h1>
                {doubanMeta && doubanMeta.canonical_title !== fullDetail.vod_name && (
                  <span className="text-xs text-muted-foreground">
                    (源站名称: {fullDetail.vod_name})
                  </span>
                )}
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2 mb-3">
                {doubanMeta?.rate ? (
                  <Badge variant="amber" className="font-mono text-xs gap-1">
                    <span>豆瓣</span>
                    <span>{doubanMeta.rate}</span>
                  </Badge>
                ) : fullDetail.vod_score ? (
                  <Badge variant="amber" className="font-mono text-xs">
                    ★ {fullDetail.vod_score}
                  </Badge>
                ) : null}
                {fullDetail.source_name && (
                  <Badge variant="outline" className="text-muted-foreground border-border">
                    {fullDetail.source_name}
                  </Badge>
                )}
                {fullDetail.type_name && (
                  <Badge variant="secondary">{fullDetail.type_name}</Badge>
                )}
                {fullDetail.vod_year && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-0.5 bg-secondary/80 rounded border border-border">
                    <Calendar className="w-3 h-3 text-muted-foreground" />
                    {fullDetail.vod_year}
                  </span>
                )}
                {fullDetail.vod_area && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground px-2 py-0.5 bg-secondary/80 rounded border border-border">
                    <MapPin className="w-3 h-3 text-muted-foreground" />
                    {fullDetail.vod_area}
                  </span>
                )}
              </div>

              {/* Director & Cast */}
              <div className="space-y-1 text-xs text-muted-foreground mb-3">
                {fullDetail.vod_director && (
                  <p className="truncate">
                    <span className="opacity-75">导演: </span>
                    <span className="text-foreground">{fullDetail.vod_director}</span>
                  </p>
                )}
                {fullDetail.vod_actor && (
                  <p className="line-clamp-2">
                    <span className="opacity-75">主演: </span>
                    <span className="text-foreground">{fullDetail.vod_actor}</span>
                  </p>
                )}
              </div>

              {/* Synopsis */}
              <div className="text-xs text-muted-foreground leading-relaxed">
                <p className={expandContent ? '' : 'line-clamp-3'}>{cleanContent}</p>
                {cleanContent.length > 100 && (
                  <button
                    onClick={() => setExpandContent(!expandContent)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 mt-1 inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    {expandContent ? (
                      <>收起 <ChevronUp className="w-3 h-3" /></>
                    ) : (
                      <>展开剧情 <ChevronDown className="w-3 h-3" /></>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Action Buttons (shadcn style) */}
            <div className="flex items-center gap-2.5 pt-4 border-t border-zinc-800/60 mt-4">
              {historyItem ? (
                <Button
                  variant="default"
                  size="default"
                  onClick={() =>
                    onPlay(
                      fullDetail,
                      historyItem.line_index,
                      historyItem.episode_index,
                      historyItem.progress_seconds
                    )
                  }
                  className="gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>续播 ({historyItem.episode_name})</span>
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="default"
                  disabled={!currentLine || currentLine.episodes.length === 0}
                  onClick={() => onPlay(fullDetail, selectedLineIdx, 0)}
                  className="gap-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>立即播放</span>
                </Button>
              )}

              <Button
                variant={isFavorited ? 'secondary' : 'outline'}
                size="default"
                onClick={toggleFavorite}
                className="gap-1.5"
              >
                <Bookmark className={cn('w-4 h-4', isFavorited ? 'fill-current text-zinc-100' : '')} />
                <span>{isFavorited ? '已收藏' : '收藏'}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Episodes Selection */}
        <div className="p-6 bg-secondary/20">
          {isLoadingDetail ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              正在获取剧集列表...
            </div>
          ) : fullDetail.play_lines.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              暂无可播放的线路
            </div>
          ) : (
            <div>
              {/* Lines & Sort */}
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
                  <span className="text-xs text-zinc-500 font-medium mr-1.5 flex items-center gap-1 flex-shrink-0">
                    <Globe className="w-3.5 h-3.5 text-zinc-400" />
                    <span>全网播放线路:</span>
                  </span>
                  {isLoadingCrossLines && (
                    <span className="text-[10px] text-zinc-500 animate-pulse whitespace-nowrap mr-2">
                      正在聚合其它资源站...
                    </span>
                  )}
                  {fullDetail.play_lines.map((line, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedLineIdx(idx)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                        idx === selectedLineIdx
                          ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                          : 'bg-secondary hover:bg-secondary/80 border border-border text-foreground'
                      )}
                    >
                      {line.title}
                      <span className="ml-1 opacity-60">({line.episodes.length})</span>
                    </button>
                  ))}
                </div>

                {episodes.length > 1 && (
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 bg-secondary border border-border rounded-md cursor-pointer"
                  >
                    {sortOrder === 'asc' ? '正序 (1-N)' : '倒序 (N-1)'}
                  </button>
                )}
              </div>

              {/* Episodes Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                {episodes.map((ep, originalIdx) => {
                  const actualIdx =
                    sortOrder === 'asc' ? originalIdx : episodes.length - 1 - originalIdx;
                  const isCurrentHistory =
                    historyItem &&
                    historyItem.line_index === selectedLineIdx &&
                    historyItem.episode_index === actualIdx;

                  return (
                    <div
                      key={actualIdx}
                      className={cn(
                        'group relative rounded-md text-xs border transition-colors flex items-center justify-between',
                        isCurrentHistory
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border bg-card hover:bg-secondary hover:border-border text-foreground'
                      )}
                    >
                      <button
                        onClick={() => onPlay(fullDetail, selectedLineIdx, actualIdx)}
                        className="flex-1 py-2 pl-2.5 pr-1 text-left truncate cursor-pointer"
                        title={ep.name}
                      >
                        <span className="truncate">{ep.name}</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(ep);
                        }}
                        className="p-1.5 opacity-40 group-hover:opacity-100 hover:text-white transition-opacity cursor-pointer"
                        title="下载此集"
                      >
                        <Download className="w-3 h-3" />
                      </button>

                      {isCurrentHistory && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
