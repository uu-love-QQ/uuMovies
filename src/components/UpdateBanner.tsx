import React from 'react';
import { ArrowUpCircle, Download, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button } from './ui/button';
import {
  checkForUpdates,
  dismissUpdate,
  installUpdate,
  useUpdater,
} from '../lib/updater';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const UpdateBanner: React.FC = () => {
  const state = useUpdater();
  const { info, status, progress, downloaded, total, error, dismissedVersion } = state;

  if (!info || !info.available) return null;
  if (status === 'checking' || status === 'idle' || status === 'up-to-date') return null;
  // A dismissed version stays hidden until the next release.
  if (status === 'available' && dismissedVersion === info.latest_version) return null;

  const busy = status === 'downloading' || status === 'verifying' || status === 'installing';
  const percent = Math.round(progress * 100);
  const canInstall = info.install_supported && Boolean(info.download_url);

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-[380px] max-w-[calc(100vw-3rem)] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in select-none">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="mt-0.5 p-2 rounded-xl bg-primary/10 text-primary">
          <ArrowUpCircle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">发现新版本</h3>
            <span className="px-1.5 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-mono font-semibold">
              v{info.latest_version}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            当前版本 v{info.current_version}
            {info.download_size > 0 ? ` · 安装包 ${formatBytes(info.download_size)}` : ''}
          </p>
        </div>
        {!busy && (
          <button
            onClick={() => dismissUpdate(info.latest_version)}
            className="p-1 -m-1 text-muted-foreground hover:text-foreground rounded-md transition-colors cursor-pointer"
            title="稍后提醒"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {info.notes && (
        <div className="mx-4 mb-3 max-h-24 overflow-y-auto rounded-lg bg-secondary/40 border border-border/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap scrollbar-thin">
          {info.notes}
        </div>
      )}

      {busy && (
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              {status === 'downloading' && <Download className="w-3 h-3" />}
              {status === 'verifying' && <ShieldCheck className="w-3 h-3" />}
              {status === 'installing' && <RefreshCw className="w-3 h-3 animate-spin" />}
              {status === 'downloading' && '正在下载更新包'}
              {status === 'verifying' && '正在校验 SHA-256'}
              {status === 'installing' && '正在安装并重启应用'}
            </span>
            {status === 'downloading' && (
              <span>
                {percent}%
                {total > 0 ? ` · ${formatBytes(downloaded)} / ${formatBytes(total)}` : ''}
              </span>
            )}
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full bg-primary transition-all duration-200 ${
                status !== 'downloading' ? 'animate-pulse' : ''
              }`}
              style={{ width: `${status === 'downloading' ? Math.max(2, percent) : 100}%` }}
            />
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="mx-4 mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-[11px] text-rose-400">
          {error || '更新失败'}
        </div>
      )}

      {!busy && (
        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismissUpdate(info.latest_version)}
            className="text-xs text-muted-foreground"
          >
            稍后
          </Button>
          {status === 'error' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void checkForUpdates(true)}
              className="text-xs gap-1.5"
            >
              <RefreshCw className="w-3 h-3" /> 重新检查
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void installUpdate()}
            className="text-xs gap-1.5"
          >
            {canInstall ? (
              <>
                <Download className="w-3.5 h-3.5" /> 立即更新
              </>
            ) : (
              <>
                <ArrowUpCircle className="w-3.5 h-3.5" /> 前往下载
              </>
            )}
          </Button>
        </div>
      )}

      {status === 'installing' && (
        <div className="flex items-center gap-1.5 px-4 pb-4 text-[11px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          应用即将自动退出，安装完成后会自动重新启动
        </div>
      )}
    </div>
  );
};
