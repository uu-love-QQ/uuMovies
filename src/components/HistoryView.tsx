import React, { useState, useEffect } from 'react';
import {
  Clock,
  Play,
  Trash2,
  Inbox,
} from 'lucide-react';
import type { PlayHistoryItem, VodItem } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { LazyImage } from './ui/LazyImage';

interface HistoryViewProps {
  onResumePlay: (vod: VodItem, lineIdx: number, epIdx: number, initialTime: number) => void;
  onSelectVod: (vod: VodItem) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  onResumePlay,
  onSelectVod,
}) => {
  const [history, setHistory] = useState<PlayHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = () => {
    setIsLoading(true);
    api
      .getHistory()
      .then((items) => {
        setHistory(items);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleRemove = async (vodId: string, sourceId: string) => {
    await api.removeHistoryItem(vodId, sourceId);
    setHistory((prev) => prev.filter((h) => !(h.vod_id === vodId && h.source_id === sourceId)));
  };

  const handleClearAll = async () => {
    if (!confirm('确定要清空所有播放记录吗？')) return;
    await api.clearHistory();
    setHistory([]);
  };

  const formatSeconds = (sec: number) => {
    if (isNaN(sec) || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Math.floor(Date.now() / 1000) - timestamp;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  };

  const constructVodItem = (h: PlayHistoryItem): VodItem => ({
    vod_id: h.vod_id,
    vod_name: h.vod_name,
    type_id: '',
    type_name: '',
    vod_pic: h.vod_pic,
    source_id: h.source_id,
    source_name: h.source_name,
    play_lines: [],
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 select-none animate-fade-in">
      <div className="flex items-center justify-between pb-3 border-b border-border mb-6">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-foreground">观看历史</h2>
          <span className="text-xs text-muted-foreground font-mono">({history.length})</span>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-xs text-zinc-500 hover:text-rose-400 gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空全部</span>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs text-zinc-500">正在读取历史记录...</div>
      ) : history.length === 0 ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">暂无观看历史</p>
          <p className="text-xs text-muted-foreground mt-1">观看过的影视剧集会自动记录进度</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {history.map((item) => {
            const pct =
              item.duration_seconds > 0
                ? Math.min(100, Math.floor((item.progress_seconds / item.duration_seconds) * 100))
                : 0;

            const vod = constructVodItem(item);

            return (
              <div
                key={`${item.source_id}_${item.vod_id}`}
                className="group relative bg-card border border-border hover:border-primary/50 shadow-sm rounded-2xl p-3 flex gap-3.5 transition-all"
              >
                {/* Thumbnail */}
                <div
                  onClick={() => onSelectVod(vod)}
                  className="relative flex-shrink-0 w-20 aspect-[2/3] rounded-xl overflow-hidden bg-secondary border border-border cursor-pointer"
                >
                  <LazyImage
                    src={item.vod_pic}
                    alt={item.vod_name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-5 h-5 text-white fill-current ml-0.5" />
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 flex flex-col justify-between min-w-0">
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <h3
                        onClick={() => onSelectVod(vod)}
                        className="text-xs sm:text-sm font-medium text-foreground hover:text-primary truncate cursor-pointer transition-colors"
                        title={item.vod_name}
                      >
                        {item.vod_name}
                      </h3>
                      <button
                        onClick={() => handleRemove(item.vod_id, item.source_id)}
                        className="p-1 text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                        title="删除记录"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 text-xs">
                      <span className="text-foreground/90 font-medium truncate">
                        {item.episode_name}
                      </span>
                      <span className="text-muted-foreground opacity-50">·</span>
                      <span className="text-muted-foreground text-[11px] truncate">{item.source_name}</span>
                    </div>

                    {/* Progress */}
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mb-1">
                        <span>{formatSeconds(item.progress_seconds)} / {formatSeconds(item.duration_seconds)}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/80">
                    <span className="text-[10px] text-zinc-500">
                      {formatRelativeTime(item.updated_at)}
                    </span>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() =>
                        onResumePlay(vod, item.line_index, item.episode_index, item.progress_seconds)
                      }
                      className="h-7 px-2.5 text-xs gap-1"
                    >
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                      <span>续播</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
