import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  Tv,
  RotateCw,
  Minus,
  Square,
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Star,
  Film,
  Maximize2,
} from 'lucide-react';
import type { VodItem, PlayLine, Episode, DlnaDevice, DoubanMetadata } from '../types';
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
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const activeStreamUrlRef = useRef<string>('');
  const userSeekedRef = useRef<boolean>(false);
  const resumeTimeRef = useRef<number | null>(null);
  const hasResumed = useRef<boolean>(false);
  const hideControlsTimeout = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const isHoveringControlsRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);

  const [fullVod, setFullVod] = useState<VodItem>(vod);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [doubanMeta, setDoubanMeta] = useState<DoubanMetadata | null>(null);
  const [expandContent, setExpandContent] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  const [playLines, setPlayLines] = useState<PlayLine[]>(vod.play_lines || []);
  const [currentLineIdx, setCurrentLineIdx] = useState(
    Math.min(initialLineIndex, Math.max(0, (vod.play_lines || []).length - 1))
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
  const [showLineMenu, setShowLineMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [skipIntroSec, setSkipIntroSec] = useState(0);
  const [skipOutroSec, setSkipOutroSec] = useState(0);

  // DLNA cast states
  const [showCastModal, setShowCastModal] = useState(false);
  const [castDevices, setCastDevices] = useState<DlnaDevice[]>([]);
  const [isSearchingCast, setIsSearchingCast] = useState(false);
  const [activeCastDevice, setActiveCastDevice] = useState<DlnaDevice | null>(null);
  const [castError, setCastError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Synchronize state to refs to prevent stale closure bugs
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // Handle controls auto-hide with stable callback
  const triggerUserActivity = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimeout.current) {
      window.clearTimeout(hideControlsTimeout.current);
    }
    hideControlsTimeout.current = window.setTimeout(() => {
      const isVideoPlaying = videoRef.current ? !videoRef.current.paused : isPlayingRef.current;
      if (
        isVideoPlaying &&
        !isHoveringControlsRef.current &&
        !isDraggingRef.current
      ) {
        setShowControls(false);
      }
    }, 3500);
  }, []);

  // Global capture listeners ensure mousemove, pointermove, clicks always wake controls
  useEffect(() => {
    const handleUserInteraction = () => {
      triggerUserActivity();
    };

    window.addEventListener('mousemove', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('pointermove', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('pointerdown', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener('mousemove', handleUserInteraction, { capture: true });
      window.removeEventListener('pointermove', handleUserInteraction, { capture: true });
      window.removeEventListener('pointerdown', handleUserInteraction, { capture: true });
      window.removeEventListener('touchstart', handleUserInteraction, { capture: true });
      if (hideControlsTimeout.current) {
        window.clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [triggerUserActivity]);

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
      const videoTitle = `${fullVod.vod_name} ${currentEpisode.name}`.trim();
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

  // Load app settings
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

  // Fetch full details if metadata is missing (actors, director, synopsis, etc.)
  useEffect(() => {
    let isMounted = true;
    if (
      vod.source_id &&
      (!vod.vod_content || !vod.vod_actor || !vod.play_lines || vod.play_lines.length === 0)
    ) {
      api.fetchVodDetail(vod.source_id, vod.vod_id).then((detail) => {
        if (!isMounted) return;
        setFullVod(detail);
        if (detail.play_lines && detail.play_lines.length > 0 && playLines.length === 0) {
          setPlayLines(detail.play_lines);
        }
      }).catch(console.error);
    }

    // Check favorite status
    api.getFavorites().then((favs) => {
      if (!isMounted) return;
      setIsFavorited(favs.some((f) => f.vod_id === vod.vod_id && f.source_id === vod.source_id));
    }).catch(console.error);

    // Fetch Douban metadata for authoritative rating and synopsis
    api.getDoubanMetadata(vod.vod_name).then((meta) => {
      if (!isMounted) return;
      setDoubanMeta(meta);
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [vod]);

  const toggleFavorite = async () => {
    try {
      const res = await api.toggleFavorite({
        vod_id: fullVod.vod_id,
        source_id: fullVod.source_id || '',
        source_name: fullVod.source_name || '默认源',
        vod_name: fullVod.vod_name,
        vod_pic: fullVod.vod_pic,
        vod_remarks: fullVod.vod_remarks,
        type_name: fullVod.type_name,
        vod_year: fullVod.vod_year,
        created_at: Math.floor(Date.now() / 1000),
      });
      setIsFavorited(res);
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

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

  const currentLine: PlayLine | undefined = playLines[currentLineIdx] || fullVod.play_lines[currentLineIdx];
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
        vod_id: fullVod.vod_id,
        source_id: fullVod.source_id || '',
        source_name: fullVod.source_name || '默认源',
        vod_name: fullVod.vod_name,
        vod_pic: fullVod.vod_pic,
        line_index: currentLineIdx,
        episode_index: currentEpIdx,
        episode_name: currentEpisode.name,
        play_url: currentEpisode.url,
        progress_seconds: Math.floor(timeToSave),
        duration_seconds: Math.floor(durToSave || 0),
        updated_at: Math.floor(Date.now() / 1000),
      }).catch(console.error);
    },
    [fullVod, currentLineIdx, currentEpIdx, currentEpisode]
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
      if (userSeekedRef.current) return;
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

  const clickTimerRef = useRef<number | null>(null);

  const handleVideoClick = () => {
    triggerUserActivity();
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
    triggerUserActivity();
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
    isDraggingRef.current = true;
    triggerUserActivity();
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
      isDraggingRef.current = false;
      triggerUserActivity();
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
      setIsFullscreen(false);
      setShowControls(true);
    }
  }, []);

  const toggleFullscreen = () => {
    if (isFullscreen || Boolean(getFullscreenElement())) {
      void exitFullscreen();
      return;
    }
    const el = videoContainerRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (el) {
      try {
        const result = el.requestFullscreen
          ? el.requestFullscreen()
          : el.webkitRequestFullscreen?.();
        Promise.resolve(result)
          .then(() => syncFullscreenState())
          .catch(() => {});
      } catch (e) {
        console.warn('requestFullscreen error:', e);
      }
    }
    setIsFullscreen(true);
  };

  const handleClose = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
      return;
    }
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
    onClose();
  }, [isFullscreen, exitFullscreen, onClose, saveProgress]);

  const playEpisode = (epIdx: number) => {
    if (!currentLine || epIdx < 0 || epIdx >= currentLine.episodes.length) return;
    if (videoRef.current) {
      saveProgress(videoRef.current.currentTime, videoRef.current.duration);
    }
    setCurrentEpIdx(epIdx);
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
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select')) return;
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
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select')) return;
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (isFullscreen || getFullscreenElement()) {
          e.preventDefault();
          e.stopPropagation();
          void exitFullscreen();
        } else {
          handleClose();
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
  }, [longPressAction, handleClose, saveProgress, triggerUserActivity, exitFullscreen, isFullscreen]);

  // Clean html tags from plot synopsis
  const cleanContent = useMemo(() => {
    return (fullVod.vod_content || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }, [fullVod.vod_content]);

  // Sorted episodes for YouTube-style episode selector
  const sortedEpisodes = useMemo(() => {
    if (!currentLine?.episodes) return [];
    const eps = currentLine.episodes.map((ep, originalIdx) => ({ ep, originalIdx }));
    if (sortOrder === 'desc') {
      return [...eps].reverse();
    }
    return eps;
  }, [currentLine, sortOrder]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground select-none overflow-hidden animate-fade-in">
      {/* Top Navigation & Frameless Desktop Titlebar */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleTopBarDoubleClick}
        className="h-13 border-b border-border/60 px-4 sm:px-6 flex items-center justify-between bg-card/90 backdrop-blur-md sticky top-0 z-30 select-none flex-shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0" data-no-drag>
          <button
            onClick={handleClose}
            className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            title="返回 (Esc)"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-xs font-medium hidden sm:inline">返回</span>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm text-foreground truncate max-w-[240px] sm:max-w-xs md:max-w-md">
              {fullVod.vod_name}
            </span>
            {currentEpisode && (
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border whitespace-nowrap">
                {currentEpisode.name}
              </span>
            )}
          </div>
        </div>

        {/* Right window control buttons in Tauri */}
        {isRunningInTauri() && (
          <div className="flex items-center ml-4 gap-1 flex-shrink-0" data-no-drag>
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.minimizeWindow();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="最小化"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                api.toggleMaximizeWindow();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="最大化 / 还原"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-rose-500 hover:text-white text-muted-foreground transition-colors cursor-pointer"
              title="关闭播放 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Scrollable YouTube-Style Body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-8 py-5">
        <div className={`mx-auto w-full flex flex-col xl:flex-row gap-6 ${isTheaterMode ? 'max-w-full' : 'max-w-[1760px]'}`}>

          {/* Primary Left Column: Player + Movie Information */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 16:9 Video Player Container (fullscreen mode turns into fixed inset-0) */}
            <div
              ref={videoContainerRef}
              className={`${
                isFullscreen
                  ? 'fixed inset-0 z-50 w-screen h-screen bg-black rounded-none overflow-hidden select-none'
                  : 'relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl group select-none'
              }`}
              onMouseMove={triggerUserActivity}
              onPointerMove={triggerUserActivity}
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
                className={`w-full h-full object-contain ${showControls ? 'cursor-default' : 'cursor-none'}`}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => {
                  setIsPlaying(true);
                  triggerUserActivity();
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (hideControlsTimeout.current) {
                    window.clearTimeout(hideControlsTimeout.current);
                  }
                }}
                onEnded={playNextEpisode}
                playsInline
              />

              {/* Interactive click/gesture backdrop overlay covering the entire video */}
              <div
                className={`absolute inset-0 z-10 ${showControls ? 'cursor-default' : 'cursor-none'}`}
                onClick={handleVideoClick}
                onDoubleClick={handleVideoDoubleClick}
                onMouseMove={triggerUserActivity}
                onPointerMove={triggerUserActivity}
              />

              {/* Resume playback toast notification */}
              {resumeNotice && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 bg-zinc-900/90 border border-zinc-700/80 text-zinc-200 rounded-full shadow-2xl backdrop-blur-md text-xs font-medium animate-fade-in pointer-events-none">
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

              {/* Fullscreen Top Header Overlay */}
              {isFullscreen && (
                <div
                  onMouseEnter={() => {
                    isHoveringControlsRef.current = true;
                    triggerUserActivity();
                  }}
                  onMouseLeave={() => {
                    isHoveringControlsRef.current = false;
                    triggerUserActivity();
                  }}
                  onMouseMove={triggerUserActivity}
                  className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 via-black/30 to-transparent transition-opacity duration-300 ${
                    showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void exitFullscreen()}
                      className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                      title="退出全屏 (Esc)"
                    >
                      <Minimize className="w-5 h-5" />
                    </button>
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                        <span>{fullVod.vod_name}</span>
                        {currentEpisode && (
                          <span className="text-xs font-normal text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60">
                            {currentEpisode.name}
                          </span>
                        )}
                      </h2>
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom Controls Bar */}
              <div
                onMouseEnter={() => {
                  isHoveringControlsRef.current = true;
                  triggerUserActivity();
                }}
                onMouseLeave={() => {
                  isHoveringControlsRef.current = false;
                  triggerUserActivity();
                }}
                onMouseMove={triggerUserActivity}
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
                      className="p-2 text-gray-300 hover:text-white disabled:opacity-30 disabled:hover:text-gray-300 rounded-full transition-all cursor-pointer"
                      title="上一集"
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>

                    {/* Next Episode */}
                    <button
                      onClick={playNextEpisode}
                      disabled={!currentLine || currentEpIdx >= currentLine.episodes.length - 1}
                      className="p-2 text-gray-300 hover:text-white disabled:opacity-30 disabled:hover:text-gray-300 rounded-full transition-all cursor-pointer"
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
                        className="p-2 text-gray-300 hover:text-white rounded-full transition-all cursor-pointer"
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
                        className="px-2.5 py-1 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 rounded transition-all cursor-pointer"
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

                    {/* Theater Mode toggle (when not fullscreen) */}
                    {!isFullscreen && (
                      <button
                        onClick={() => setIsTheaterMode(!isTheaterMode)}
                        className={`p-2 rounded-full transition-all cursor-pointer ${
                          isTheaterMode ? 'text-primary bg-primary/10' : 'text-gray-300 hover:text-white hover:bg-white/10'
                        }`}
                        title={isTheaterMode ? '退出剧场模式' : '剧场模式'}
                      >
                        <Maximize2 className="w-5 h-5" />
                      </button>
                    )}

                    {/* Fullscreen toggle */}
                    <button
                      onClick={toggleFullscreen}
                      className="p-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition-all cursor-pointer"
                      title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'}
                    >
                      {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Title & Episode Info */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2.5 flex-wrap">
                    <span>{fullVod.vod_name}</span>
                    {currentEpisode && (
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        {currentEpisode.name}
                      </span>
                    )}
                    {fullVod.vod_remarks && (
                      <span className="text-xs text-muted-foreground font-normal">
                        {fullVod.vod_remarks}
                      </span>
                    )}
                  </h1>
                </div>
              </div>

              {/* Interactive Action Bar */}
              <div className="flex items-center justify-between gap-3 flex-wrap py-2 border-b border-border/50">
                {/* Left: Source, Tags & Ratings */}
                <div className="flex items-center gap-2 flex-wrap">
                  {fullVod.source_name && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
                      <Film className="w-3.5 h-3.5 text-primary" />
                      <span>{fullVod.source_name}</span>
                    </span>
                  )}
                  {fullVod.type_name && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-muted text-muted-foreground font-medium">
                      {fullVod.type_name}
                    </span>
                  )}
                  {fullVod.vod_year && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-muted text-muted-foreground font-medium">
                      {fullVod.vod_year}
                    </span>
                  )}
                  {doubanMeta?.rate && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-500/10 text-amber-500 font-semibold border border-amber-500/20">
                      <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                      <span>豆瓣 {doubanMeta.rate}</span>
                    </span>
                  )}
                </div>

                {/* Right: Actions (收藏, 无线投屏, 切换线路) */}
                <div className="flex items-center gap-2">
                  {/* Favorite Button */}
                  <button
                    onClick={toggleFavorite}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer shadow-sm ${
                      isFavorited
                        ? 'bg-rose-500 text-white shadow-rose-500/20'
                        : 'bg-secondary hover:bg-secondary/80 text-foreground border border-border'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
                    <span>{isFavorited ? '已收藏' : '收藏'}</span>
                  </button>

                  {/* Wireless Cast Button */}
                  <button
                    onClick={() => {
                      setShowCastModal(true);
                      if (!activeCastDevice) searchCastDevices();
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer shadow-sm ${
                      activeCastDevice
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 animate-pulse'
                        : 'bg-secondary hover:bg-secondary/80 text-foreground border border-border'
                    }`}
                    title="无线投屏到智能电视"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>{activeCastDevice ? `投屏中: ${activeCastDevice.name}` : '无线投屏'}</span>
                  </button>

                  {/* Line Switcher */}
                  {playLines.length > 1 && (
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowLineMenu(!showLineMenu);
                          setShowSpeedMenu(false);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-full text-xs font-medium transition-colors cursor-pointer shadow-sm"
                      >
                        <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{currentLine?.title || '切换线路'}</span>
                      </button>
                      {showLineMenu && (
                        <div className="absolute right-0 mt-2 w-48 bg-popover border border-border rounded-xl shadow-xl py-1.5 z-40 animate-fade-in text-popover-foreground">
                          <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-1 mb-1">
                            可用线路 ({playLines.length})
                          </div>
                          {playLines.map((line, idx) => (
                            <button
                              key={idx}
                              onClick={() => switchLine(idx)}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer ${
                                idx === currentLineIdx
                                  ? 'bg-primary/10 text-primary font-semibold'
                                  : 'hover:bg-muted text-foreground'
                              }`}
                            >
                              <span className="truncate mr-2">{line.title}</span>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{line.episodes.length} 集</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Expandable Details Box (YouTube Style Description) */}
              <div className="mt-3 bg-secondary/35 hover:bg-secondary/50 rounded-2xl p-4 transition-colors border border-border/40 text-xs text-muted-foreground space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-foreground font-medium">
                  {fullVod.vod_director && (
                    <div className="truncate">
                      <span className="text-muted-foreground font-normal">导演：</span>
                      <span>{fullVod.vod_director}</span>
                    </div>
                  )}
                  {fullVod.vod_actor && (
                    <div className="truncate sm:col-span-2">
                      <span className="text-muted-foreground font-normal">主演：</span>
                      <span>{fullVod.vod_actor}</span>
                    </div>
                  )}
                  {fullVod.vod_area && (
                    <div>
                      <span className="text-muted-foreground font-normal">地区：</span>
                      <span>{fullVod.vod_area}</span>
                    </div>
                  )}
                  {fullVod.vod_lang && (
                    <div>
                      <span className="text-muted-foreground font-normal">语言：</span>
                      <span>{fullVod.vod_lang}</span>
                    </div>
                  )}
                  {fullVod.vod_score && (
                    <div>
                      <span className="text-muted-foreground font-normal">影视评分：</span>
                      <span className="text-amber-500 font-semibold">{fullVod.vod_score}</span>
                    </div>
                  )}
                </div>

                {/* Plot Synopsis / Introduction */}
                {cleanContent && (
                  <div className="pt-2 border-t border-border/30">
                    <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap text-xs">
                      {expandContent
                        ? cleanContent
                        : cleanContent.slice(0, 160) + (cleanContent.length > 160 ? '...' : '')}
                    </div>
                    {cleanContent.length > 160 && (
                      <button
                        onClick={() => setExpandContent(!expandContent)}
                        className="mt-1.5 text-primary hover:underline font-medium inline-flex items-center gap-1 cursor-pointer text-xs"
                      >
                        {expandContent ? (
                          <>
                            <span>收起简介</span>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            <span>展开完整简介</span>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Secondary Right Column: Episode Grid (选集) + Source Lines */}
          <div className="w-full xl:w-[380px] 2xl:w-[420px] flex-shrink-0 flex flex-col gap-4">
            {/* Episode Selector Box */}
            <div className="bg-card border border-border/70 rounded-2xl p-4 shadow-sm flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-foreground">选集播放</h3>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    共 {currentLine?.episodes?.length || 0} 集
                  </span>
                </div>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted transition-colors cursor-pointer"
                  title="切换排列顺序"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  <span>{sortOrder === 'asc' ? '正序' : '倒序'}</span>
                </button>
              </div>

              {/* Episodes Grid */}
              <div className="grid grid-cols-4 sm:grid-cols-5 xl:grid-cols-4 gap-2 max-h-[460px] overflow-y-auto pr-1 scrollbar-thin">
                {sortedEpisodes.map(({ ep, originalIdx }) => {
                  const isCurrent = originalIdx === currentEpIdx;
                  return (
                    <button
                      key={originalIdx}
                      onClick={() => playEpisode(originalIdx)}
                      className={`h-9 px-2 rounded-xl text-xs font-medium transition-all flex items-center justify-center truncate cursor-pointer ${
                        isCurrent
                          ? 'bg-primary text-primary-foreground font-bold shadow-md shadow-primary/20 scale-[1.02]'
                          : 'bg-secondary/60 hover:bg-secondary text-secondary-foreground border border-border/40 hover:border-border'
                      }`}
                      title={ep.name}
                    >
                      <span className="truncate">{ep.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Other Available Lines Card */}
            {playLines.length > 1 && (
              <div className="bg-card border border-border/70 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 pb-2.5 border-b border-border/60 mb-2.5 text-xs font-semibold text-foreground">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>可用播放源 ({playLines.length})</span>
                </div>
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {playLines.map((line, idx) => (
                    <button
                      key={idx}
                      onClick={() => switchLine(idx)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                        idx === currentLineIdx
                          ? 'bg-primary/10 text-primary font-semibold border border-primary/20'
                          : 'bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground border border-transparent'
                      }`}
                    >
                      <span className="truncate mr-2">{line.title}</span>
                      <span className="text-[10px] opacity-70 whitespace-nowrap">{line.episodes.length} 集</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* DLNA Wireless Cast Dialog */}
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
