import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Trash2,
  FolderOpen,
  Film,
  AlertCircle,
  HardDrive,
  RefreshCw,
  Inbox,
} from 'lucide-react';
import type { DownloadTask, VodItem } from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface DownloadsViewProps {
  onPlayLocal: (vod: VodItem, localPath: string) => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({ onPlayLocal }) => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [downloadDir, setDownloadDir] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'downloading' | 'completed'>('all');
  const timerRef = useRef<number | null>(null);

  const fetchTasks = async () => {
    try {
      const list = await api.getDownloadTasks();
      setTasks(list);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTasks();
    api.getDefaultDownloadDir().then(setDownloadDir).catch(console.error);

    timerRef.current = window.setInterval(fetchTasks, 1000);
    return () => {
      clearInterval(timerRef.current!);
    };
  }, []);

  const handlePause = async (taskId: string) => {
    await api.pauseDownloadTask(taskId);
    fetchTasks();
  };

  const handleResume = async (taskId: string) => {
    await api.startDownloadTask(taskId);
    fetchTasks();
  };

  const handleDelete = async (taskId: string, deleteFile: boolean = false) => {
    if (!confirm(deleteFile ? '确定要删除此任务并清理本地视频文件吗？' : '确定要删除此下载记录吗？')) {
      return;
    }
    await api.deleteDownloadTask(taskId, deleteFile);
    fetchTasks();
  };

  const handleOpenDir = async (path: string) => {
    await api.openDownloadDir(path);
  };

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(1)} ${units[idx]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec < 1024 * 1024) {
      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    }
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const handlePlayDownloaded = (task: DownloadTask) => {
    const vod: VodItem = {
      vod_id: task.vod_id,
      vod_name: task.vod_name,
      type_id: '',
      type_name: '本地视频',
      vod_pic: task.vod_pic,
      play_lines: [
        {
          from: 'local',
          title: '离线存储',
          episodes: [
            {
              name: task.episode_name,
              url: task.file_path,
            },
          ],
        },
      ],
    };
    onPlayLocal(vod, task.file_path);
  };

  const downloadingTasks = tasks.filter((t) => t.status === 'downloading' || t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const filteredTasks = tasks.filter((t) => {
    if (activeTab === 'downloading') {
      return t.status === 'downloading' || t.status === 'pending' || t.status === 'paused';
    }
    if (activeTab === 'completed') {
      return t.status === 'completed';
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 select-none animate-fade-in">
      {/* Top Header Card */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <span>离线下载管理</span>
            <span className="text-xs text-muted-foreground font-mono">({tasks.length})</span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 font-mono">
            <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="truncate max-w-xs sm:max-w-md">{downloadDir || '默认目录'}</span>
            {downloadDir && (
              <button
                onClick={() => handleOpenDir(downloadDir)}
                className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1 cursor-pointer font-sans"
              >
                <FolderOpen className="w-3 h-3" /> 打开
              </button>
            )}
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center bg-secondary/80 p-0.5 rounded-lg border border-border self-start md:self-center">
          <button
            onClick={() => setActiveTab('all')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'all'
                ? 'bg-card text-foreground font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            全部 ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('downloading')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'downloading'
                ? 'bg-card text-foreground font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            下载中 ({downloadingTasks.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'completed'
                ? 'bg-card text-foreground font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            已完成 ({completedTasks.length})
          </button>
        </div>
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="py-28 flex flex-col items-center justify-center text-center text-muted-foreground bg-card border border-border rounded-2xl p-8">
          <Inbox className="w-8 h-8 mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">暂无下载任务</p>
          <p className="text-xs text-muted-foreground mt-1">在影视详情页中点击分集右侧的下载按钮即可离线下载</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredTasks.map((task) => {
            const isCompleted = task.status === 'completed';
            const isDownloading = task.status === 'downloading';
            const isError = task.status === 'error';

            return (
              <div
                key={task.id}
                className="bg-card border border-border hover:border-primary/50 shadow-sm rounded-2xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Poster & Title */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-12 aspect-[2/3] rounded-md overflow-hidden bg-secondary border border-border flex-shrink-0">
                    {task.vod_pic ? (
                      <img
                        src={task.vod_pic}
                        alt={task.vod_name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground opacity-50">
                        <Film className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-xs sm:text-sm font-semibold text-foreground truncate">
                        {task.vod_name}
                      </h4>
                      <span className="text-xs px-1.5 py-0.2 rounded bg-secondary text-secondary-foreground font-medium">
                        {task.episode_name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">({task.line_title})</span>
                    </div>

                    {/* Progress Bar & Details */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono mb-1">
                        <span>
                          {isCompleted
                            ? formatBytes(task.downloaded_bytes)
                            : `${formatBytes(task.downloaded_bytes)} / ${
                                task.total_bytes > 0 ? formatBytes(task.total_bytes) : '计算中'
                              }`}
                        </span>
                        <div className="flex items-center gap-2">
                          {isDownloading && (
                            <span className="text-emerald-400 font-medium">
                              {formatSpeed(task.speed_bytes_per_sec)}
                            </span>
                          )}
                          <span>{task.progress.toFixed(1)}%</span>
                        </div>
                      </div>

                      <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-300',
                            isCompleted
                              ? 'bg-zinc-200'
                              : isError
                              ? 'bg-rose-500'
                              : 'bg-zinc-300'
                          )}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>

                      {task.error_msg && (
                        <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" />
                          <span>{task.error_msg}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  {isCompleted ? (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handlePlayDownloaded(task)}
                        className="gap-1.5"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>播放</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDir(task.file_path)}
                        title="打开所在文件夹"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : isDownloading ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handlePause(task.id)}
                      className="gap-1.5"
                    >
                      <Pause className="w-3 h-3 fill-current" />
                      <span>暂停</span>
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleResume(task.id)}
                      className="gap-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>继续</span>
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(task.id, isCompleted)}
                    title="删除"
                    className="hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
