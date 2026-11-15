import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume1,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
  Layers,
  X,
  AlertCircle,
  Clock,
  Sparkles,
  Tv,
  RotateCw,
  Minus,
  Square,
} from 'lucide-react';
import type { VodItem, PlayLine, Episode, DlnaDevice } from '../types';
import { api, isRunningInTauri } from '../services/api';
import { convertFileSrc } from '@tauri-apps/api/core';
import { createAdFilterPlaylistLoader } from '../lib/m3u8Filter';

interface PlayerModalProps {
  vod: VodItem;
  initialLineIndex?: number;
  initialEpisodeIndex?: number;
  initialTime?: number;
  onClose: () => void;
}

export const PlayerModal: React.FC<PlayerModalProps> = ({
  vod,
  initialLineIndex = 0,
  initialEpisodeIndex = 0,
  initialTime = 0,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const activeStreamUrlRef = useRef<string>('');
  const userSeekedRef = useRef<boolean>(false);
  const resumeTimeRef = useRef<number | null>(null);
  const hasResumed = useRef<boolean>(false);
  const hideControlsTimeout = useRef<number | null>(null);

  const [playLines, setPlayLines] = useState<PlayLine[]>(vod.play_lines);
  const [currentLineIdx, setCurrentLineIdx] = useState(
    Math.min(initialLineIndex, Math.max(0, vod.play_lines.length - 1))
  );
  const [currentEpIdx, setCurrentEpIdx] = useState(initialEpisodeIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [volumeNotice, setVolumeNotice] = useState<number | null>(null);
  const volumeNoticeTimer = useRef<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [showLineMenu, setShowLineMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [skipIntroSec, setSkipIntroSec] = useState(0);
  const [skipOutroSec, setSkipOutroSec] = useState(0);

  const [showCastModal, setShowCastModal] = useState(false);
  const [castDevices, setCastDevices] = useState<DlnaDevice[]>([]);
  const [isSearchingCast, setIsSearchingCast] = useState(false);
  const [activeCastDevice, setActiveCastDevice] = useState<DlnaDevice | null>(null);
  const [castError, setCastError] = useState<string | null>(null);

  const searchCastDevices = async () => {
    setIsSearchingCast(true);
    setCastError(null);
    try {
      const devs = await api.discoverDlnaDevices();
      setCastDevices(devs);
    } catch (e: unknown) {
      setCastError(e instanceof Error ? e.message : '搜索投屏设备失败');
    } finally {
      setIsSearchingCast(false);
    }
  };

  const handleCastToDevice = async (device: DlnaDevice) => {
    if (!currentEpisode) return;
    try {
      setCastError(null);
      const videoTitle = `${vod.vod_name} ${currentEpisode.name}`.trim();
      await api.castToDlnaDevice(device, videoTitle, currentEpisode.url);
      setActiveCastDevice(device);
      if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
      setShowCastModal(false);
    } catch (e: unknown) {
      setCastError(e instanceof Error ? e.message : '投屏失败');
    }
  };

  const handleStopCast = async () => {
    if (!activeCastDevice) return;
    try {
      await api.stopDlnaCast(activeCastDevice.control_url);
    } catch (e) {
      // Ignore
    }
    setActiveCastDevice(null);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isFullscreen || document.fullscreenElement) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, [data-no-drag]')) return;
    api.dragWindow();
  };

  const handleTopBarDoubleClick = (e: React.MouseEvent) => {
    if (isFullscreen || document.fullscreenElement) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, [data-no-drag]')) return;
    api.toggleMaximizeWindow();
  };
  const [longPressAction, setLongPressAction] = useState<'speed_up' | 'continuous_seek'>('speed_up');
  const [isSpeedingUp, setIsSpeedingUp] = useState(false);
  const normalSpeedRef = useRef(1.0);
  const isLongPressingRef = useRef(false);
  const longPressTimerRef = useRef<any>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  useEffect(() => {
    api.getSettings().then((s) => {
      if (s.playback_rate && s.playback_rate !== 1.0) {
        setPlaybackRate(s.playback_rate);
        if (videoRef.current) videoRef.current.playbackRate = s.playback_rate;
      }
      if (s.skip_intro_seconds) setSkipIntroSec(s.skip_intro_seconds);
      if (s.skip_outro_seconds) setSkipOutroSec(s.skip_outro_seconds);
      if (s.long_press_action) setLongPressAction(s.long_press_action);
    }).catch(console.error);
  }, []);
  // Fetch cross-station lines in parallel and merge without resetting current lines
  useEffect(() => {
    let isMounted = true;
    api.aggregateCrossStationLines(vod.vod_name, vod.source_id).then((lines) => {
      if (!isMounted || lines.length === 0) return;
      const otherLines: PlayLine[] = lines.map((cl) => ({
        from: cl.source_id,
        title: cl.full_title,
        episodes: cl.episodes,
      }));
      setPlayLines((prev) => {
        const existingKeys = new Set(
          prev.map((l) => `${l.from || ''}__${l.title || ''}`)
        );
        const toAdd = otherLines.filter(
          (l) => !existingKeys.has(`${l.from || ''}__${l.title || ''}`)
        );
        if (toAdd.length === 0) return prev;
        return [...prev, ...toAdd];
      });
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [vod.vod_name, vod.source_id]);
  const currentLine: PlayLine | undefined = playLines[currentLineIdx] || vod.play_lines[currentLineIdx];
  const currentEpisode: Episode | undefined = currentLine?.episodes[currentEpIdx];

  const switchLine = (newLineIdx: number) => {
    const currentVideo = videoRef.current;
    const prevTime = currentVideo ? currentVideo.currentTime : 0;
    if (currentVideo) {
      saveProgress(currentVideo.currentTime, currentVideo.duration);
    }
    setCurrentLineIdx(newLineIdx);
    setShowLineMenu(false);
    setErrorMsg(null);
    hasResumed.current = false;
    userSeekedRef.current = false;
    resumeTimeRef.current = prevTime;
    activeStreamUrlRef.current = '';
  };

  // Format time (seconds -> mm:ss or hh:mm:ss)
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Save playback history
  const saveProgress = useCallback(
    (timeToSave: number, durToSave: number) => {
      if (!currentEpisode || timeToSave <= 0) return;
      api.saveHistoryItem({
        vod_id: vod.vod_id,
        source_id: vod.source_id || '',
        source_name: vod.source_name || '默认源',
        vod_name: vod.vod_name,
        vod_pic: vod.vod_pic,
        line_index: currentLineIdx,
        episode_index: currentEpIdx,
        episode_name: currentEpisode.name,
        play_url: currentEpisode.url,
        progress_seconds: Math.floor(timeToSave),
        duration_seconds: Math.floor(durToSave || 0),
        updated_at: Math.floor(Date.now() / 1000),
      }).catch(console.error);
    },
    [vod, currentLineIdx, currentEpIdx, currentEpisode]
  );

  const currentStreamUrl = currentEpisode?.url.trim() || '';

  // Initialize and load stream URL without restarting if URL is unchanged
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStreamUrl) return;

    let streamUrl = currentStreamUrl;
    const isLocal = !streamUrl.startsWith('http://') && !streamUrl.startsWith('https://');
    if (isLocal && isRunningInTauri()) {
      try {
        streamUrl = convertFileSrc(streamUrl);
      } catch (e) {
        console.error('Failed to convert local file url:', e);
      }
    }

    // Guard against redundant reinitialization if the exact stream URL is already active
    if (activeStreamUrlRef.current === streamUrl && hlsRef.current) {
      return;
    }
    activeStreamUrlRef.current = streamUrl;

    setErrorMsg(null);
    hasResumed.current = false;
    userSeekedRef.current = false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isInitialEpisode = currentEpIdx === initialEpisodeIndex && currentLineIdx === initialLineIndex;
    const targetStartTime = resumeTimeRef.current !== null
      ? resumeTimeRef.current
      : isInitialEpisode
      ? (initialTime <= 5 && skipIntroSec > 0 ? skipIntroSec : initialTime)
      : (skipIntroSec > 0 ? skipIntroSec : 0);

    const applyResumeTime = () => {
      if (userSeekedRef.current) {
        // User has already seeked manually! Do not overwrite their progress!
        return;
      }
      if (targetStartTime > 0 && !hasResumed.current) {
        video.currentTime = targetStartTime;
        hasResumed.current = true;
        resumeTimeRef.current = null;
        const isIntro = isInitialEpisode && initialTime <= 5 && skipIntroSec > 0;
        setResumeNotice(
          isIntro
            ? `已为您智能跳过片头 ${skipIntroSec} 秒`
            : `已自动为您续播至 ${formatTime(targetStartTime)}`
        );
        setTimeout(() => setResumeNotice(null), 4000);
      }
    };

    if (!isLocal && Hls.isSupported() && (streamUrl.includes('.m3u8') || !streamUrl.includes('.mp4'))) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        pLoader: createAdFilterPlaylistLoader(),
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        applyResumeTime();
        video.play().catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setErrorMsg('网络播放流获取失败，请尝试切换播放线路或重试');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setErrorMsg('媒体流解码错误，正在尝试自动恢复...');
              hls.recoverMediaError();
              break;
            default:
              setErrorMsg('播放异常，请尝试切换其它线路');
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple HLS (Safari / WebKit)
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        applyResumeTime();
        video.play().catch(() => setIsPlaying(false));
      }, { once: true });
    } else {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        applyResumeTime();
      }, { once: true });
      video.play().catch(() => setIsPlaying(false));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentStreamUrl, currentLineIdx, currentEpIdx]);

  // Periodic history autosave
  useEffect(() => {
    const timer = setInterval(() => {
      if (videoRef.current && isPlaying) {
        saveProgress(videoRef.current.currentTime, videoRef.current.duration);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [isPlaying, saveProgress]);

  // Handle controls auto-hide
  const triggerUserActivity = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      window.clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = window.setTimeout(() => {
      if (isPlaying && !showEpisodesDrawer && !showLineMenu && !showSpeedMenu) {
        setShowControls(false);
      }
    }, 3500);
  }, [isPlaying, showEpisodesDrawer, showLineMenu, showSpeedMenu]);

  // Video element events
  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    setDuration(video.duration || 0);

    if (video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      setBuffered(bufferedEnd);
    }

    if (
      skipOutroSec > 0 &&
      video.duration > 60 &&
      video.duration - video.currentTime <= skipOutroSec
    ) {
      playNextEpisode();
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  // Single click toggles playback, double click toggles fullscreen. The single
  // click is deferred so a double click never toggles playback twice.
  const clickTimerRef = useRef<number | null>(null);

  const handleVideoClick = () => {
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 220);
  };

  const handleVideoDoubleClick = () => {
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleFullscreen();
  };

  const calculateTimeFromEvent = (clientX: number) => {
    if (!progressRef.current || duration <= 0) return 0;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    return ratio * duration;
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const newTime = calculateTimeFromEvent(e.clientX);
    userSeekedRef.current = true;
    hasResumed.current = true;
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    userSeekedRef.current = true;
    hasResumed.current = true;
    const newTime = calculateTimeFromEvent(e.clientX);
    setDragTime(newTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration <= 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    setHoverX(x);
    setHoverTime(ratio * duration);

    if (isDragging) {
      setDragTime(ratio * duration);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      userSeekedRef.current = true;
      hasResumed.current = true;
      const finalTime = calculateTimeFromEvent(e.clientX);
      if (videoRef.current) {
        videoRef.current.currentTime = finalTime;
        setCurrentTime(finalTime);
      }
    }
  };

  const adjustVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted && delta > 0) {
      video.muted = false;
      setIsMuted(false);
    }
    const currentVol = isMuted ? 0 : video.volume;
    const newVol = Math.round(Math.min(1, Math.max(0, currentVol + delta)) * 100) / 100;
    video.volume = newVol;
    setVolume(newVol);
    if (newVol === 0) {
      video.muted = true;
      setIsMuted(true);
    } else {
      video.muted = false;
      setIsMuted(false);
    }
    setVolumeNotice(Math.round(newVol * 100));
    if (volumeNoticeTimer.current) clearTimeout(volumeNoticeTimer.current);
    volumeNoticeTimer.current = window.setTimeout(() => setVolumeNotice(null), 1200);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
    setVolumeNotice(Math.round(val * 100));
    if (volumeNoticeTimer.current) clearTimeout(volumeNoticeTimer.current);
    volumeNoticeTimer.current = window.setTimeout(() => setVolumeNotice(null), 1200);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted) {
      video.muted = false;
      setIsMuted(false);
      const restoredVol = volume || 0.5;
      video.volume = restoredVol;
      setVolumeNotice(Math.round(restoredVol * 100));
    } else {
      video.muted = true;
      setIsMuted(true);
      setVolumeNotice(0);
    }
    if (volumeNoticeTimer.current) clearTimeout(volumeNoticeTimer.current);
    volumeNoticeTimer.current = window.setTimeout(() => setVolumeNotice(null), 1200);
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
  };

  // A webview can leave fullscreen without our code running (native Esc key,
  // OS gesture, window focus loss). Never trust only the promise results:
  // always mirror the real DOM fullscreen element.
  const getFullscreenElement = (): Element | null =>
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ||
    null;

  const syncFullscreenState = useCallback(() => {
    setIsFullscreen(Boolean(getFullscreenElement()));
  }, []);

  useEffect(() => {
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    window.addEventListener('focus', syncFullscreenState);
    window.addEventListener('resize', syncFullscreenState);
    syncFullscreenState();
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      window.removeEventListener('focus', syncFullscreenState);
      window.removeEventListener('resize', syncFullscreenState);
    };
  }, [syncFullscreenState]);

  // Always exit fullscreen when the player unmounts, otherwise the removed
  // fullscreen element can leave the desktop window stuck in a black fullscreen.
  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (getFullscreenElement()) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          const webkitExit = (document as Document & {
            webkitExitFullscreen?: () => Promise<void> | void;
          }).webkitExitFullscreen;
          await webkitExit?.();
        }
      }
    } catch (e) {
      console.warn('exitFullscreen failed:', e);
    } finally {
      // Re-read the real state: a stale `true` must never resurrect fullscreen.
      syncFullscreenState();
      setShowControls(true);
    }
  }, [syncFullscreenState]);

  const toggleFullscreen = () => {
    if (getFullscreenElement() || isFullscreen) {
      void exitFullscreen();
      return;
    }
    const el = containerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (!el) return;
    try {
      const result = el.requestFullscreen
        ? el.requestFullscreen()
        : el.webkitRequestFullscreen?.();
      Promise.resolve(result)
        .then(() => syncFullscreenState())
        .catch((e) => {
          console.warn('requestFullscreen failed:', e);
          syncFullscreenState();
        });
    } catch (e) {
      console.warn('requestFullscreen threw:', e);
      syncFullscreenState();
    }
  };

  const playEpisode = (epIdx: number) => {
    if (!currentLine || epIdx < 0 || epIdx >= currentLine.episodes.length) return;
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
    setCurrentEpIdx(epIdx);
    setShowEpisodesDrawer(false);
    hasResumed.current = false;
    userSeekedRef.current = false;
    resumeTimeRef.current = null;
    activeStreamUrlRef.current = '';
  };

  const playNextEpisode = () => {
    if (currentLine && currentEpIdx < currentLine.episodes.length - 1) {
      playEpisode(currentEpIdx + 1);
    }
  };

  const playPrevEpisode = () => {
    if (currentLine && currentEpIdx > 0) {
      playEpisode(currentEpIdx - 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      triggerUserActivity();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (longPressAction === 'speed_up') {
          if (e.repeat) {
            if (!isLongPressingRef.current && videoRef.current) {
              isLongPressingRef.current = true;
              normalSpeedRef.current = videoRef.current.playbackRate;
              videoRef.current.playbackRate = 2.0;
              setIsSpeedingUp(true);
            }
          } else {
            if (!longPressTimerRef.current) {
              longPressTimerRef.current = setTimeout(() => {
                if (videoRef.current) {
                  isLongPressingRef.current = true;
                  normalSpeedRef.current = videoRef.current.playbackRate;
                  videoRef.current.playbackRate = 2.0;
                  setIsSpeedingUp(true);
                }
              }, 220);
            }
          }
        } else {
          if (videoRef.current) {
            userSeekedRef.current = true;
            hasResumed.current = true;
            videoRef.current.currentTime += 10;
          }
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) {
          userSeekedRef.current = true;
          hasResumed.current = true;
          videoRef.current.currentTime -= 10;
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        adjustVolume(0.05);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        adjustVolume(-0.05);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (getFullscreenElement()) {
          // Exit fullscreen first; a second Esc then closes the player.
          e.preventDefault();
          e.stopPropagation();
          void exitFullscreen();
        } else {
          if (videoRef.current) {
            saveProgress(videoRef.current.currentTime, videoRef.current.duration);
          }
          onClose();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (longPressAction === 'speed_up') {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          if (isLongPressingRef.current) {
            if (videoRef.current) {
              videoRef.current.playbackRate = normalSpeedRef.current;
            }
            setIsSpeedingUp(false);
            isLongPressingRef.current = false;
          } else {
            if (videoRef.current) {
              userSeekedRef.current = true;
              hasResumed.current = true;
              videoRef.current.currentTime += 10;
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearTimeout(longPressTimerRef.current);
    };
  }, [longPressAction, onClose, saveProgress, triggerUserActivity, exitFullscreen]);

  return (
    <div
      ref={containerRef}
      onMouseMove={triggerUserActivity}
      onClick={triggerUserActivity}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black select-none overflow-hidden"
    >
      {/* 2.0x Fast Playback HUD */}
      {isSpeedingUp && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-zinc-950/85 backdrop-blur-md border border-amber-500/50 rounded-full text-amber-300 font-mono text-xs flex items-center gap-2 shadow-2xl animate-pulse pointer-events-none z-40">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>▶▶ 2.0x 倍速播放中 (松开方向键恢复)</span>
        </div>
      )}

      {/* HTML5 Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={playNextEpisode}
        playsInline
      />

      {/* Resume playback toast notification */}
      {resumeNotice && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 bg-zinc-900/90 border border-zinc-700/80 text-zinc-200 rounded-full shadow-2xl backdrop-blur-md text-xs font-medium animate-fade-in">
          <Clock className="w-3.5 h-3.5 text-zinc-400" />
          <span>{resumeNotice}</span>
        </div>
      )}

      {/* Volume HUD Indicator */}
      {volumeNotice !== null && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none animate-fade-in flex flex-col items-center gap-2.5 px-6 py-4 bg-black/85 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl">
          {volumeNotice === 0 ? (
            <VolumeX className="w-8 h-8 text-rose-400" />
          ) : volumeNotice < 50 ? (
            <Volume1 className="w-8 h-8 text-white" />
          ) : (
            <Volume2 className="w-8 h-8 text-white" />
          )}
          <span className="text-sm font-semibold text-white font-mono">
            {volumeNotice === 0 ? '静音' : `${volumeNotice}%`}
          </span>
          <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-100 rounded-full"
              style={{ width: `${volumeNotice}%` }}
            />
          </div>
        </div>
      )}

      {/* Error notification */}
      {errorMsg && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-6 text-center">
          <AlertCircle className="w-10 h-10 text-rose-500 mb-3" />
          <h3 className="text-base font-semibold text-white mb-1">播放遇到问题</h3>
          <p className="text-zinc-400 max-w-sm mb-5 text-xs">{errorMsg}</p>
          <div className="flex gap-3">
            {playLines.length > 1 && (
              <button
                onClick={() => switchLine((currentLineIdx + 1) % playLines.length)}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 rounded-lg font-medium text-xs shadow transition-colors cursor-pointer"
              >
                换源 ({playLines[(currentLineIdx + 1) % playLines.length]?.title})
              </button>
            )}
            <button
              onClick={() => {
                setErrorMsg(null);
                if (videoRef.current) {
                  videoRef.current.load();
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-xs transition-colors cursor-pointer"
            >
              重新加载
            </button>
          </div>
        </div>
      )}

      {/* Persistent top window drag strip for frameless desktop window */}
      {isRunningInTauri() && !isFullscreen && (
        <div
          data-tauri-drag-region
          onMouseDown={handleDragMouseDown}
          onDoubleClick={handleTopBarDoubleClick}
          className="absolute top-0 inset-x-0 h-10 z-10"
        />
      )}

      {/* Top Header Bar */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleTopBarDoubleClick}
        className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 via-black/30 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (videoRef.current) {
                saveProgress(videoRef.current.currentTime, videoRef.current.duration);
              }
              onClose();
            }}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="退出播放 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <span>{vod.vod_name}</span>
              <span className="text-xs font-normal text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60">
                {currentEpisode?.name}
              </span>
            </h2>
            <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
              <span>{vod.source_name || '当前采集源'}</span>
              <span>·</span>
              <span>{currentLine?.title}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Line Switcher */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowLineMenu(!showLineMenu);
                setShowSpeedMenu(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded-lg text-xs backdrop-blur transition-colors cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-zinc-400" />
              <span>{currentLine?.title || '线路'}</span>
            </button>
            {showLineMenu && (
              <div className="absolute right-0 mt-2 w-44 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1.5 z-40 animate-fade-in">
                <div className="px-3 py-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800/60 pb-1 mb-1">
                  播放线路
                </div>
                {playLines.map((line, idx) => (
                  <button
                    key={idx}
                    onClick={() => switchLine(idx)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer ${
                      idx === currentLineIdx
                        ? 'bg-zinc-800 text-zinc-100 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                  >
                    <span className="truncate mr-2">{line.title}</span>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap">{line.episodes.length} 集</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Episode Drawer Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowEpisodesDrawer(!showEpisodesDrawer);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              showEpisodesDrawer
                ? 'bg-zinc-100 text-zinc-950 font-semibold'
                : 'bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 backdrop-blur'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>选集</span>
          </button>

          {/* DLNA Cast Button & Status */}
          {activeCastDevice ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCastModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 rounded-lg text-xs backdrop-blur font-medium transition-colors cursor-pointer"
            >
              <Tv className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>投屏中: {activeCastDevice.name}</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCastModal(true);
                searchCastDevices();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-200 rounded-lg text-xs backdrop-blur transition-colors cursor-pointer"
              title="无线投屏到电视 (自动净化M3U8广告切片)"
            >
              <Tv className="w-3.5 h-3.5 text-zinc-400" />
              <span>投屏</span>
            </button>
          )}

          {/* Frameless Desktop Window Controls */}
          {isRunningInTauri() && !isFullscreen && (
            <div className="flex items-center ml-2 border-l border-zinc-700/60 pl-2 gap-0.5" data-no-drag>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  api.minimizeWindow();
                }}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="最小化"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  api.toggleMaximizeWindow();
                }}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="最大化 / 还原"
              >
                <Square className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) {
                    saveProgress(videoRef.current.currentTime, videoRef.current.duration);
                  }
                  onClose();
                }}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-rose-500/80 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="关闭播放 (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Episode Drawer (shadcn style right panel) */}
      {showEpisodesDrawer && currentLine && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-16 bottom-24 right-6 w-72 bg-zinc-950/95 border border-zinc-800 rounded-2xl shadow-2xl p-4 flex flex-col z-30 backdrop-blur-xl animate-fade-in"
        >
          <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800 mb-3">
            <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">选集列表</h3>
            <span className="text-[11px] text-zinc-500 font-mono">共 {currentLine.episodes.length} 集</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
            {currentLine.episodes.map((ep, idx) => (
              <button
                key={idx}
                onClick={() => playEpisode(idx)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                  idx === currentEpIdx
                    ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-sm'
                    : 'bg-zinc-900/60 hover:bg-zinc-850 text-zinc-300'
                }`}
              >
                <span className="truncate">{ep.name}</span>
                {idx === currentEpIdx && (
                  <span className="text-[10px] bg-zinc-300/40 px-1.5 py-0.2 rounded">播放中</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 z-20 px-6 py-4 bg-gradient-to-t from-black/95 via-black/50 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber Progress Bar */}
        {(() => {
          const displayTime = isDragging ? dragTime : currentTime;
          const playedPercent = duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;
          const bufferedPercent = duration > 0 ? Math.min(100, Math.max(0, (buffered / duration) * 100)) : 0;

          return (
            <div
              ref={progressRef}
              onClick={handleProgressBarClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => setHoverTime(null)}
              className="relative w-full h-5 flex items-center cursor-pointer group mb-2.5 select-none touch-none"
            >
              {/* Hover Timestamp Tooltip */}
              {hoverTime !== null && duration > 0 && (
                <div
                  className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 bg-zinc-900 border border-zinc-700/80 text-zinc-100 text-[10px] font-mono rounded shadow-lg pointer-events-none"
                  style={{ left: `${hoverX}px` }}
                >
                  {formatTime(hoverTime)}
                </div>
              )}

              {/* Background Track */}
              <div className="w-full h-1 group-hover:h-1.5 bg-white/20 rounded-full overflow-hidden transition-all duration-150 relative">
                {/* Buffered Track */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white/30 rounded-full transition-all duration-300"
                  style={{ width: `${bufferedPercent}%` }}
                />
                {/* Played Track */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white rounded-full"
                  style={{ width: `${playedPercent}%` }}
                />
              </div>

              {/* Draggable Scrubber Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform duration-150 pointer-events-none flex items-center justify-center"
                style={{ left: `${playedPercent}%` }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
              </div>
            </div>
          );
        })()}

        {/* Buttons and toggles */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white text-zinc-950 flex items-center justify-center hover:bg-zinc-200 transition-transform active:scale-95 cursor-pointer shadow-sm"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            {/* Prev Episode */}
            <button
              onClick={playPrevEpisode}
              disabled={currentEpIdx <= 0}
              className="p-2 text-gray-300 hover:text-white disabled:opacity-30 disabled:hover:text-gray-300 rounded-full transition-all"
              title="上一集"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            {/* Next Episode */}
            <button
              onClick={playNextEpisode}
              disabled={!currentLine || currentEpIdx >= currentLine.episodes.length - 1}
              className="p-2 text-gray-300 hover:text-white disabled:opacity-30 disabled:hover:text-gray-300 rounded-full transition-all"
              title="下一集"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            {/* Time display */}
            <div className="text-sm font-mono text-gray-300 ml-2">
              <span>{formatTime(currentTime)}</span>
              <span className="text-gray-500 mx-1.5">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Volume control */}
            <div className="flex items-center gap-2 group">
              <button
                onClick={toggleMute}
                className="p-2 text-gray-300 hover:text-white rounded-full transition-all"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-white/20 accent-zinc-200 cursor-pointer rounded"
              />
            </div>

            {/* Speed menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowLineMenu(false);
                }}
                className="px-2.5 py-1 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 rounded transition-all"
              >
                {playbackRate === 1.0 ? '倍速' : `${playbackRate}x`}
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-10 right-0 w-20 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl py-1 z-40 backdrop-blur-md">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => changeSpeed(rate)}
                      className={`w-full text-center py-1 text-xs cursor-pointer ${
                        playbackRate === rate
                          ? 'text-zinc-100 font-bold bg-zinc-800'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-all"
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* DLNA Cast Modal */}
      {showCastModal && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowCastModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 text-zinc-100 flex flex-col max-h-[75vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Tv className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">无线投屏到电视</h3>
                  <p className="text-[11px] text-emerald-400 mt-0.5">
                    🛡️ 本地 M3U8 净化中继已启动，电视将播放纯净无广告片源
                  </p>
                </div>
              </div>
              <button
                onClick={() => searchCastDevices()}
                disabled={isSearchingCast}
                className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded-md transition-colors cursor-pointer"
                title="重新搜索局域网设备"
              >
                <RotateCw className={`w-4 h-4 ${isSearchingCast ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {castError && (
              <div className="mt-3 p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs">
                {castError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-4 space-y-2.5">
              {isSearchingCast && castDevices.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-400 space-y-3">
                  <RotateCw className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-xs">正在搜索局域网内的智能电视与电视盒子...</span>
                </div>
              ) : castDevices.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-500 space-y-2">
                  <Tv className="w-10 h-10 opacity-30" />
                  <p className="text-xs font-medium text-zinc-300">未发现局域网内的投屏设备</p>
                  <p className="text-[11px] text-zinc-500">
                    请确保电脑与电视连接在同一 Wi-Fi 或路由器网络下
                  </p>
                  <button
                    onClick={() => searchCastDevices()}
                    className="mt-2 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded-lg cursor-pointer"
                  >
                    重新扫描
                  </button>
                </div>
              ) : (
                castDevices.map((device) => {
                  const isCurrent = activeCastDevice?.control_url === device.control_url;
                  return (
                    <div
                      key={device.control_url}
                      onClick={() => handleCastToDevice(device)}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-zinc-900/60 hover:bg-zinc-800/80 border-zinc-800 text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          isCurrent ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          <Tv className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate">{device.name}</div>
                          <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                            {isCurrent ? '正在投屏播放 (纯净无广告)' : '点击一键投屏至该设备'}
                          </div>
                        </div>
                      </div>

                      {isCurrent && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStopCast();
                          }}
                          className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-md text-xs font-medium cursor-pointer"
                        >
                          断开
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-zinc-800">
              <button
                onClick={() => setShowCastModal(false)}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
