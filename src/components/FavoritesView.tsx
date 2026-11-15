import React, { useState, useEffect } from 'react';
import {
  Bookmark,
  Play,
  Trash2,
  Inbox,
} from 'lucide-react';
import type { FavoriteItem, VodItem } from '../types';
import { api } from '../services/api';
import { LazyImage } from './ui/LazyImage';

interface FavoritesViewProps {
  onSelectVod: (vod: VodItem) => void;
  onQuickPlay: (vod: VodItem) => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  onSelectVod,
  onQuickPlay,
}) => {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadFavorites = () => {
    setIsLoading(true);
    api
      .getFavorites()
      .then((items) => {
        setFavorites(items);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  };

  useEffect(() => {
    loadFavorites();
  }, []);

  const handleRemove = async (item: FavoriteItem) => {
    await api.toggleFavorite(item);
    setFavorites((prev) =>
      prev.filter((f) => !(f.vod_id === item.vod_id && f.source_id === item.source_id))
    );
  };

  const toVodItem = (f: FavoriteItem): VodItem => ({
    vod_id: f.vod_id,
    vod_name: f.vod_name,
    type_id: '',
    type_name: f.type_name || '',
    vod_pic: f.vod_pic,
    vod_remarks: f.vod_remarks,
    vod_year: f.vod_year,
    source_id: f.source_id,
    source_name: f.source_name,
    play_lines: [],
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 select-none animate-fade-in">
      <div className="flex items-center justify-between pb-3 border-b border-border mb-6">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-primary fill-current" />
          <h2 className="text-base font-bold text-foreground">我的收藏</h2>
          <span className="text-xs text-muted-foreground font-mono">({favorites.length})</span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs text-zinc-500">正在读取收藏列表...</div>
      ) : favorites.length === 0 ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">暂无收藏影片</p>
          <p className="text-xs text-muted-foreground mt-1">在影视详情页点击“收藏”按钮即可添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4">
          {favorites.map((fav) => {
            const vod = toVodItem(fav);
            return (
              <div
                key={`${fav.source_id}_${fav.vod_id}`}
                onClick={() => onSelectVod(vod)}
                className="group flex flex-col cursor-pointer select-none"
              >
                <div className="relative w-full aspect-[2/3] bg-card rounded-xl overflow-hidden border border-border transition-all duration-200 group-hover:border-primary/50 group-hover:shadow-lg">
                  <LazyImage
                    src={fav.vod_pic}
                    alt={fav.vod_name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Badges */}
                  {fav.source_name && (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 border border-white/10 text-[10px] font-medium text-white/90 rounded backdrop-blur shadow-sm">
                      {fav.source_name}
                    </div>
                  )}

                  {fav.vod_remarks && (
                    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-black/75 border border-white/10 text-[10px] font-medium text-white rounded backdrop-blur shadow-sm">
                      {fav.vod_remarks}
                    </div>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(fav);
                    }}
                    className="absolute bottom-1.5 right-1.5 p-1 bg-black/75 hover:bg-rose-950 text-white/80 hover:text-rose-300 rounded border border-white/10 transition-colors cursor-pointer shadow-sm"
                    title="取消收藏"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickPlay(vod);
                      }}
                      className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg transition-transform transform scale-90 group-hover:scale-100 active:scale-95 pointer-events-auto cursor-pointer"
                      title="立即播放"
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <h3
                    className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary truncate transition-colors"
                    title={fav.vod_name}
                  >
                    {fav.vod_name}
                  </h3>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                    <span className="truncate">{fav.type_name || '综合'}</span>
                    <span className="truncate opacity-75">{fav.vod_year || ''}</span>
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
