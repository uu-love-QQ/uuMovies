import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Shield,
  Flame,
  Filter,
  Play,
  Download,
  Database,
  Check,
  Plus,
  X,
  RotateCcw,
  Folder,
  FolderOpen,
  RotateCw,
  Bookmark,
  Rss,
  Layers,
  Trash2,
  SlidersHorizontal,
  Code,
  AlertTriangle,
  Globe,
  ArrowUpCircle,
  RefreshCw,
} from 'lucide-react';
import type {
  AppSettings,
  SubscriptionItem,
  UserTaxonomyConfig,
  LocalCategory,
  Source,
  Category,
} from '../types';
import { api } from '../services/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import { clearVodCache } from '../lib/vodCache';
import {
  checkForUpdates,
  installUpdate,
  setAutoCheckEnabled,
  useUpdater,
} from '../lib/updater';

interface SettingsViewProps {
  sources?: Source[];
  onSourcesUpdated?: () => void;
  onTaxonomyUpdated?: () => void;
  onOpenSourceManager?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  sources,
  onSourcesUpdated,
  onTaxonomyUpdated,
  onOpenSourceManager,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [defaultDownloadDir, setDefaultDownloadDir] = useState('');
  const [saveToast, setSaveToast] = useState(false);
  const updater = useUpdater();

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
    api.getDefaultDownloadDir().then(setDefaultDownloadDir).catch(console.error);
    api.getSubscriptions().then(setSubscriptions).catch(console.error);
    api.getTaxonomy().then(setTaxonomy).catch(console.error);
    api.getCustomAliases().then(setCustomAliases).catch(console.error);
  }, []);
  const [customAliases, setCustomAliases] = useState<Record<string, string>>({});
  const [newAliasFrom, setNewAliasFrom] = useState('');
  const [newAliasTo, setNewAliasTo] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [newSubUrl, setNewSubUrl] = useState('');
  const [newSubName, setNewSubName] = useState('');
  const [syncingSubId, setSyncingSubId] = useState<string | null>(null);
  const [subToast, setSubToast] = useState<string | null>(null);

  const [taxonomy, setTaxonomy] = useState<UserTaxonomyConfig | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatTag, setNewCatTag] = useState('');
  const [newBlockedTag, setNewBlockedTag] = useState('');
  const [newBlockedTypeId, setNewBlockedTypeId] = useState('');
  // Source category mapping editor state
  const [sourcesList, setSourcesList] = useState<Source[]>([]);
  const [mappingSourceId, setMappingSourceId] = useState<string>('');
  const [mappingClasses, setMappingClasses] = useState<Category[]>([]);
  const [isMappingJsonMode, setIsMappingJsonMode] = useState<boolean>(false);
  const [mappingJsonText, setMappingJsonText] = useState<string>('');
  const [mappingToast, setMappingToast] = useState<string | null>(null);
  const [isRefreshingClasses, setIsRefreshingClasses] = useState(false);
  const availableTags = useMemo(() => {
    if (!taxonomy || !taxonomy.categories) return [];
    const list: Array<{ tag: string; name: string }> = [];
    for (const cat of taxonomy.categories) {
      for (const t of cat.bind_tags) {
        if (!list.some((item) => item.tag === t)) {
          list.push({ tag: t, name: cat.name });
        }
      }
    }
    // If adult mode is enabled in taxonomy, and #18plus is not yet in categories, allow mapping to 18+
    if (taxonomy.adult_mode && !list.some((item) => item.tag === '#18plus')) {
      list.push({ tag: '#18plus', name: '18+成人' });
    }
    return list;
  }, [taxonomy]);

  useEffect(() => {
    if (sources && sources.length > 0) {
      setSourcesList(sources);
      if (!mappingSourceId || !sources.some((s) => s.id === mappingSourceId)) {
        setMappingSourceId(sources[0].id);
      }
    } else if (sources && sources.length === 0) {
      setSourcesList([]);
      setMappingSourceId('');
    } else {
      api.getSources().then((list) => {
        setSourcesList(list);
        if (list.length > 0) {
          setMappingSourceId(list[0].id);
        }
      });
    }
  }, [sources]);

  const currentMappingSource = sourcesList.find((s) => s.id === mappingSourceId);

  useEffect(() => {
    if (!mappingSourceId) return;
    const src = sourcesList.find((s) => s.id === mappingSourceId);
    if (!src) return;

    const configData = {
      adult_type_ids: src.adult_type_ids || [],
      category_mapping: src.category_mapping || {},
    };
    setMappingJsonText(JSON.stringify(configData, null, 2));

    api
      .getSourceClasses(mappingSourceId)
      .then((classes) => {
        if (classes && classes.length > 0) {
          setMappingClasses(classes);
        }
      })
      .catch(() => {});
  }, [mappingSourceId, sourcesList]);

  const handleRefreshSourceClasses = async () => {
    if (!mappingSourceId) return;
    setIsRefreshingClasses(true);
    try {
      const cats = await api.getSourceClasses(mappingSourceId);
      if (cats && cats.length > 0) {
        setMappingClasses(cats);
        setMappingToast(`已重新读取 ${cats.length} 个分类！`);
        setTimeout(() => setMappingToast(null), 2500);
      }
    } finally {
      setIsRefreshingClasses(false);
    }
  };

  const handleUpdateCategoryTag = async (typeId: string, newTag: string) => {
    if (!currentMappingSource) return;
    const currentMapping = { ...(currentMappingSource.category_mapping || {}) };

    for (const [tag, ids] of Object.entries(currentMapping)) {
      currentMapping[tag] = ids.filter((id) => id !== typeId);
      if (currentMapping[tag].length === 0) {
        delete currentMapping[tag];
      }
    }

    if (newTag !== 'unmapped') {
      if (!currentMapping[newTag]) {
        currentMapping[newTag] = [];
      }
      currentMapping[newTag].push(typeId);
    }

    const updatedSource = {
      ...currentMappingSource,
      category_mapping: currentMapping,
    };

    const updatedList = sourcesList.map((s) =>
      s.id === mappingSourceId ? updatedSource : s
    );
    setSourcesList(updatedList);
    setMappingJsonText(
      JSON.stringify(
        {
          adult_type_ids: updatedSource.adult_type_ids || [],
          category_mapping: currentMapping,
        },
        null,
        2
      )
    );

    // Instantly invalidate VOD cache and persist mapping
    clearVodCache(mappingSourceId);
    try {
      await api.saveSources(updatedList);
      onSourcesUpdated?.();
    } catch (e) {
      console.error('Failed to auto-save category mapping:', e);
    }
  };

  const handleToggleCategoryAdult = async (typeId: string, isAdult: boolean) => {
    if (!currentMappingSource) return;
    let adults = [...(currentMappingSource.adult_type_ids || [])];
    if (isAdult) {
      if (!adults.includes(typeId)) adults.push(typeId);
    } else {
      adults = adults.filter((id) => id !== typeId);
    }

    const updatedSource = {
      ...currentMappingSource,
      adult_type_ids: adults,
    };

    const updatedList = sourcesList.map((s) =>
      s.id === mappingSourceId ? updatedSource : s
    );
    setSourcesList(updatedList);
    setMappingJsonText(
      JSON.stringify(
        {
          adult_type_ids: adults,
          category_mapping: updatedSource.category_mapping || {},
        },
        null,
        2
      )
    );

    // Instantly invalidate VOD cache and persist mapping
    clearVodCache(mappingSourceId);
    try {
      await api.saveSources(updatedList);
      onSourcesUpdated?.();
    } catch (e) {
      console.error('Failed to auto-save adult classification:', e);
    }
  };

  const handleSaveCurrentSourceMapping = async () => {
    if (!currentMappingSource) return;
    let finalSource = currentMappingSource;

    if (isMappingJsonMode) {
      try {
        const parsed = JSON.parse(mappingJsonText);
        finalSource = {
          ...currentMappingSource,
          adult_type_ids: parsed.adult_type_ids || [],
          category_mapping: parsed.category_mapping || {},
        };
      } catch (e) {
        alert('JSON 语法错误，请检查格式');
        return;
      }
    }
    const updatedList = sourcesList.map((s) =>
      s.id === mappingSourceId ? finalSource : s
    );
    setSourcesList(updatedList);
    clearVodCache(mappingSourceId);
    await api.saveSources(updatedList);
    onSourcesUpdated?.();
    setMappingToast(`已成功保存【${finalSource.name}】的分类映射规则！`);
    setTimeout(() => setMappingToast(null), 3000);
  };

  const handleDeleteCurrentSource = async () => {
    if (!currentMappingSource) return;
    if (!confirm(`确定要彻底删除采集源【${currentMappingSource.name}】及其全部绑定的分类映射规则吗？`)) return;
    const updated = sourcesList.filter((s) => s.id !== mappingSourceId);
    clearVodCache(mappingSourceId);
    setSourcesList(updated);
    if (updated.length > 0) {
      setMappingSourceId(updated[0].id);
    } else {
      setMappingSourceId('');
    }
    await api.saveSources(updated);
    onSourcesUpdated?.();
  };

  const handleAddSubscription = async () => {
    const url = newSubUrl.trim();
    if (!url) return;
    const newSub: SubscriptionItem = {
      id: `sub_${Date.now()}`,
      name: newSubName.trim() || `订阅源 ${subscriptions.length + 1}`,
      url,
      enabled: true,
      auto_update: true,
      update_interval_hours: 24,
      last_updated: 0,
      source_count: 0,
    };
    const updated = [...subscriptions, newSub];
    setSubscriptions(updated);
    await api.saveSubscriptions(updated);
    setNewSubUrl('');
    setNewSubName('');
    handleSyncSingleSub(newSub.id);
  };

  const handleSyncSingleSub = async (id: string) => {
    setSyncingSubId(id);
    try {
      const res = await api.syncSubscription(id);
      const updated = await api.getSubscriptions();
      setSubscriptions(updated);
      setSubToast(res.message);
      setTimeout(() => setSubToast(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubToast(`同步失败: ${msg}`);
      setTimeout(() => setSubToast(null), 3500);
    } finally {
      setSyncingSubId(null);
    }
  };

  const handleSyncAllSubs = async () => {
    setIsSyncing(true);
    try {
      const results = await api.syncAllSubscriptions();
      const updated = await api.getSubscriptions();
      setSubscriptions(updated);
      const count = results.reduce((acc, r) => acc + (r.source_count || 0), 0);
      setSubToast(`全部订阅同步完成，已载入 ${count} 个采集源`);
      setTimeout(() => setSubToast(null), 3500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubToast(`同步失败: ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteSub = async (id: string) => {
    if (!confirm('确定要删除此订阅源吗？')) return;
    await api.deleteSubscription(id);
    const updated = await api.getSubscriptions();
    setSubscriptions(updated);
  };

  const handleToggleSub = async (sub: SubscriptionItem) => {
    const updated = subscriptions.map((s) =>
      s.id === sub.id ? { ...s, enabled: !s.enabled } : s
    );
    setSubscriptions(updated);
    await api.saveSubscriptions(updated);
  };

  const handleSaveTaxonomy = async (newTax: UserTaxonomyConfig) => {
    setTaxonomy(newTax);
    clearVodCache();
    await api.saveTaxonomy(newTax);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
    onTaxonomyUpdated?.();
  };

  const handleToggleAdultMode = async (enabled: boolean) => {
    if (!taxonomy) return;
    clearVodCache();
    const newTax = { ...taxonomy, adult_mode: enabled };
    await handleSaveTaxonomy(newTax);
    if (settings) {
      await handleSave({ ...settings, adult_mode_enabled: enabled });
    }
  };

  const handleAddLocalCategory = () => {
    if (!taxonomy) return;
    const name = newCatName.trim();
    const rawTag = newCatTag.trim() || `#${name.toLowerCase()}`;
    const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
    const cleanId = tag.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `cat_${Date.now()}`;
    if (!name) return;
    const newCat: LocalCategory = {
      id: cleanId,
      name,
      bind_tags: [tag],
    };
    const updated = {
      ...taxonomy,
      categories: [...taxonomy.categories, newCat],
    };
    handleSaveTaxonomy(updated);
    setNewCatName('');
    setNewCatTag('');
  };

  const handleRemoveLocalCategory = (catId: string) => {
    if (!taxonomy) return;
    const targetCat = taxonomy.categories.find((c) => c.id === catId);
    if (!targetCat) return;

    const boundSources: { sourceName: string; count: number }[] = [];
    for (const src of sourcesList) {
      let count = 0;
      for (const tag of targetCat.bind_tags) {
        const ids = src.category_mapping?.[tag] || [];
        count += ids.length;
      }
      if (count > 0) {
        boundSources.push({ sourceName: src.name, count });
      }
    }

    if (boundSources.length > 0) {
      const detail = boundSources
        .map((b) => `${b.sourceName} (${b.count}个分类)`)
        .join('、');
      const confirmed = confirm(
        `【${targetCat.name}】绑定的标签 [${targetCat.bind_tags.join(', ')}] 目前正在被以下采集源使用：\n${detail}\n\n确认删除此频道吗？删除后，下方对应源站中绑定的分类将自动标红提示您重新映射。`
      );
      if (!confirmed) return;
    }

    const updated = {
      ...taxonomy,
      categories: taxonomy.categories.filter((c) => c.id !== catId),
    };
    handleSaveTaxonomy(updated);
  };



  const handleAddBlockedTag = (tag: string) => {
    if (!taxonomy) return;
    const t = (tag || newBlockedTag).trim();
    if (!t) return;
    const finalTag = t.startsWith('#') ? t : `#${t}`;
    if (taxonomy.blocked_tags.includes(finalTag)) return;
    handleSaveTaxonomy({
      ...taxonomy,
      blocked_tags: [...taxonomy.blocked_tags, finalTag],
    });
    setNewBlockedTag('');
  };

  const handleRemoveBlockedTag = (tag: string) => {
    if (!taxonomy) return;
    handleSaveTaxonomy({
      ...taxonomy,
      blocked_tags: taxonomy.blocked_tags.filter((t) => t !== tag),
    });
  };

  const handleAddBlockedTypeId = () => {
    if (!taxonomy) return;
    const id = newBlockedTypeId.trim();
    if (!id) return;
    if (taxonomy.blocked_type_ids.includes(id)) return;
    handleSaveTaxonomy({
      ...taxonomy,
      blocked_type_ids: [...taxonomy.blocked_type_ids, id],
    });
    setNewBlockedTypeId('');
  };

  const handleRemoveBlockedTypeId = (id: string) => {
    if (!taxonomy) return;
    handleSaveTaxonomy({
      ...taxonomy,
      blocked_type_ids: taxonomy.blocked_type_ids.filter((i) => i !== id),
    });
  };


  useEffect(() => {
    api.getCustomAliases().then(setCustomAliases).catch(console.error);
  }, []);

  const handleAddAlias = async () => {
    const from = newAliasFrom.trim();
    const to = newAliasTo.trim();
    if (!from || !to) return;
    const updated = { ...customAliases, [from]: to };
    setCustomAliases(updated);
    await api.saveCustomAliases(updated);
    setNewAliasFrom('');
    setNewAliasTo('');
  };

  const handleRemoveAlias = async (key: string) => {
    const updated = { ...customAliases };
    delete updated[key];
    setCustomAliases(updated);
    await api.saveCustomAliases(updated);
  };

  const handleSyncSubscription = async () => {
    if (!settings) return;
    const url = settings.alias_subscription_url?.trim();
    if (!url) {
      alert('请先输入有效的规则订阅链接 (HTTP/HTTPS)');
      return;
    }
    setIsSyncing(true);
    try {
      const count = await api.syncAliasSubscription(url);
      setSyncToast(`成功同步 ${count} 条别名规则！`);
      setTimeout(() => setSyncToast(null), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '同步失败';
      alert(`订阅同步错误: ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSave = async (updated: AppSettings) => {
    setSettings(updated);
    await api.saveSettings(updated);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  };

  const addKeyword = () => {
    if (!settings) return;
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (settings.ad_block_keywords.includes(trimmed)) {
      setNewKeyword('');
      return;
    }
    const updated: AppSettings = {
      ...settings,
      ad_block_keywords: [...settings.ad_block_keywords, trimmed],
    };
    handleSave(updated);
    setNewKeyword('');
  };

  const removeKeyword = (kw: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      ad_block_keywords: settings.ad_block_keywords.filter((k: string) => k !== kw),
    };
    handleSave(updated);
  };

  const handleClearHistory = async () => {
    if (!confirm('确定要清空全部播放历史记录吗？')) return;
    await api.clearHistory();
    alert('已成功清空播放历史记录！');
  };

  const handleResetDefaults = async () => {
    if (!confirm('确定要恢复默认设置吗？')) return;
    try {
      const defaults = await api.resetDefaultSettings();
      setSettings(defaults);
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 2000);
    } catch (e) {
      console.error('Failed to reset default settings from config:', e);
    }
  };

  const handleResetTaxonomy = async () => {
    if (!confirm('确定要恢复默认频道分类体系吗？自定义频道将被重置')) return;
    try {
      const def = await api.resetDefaultTaxonomy();
      setTaxonomy(def);
      clearVodCache();
      onTaxonomyUpdated?.();
      setMappingToast('已恢复默认分类体系');
      setTimeout(() => setMappingToast(null), 2000);
    } catch (e) {
      console.error('Failed to reset default taxonomy from config:', e);
    }
  };

  const handleOpenDownloadDir = async () => {
    if (!settings) return;
    const targetDir = settings.download_dir || defaultDownloadDir;
    if (targetDir) {
      await api.openDownloadDir(targetDir);
    }
  };

  const handlePickDownloadDir = async () => {
    if (!settings) return;
    try {
      const selected = await api.pickDownloadDir();
      if (selected) {
        handleSave({ ...settings, download_dir: selected });
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground text-xs space-y-3">
        <RotateCw className="w-5 h-5 animate-spin text-primary" />
        <span>正在从本地配置读取系统设置...</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 select-none animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/80">
        <div>
          <h2 className="text-sm font-semibold text-foreground">系统偏好设置</h2>
          <p className="text-xs text-muted-foreground mt-0.5">配置播放体验、智能去广告与离线下载参数</p>
        </div>
        {saveToast && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-secondary border border-border text-foreground rounded-md text-xs font-medium animate-fade-in shadow-sm">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>已保存</span>
          </div>
        )}
      </div>

      {/* 1. 广告过滤 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">智能广告过滤</h3>
              <p className="text-[11px] text-muted-foreground">
                净化剧集名称中的博彩水印、清除引流信息与简介外链
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.ad_block_enabled}
            onChange={(e) => handleSave({ ...settings, ad_block_enabled: e.target.checked })}
            className="w-4 h-4 accent-zinc-200 cursor-pointer"
          />
        </div>

        {settings.ad_block_enabled && (
          <div className="pt-3 border-t border-border/80 space-y-2.5">
            <label className="block text-[11px] text-muted-foreground">
              广告拦截敏感关键词词库:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {settings.ad_block_keywords.map((kw: string) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary border border-border rounded text-[11px] text-foreground/90"
                >
                  <span>{kw}</span>
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="text-muted-foreground hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 max-w-xs pt-1">
              <Input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                placeholder="添加过滤词，回车添加"
                className="h-8 text-xs"
              />
              <Button variant="secondary" size="sm" onClick={addKeyword} className="h-8 text-xs gap-1">
                <Plus className="w-3 h-3" /> 添加
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 2. 播放设置 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Play className="w-4 h-4 text-muted-foreground fill-current" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">播放器设置</h3>
            <p className="text-[11px] text-muted-foreground">智能跳过片头片尾与默认倍速</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border/80 text-xs">
          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div>
              <div className="font-medium text-foreground">自动连播下一集</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">当前集结束自动播放下集</div>
            </div>
            <input
              type="checkbox"
              checked={settings.auto_play_next}
              onChange={(e) => handleSave({ ...settings, auto_play_next: e.target.checked })}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div>
              <div className="font-medium text-foreground">默认倍速</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">开播初始播放速率</div>
            </div>
            <select
              value={settings.playback_rate}
              onChange={(e) => handleSave({ ...settings, playback_rate: parseFloat(e.target.value) })}
              className="appearance-none bg-secondary/80 border border-border rounded-lg px-2.5 py-1 text-xs text-foreground pr-7 cursor-pointer"
            >
              {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div>
              <div className="font-medium text-foreground">智能跳过片头</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">开播自动快进秒数</div>
            </div>
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                min={0}
                max={300}
                step={5}
                value={settings.skip_intro_seconds}
                onChange={(e) =>
                  handleSave({
                    ...settings,
                    skip_intro_seconds: Math.max(0, parseInt(e.target.value) || 0),
                  })
                }
                className="w-14 px-1.5 py-0.5 bg-secondary border border-border rounded text-center text-foreground text-xs"
              />
              <span className="text-muted-foreground text-[10px]">秒</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div>
              <div className="font-medium text-foreground">智能跳过片尾</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">结束前提前换集秒数</div>
            </div>
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                min={0}
                max={300}
                step={5}
                value={settings.skip_outro_seconds}
                onChange={(e) =>
                  handleSave({
                    ...settings,
                    skip_outro_seconds: Math.max(0, parseInt(e.target.value) || 0),
                  })
                }
                className="w-14 px-1.5 py-0.5 bg-secondary border border-border rounded text-center text-foreground text-xs"
              />
              <span className="text-muted-foreground text-[10px]">秒</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl sm:col-span-2">
            <div>
              <div className="font-medium text-foreground">长按快进键偏好</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">播放器按住右方向键时的快捷响应逻辑</div>
            </div>
            <select
              value={settings.long_press_action || 'speed_up'}
              onChange={(e) =>
                handleSave({
                  ...settings,
                  long_press_action: e.target.value as 'speed_up' | 'continuous_seek',
                })
              }
              className="appearance-none bg-secondary/80 border border-border rounded-lg px-2.5 py-1 text-xs text-foreground pr-7 cursor-pointer"
            >
              <option value="speed_up">倍速播放 (2.0x 极速，松开恢复，默认)</option>
              <option value="continuous_seek">连续快进 (每步跳跃 10 秒)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. 离线下载设置 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Download className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">离线下载设置</h3>
            <p className="text-[11px] text-muted-foreground">本地存储目录与并行下载数</p>
          </div>
        </div>

        <div className="space-y-3 pt-3 border-t border-border/80 text-xs">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">保存路径:</label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={settings.download_dir || defaultDownloadDir}
                onChange={(e) => handleSave({ ...settings, download_dir: e.target.value })}
                placeholder="例如: D:\uuMovies\Downloads"
                className="h-8 text-xs font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handlePickDownloadDir}
                className="h-8 gap-1.5 text-xs flex-shrink-0 cursor-pointer"
                title="选择下载保存文件夹"
              >
                <Folder className="w-3.5 h-3.5 text-primary" /> 选择目录
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleOpenDownloadDir}
                className="h-8 gap-1.5 text-xs flex-shrink-0 cursor-pointer"
                title="在系统文件管理器中打开"
              >
                <FolderOpen className="w-3.5 h-3.5" /> 打开
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl max-w-xs">
            <div>
              <div className="font-medium text-foreground">最大并发下载数</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">并行任务限制</div>
            </div>
            <select
              value={settings.concurrent_downloads}
              onChange={(e) =>
                handleSave({ ...settings, concurrent_downloads: parseInt(e.target.value) || 3 })
              }
              className="appearance-none bg-secondary/80 border border-border rounded-lg px-2.5 py-1 text-xs text-foreground pr-7 cursor-pointer"
            >
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 个
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 4. 智能别名与在线规则订阅 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Bookmark className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">别名映射与规则订阅</h3>
              <p className="text-[11px] text-muted-foreground">
                支持配置网络订阅链接定期同步社区别名规则，或手动自定义别名与缩写映射
              </p>
            </div>
          </div>
          {syncToast && (
            <span className="text-xs text-emerald-400 font-medium animate-fade-in">
              {syncToast}
            </span>
          )}
        </div>

        <div className="space-y-4 pt-3 border-t border-border/80 text-xs">
          {/* Subscription URL */}
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              在线别名规则订阅 URL (JSON 格式):
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={settings.alias_subscription_url || ''}
                onChange={(e) =>
                  handleSave({ ...settings, alias_subscription_url: e.target.value })
                }
                placeholder="例如: https://raw.githubusercontent.com/.../aliases.json"
                className="h-8 text-xs font-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={isSyncing}
                onClick={handleSyncSubscription}
                className="h-8 gap-1.5 text-xs flex-shrink-0"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? '正在同步...' : '立即同步'}</span>
              </Button>
            </div>
          </div>

          {/* Custom Aliases List */}
          <div className="space-y-2">
            <label className="block text-[11px] text-muted-foreground">
              本地自定义映射表 ({Object.keys(customAliases).length} 条):
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto scrollbar-thin">
              {Object.entries(customAliases).map(([from, to]) => (
                <span
                  key={from}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-secondary border border-border rounded text-[11px] text-foreground"
                >
                  <span className="text-muted-foreground font-mono">{from}</span>
                  <span className="text-muted-foreground/80">➔</span>
                  <span className="text-foreground font-medium">{to}</span>
                  <button
                    onClick={() => handleRemoveAlias(from)}
                    className="text-muted-foreground hover:text-rose-400 cursor-pointer ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Add Custom Alias */}
            <div className="flex items-center gap-2 max-w-md pt-1">
              <Input
                type="text"
                value={newAliasFrom}
                onChange={(e) => setNewAliasFrom(e.target.value)}
                placeholder="别名 (如: 药神)"
                className="h-8 text-xs flex-1"
              />
              <span className="text-muted-foreground/80">➔</span>
              <Input
                type="text"
                value={newAliasTo}
                onChange={(e) => setNewAliasTo(e.target.value)}
                placeholder="标准剧名 (如: 我不是药神)"
                className="h-8 text-xs flex-1"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddAlias}
                className="h-8 text-xs gap-1 flex-shrink-0"
              >
                <Plus className="w-3 h-3" /> 添加
              </Button>
            </div>
          </div>
        </div>
      </div>
      {/* 5. 采集源订阅 (Clash 风格 URL 订阅与自动同步) */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Rss className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">采集源订阅管理</h3>
              <p className="text-[11px] text-muted-foreground">
                支持从远程 URL 导入社区维护的采集源规则包，支持 ETag 差分增量与定时自动更新
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {subToast && (
              <span className="text-xs text-emerald-400 font-medium animate-fade-in">
                {subToast}
              </span>
            )}
            {subscriptions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={isSyncing}
                onClick={handleSyncAllSubs}
                className="h-7 text-xs gap-1.5"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>一键同步全部</span>
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4 pt-3 border-t border-border/80 text-xs">
          {/* Add Subscription */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Input
              type="text"
              placeholder="订阅包地址 URL (例如: https://.../sources.json)"
              value={newSubUrl}
              onChange={(e) => setNewSubUrl(e.target.value)}
              className="h-8 text-xs font-mono flex-1 min-w-[200px]"
            />
            <Input
              type="text"
              placeholder="订阅备注 (选填)"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              className="h-8 text-xs w-36 flex-shrink-0"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddSubscription}
              disabled={!newSubUrl.trim()}
              className="h-8 text-xs gap-1 flex-shrink-0"
            >
              <Plus className="w-3 h-3" /> 导入订阅
            </Button>
          </div>

          {/* Subscriptions List */}
          <div className="space-y-2">
            {subscriptions.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground/80 bg-secondary/40 border border-border/80 rounded-xl">
                暂无远程订阅源，可点击上方导入公开订阅包，或在「采集源管理」中手动添加
              </div>
            ) : (
              subscriptions.map((sub) => {
                const isThisSyncing = syncingSubId === sub.id;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl hover:border-border transition-colors"
                  >
                    <div className="space-y-1 min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={sub.enabled}
                          onChange={() => handleToggleSub(sub)}
                          className="w-3.5 h-3.5 accent-zinc-200 cursor-pointer"
                          title="开启/停用此订阅"
                        />
                        <span className="font-medium text-foreground text-xs truncate">
                          {sub.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-card border border-border text-muted-foreground font-mono">
                          {sub.source_count} 个源
                        </span>
                        {sub.last_updated > 0 && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            更新于: {new Date(sub.last_updated * 1000).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">
                        {sub.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isThisSyncing}
                        onClick={() => handleSyncSingleSub(sub.id)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                        title="立即从远程同步此订阅"
                      >
                        <RotateCw className={`w-3 h-3 ${isThisSyncing ? 'animate-spin' : ''}`} />
                        <span>{isThisSyncing ? '同步中' : '同步'}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteSub(sub.id)}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-400"
                        title="删除此订阅"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 6. 本地分类与语义标签 (解决用户分类各异问题) */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">本地分类体系与语义标签</h3>
              <p className="text-[11px] text-muted-foreground">
                定义本地频道的呈现结构；采集源通过语义标签（如 #movie, #tv）无缝映射到此，避免分类冲突
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetTaxonomy}
            className="text-[11px] h-7 gap-1 text-muted-foreground hover:text-foreground"
            title="从内置配置重置本地分类体系"
          >
            <RotateCcw className="w-3 h-3" /> 重置默认分类
          </Button>
        </div>

        <div className="space-y-4 pt-3 border-t border-border/80 text-xs">
          {/* Local Categories List */}
          <div className="space-y-2">
            <label className="block text-[11px] text-muted-foreground font-medium">
              当前本地频道列表 ({(taxonomy?.categories || []).length} 个):
            </label>
            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 bg-secondary/40 border border-border/80 rounded-xl">
              {(taxonomy?.categories || []).map((cat) => (
                <span
                  key={cat.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-card border border-border text-foreground rounded text-xs"
                >
                  <span className="font-medium">{cat.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {cat.bind_tags.join(', ')}
                  </span>
                  <button
                    onClick={() => handleRemoveLocalCategory(cat.id)}
                    className="text-muted-foreground hover:text-rose-400 transition-colors ml-0.5 cursor-pointer"
                    title="删除此频道"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Add Local Category */}
          <div className="flex items-center gap-2 max-w-md pt-1">
            <Input
              type="text"
              placeholder="频道名称 (例如: 微剧)"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <Input
              type="text"
              placeholder="绑定标签 (例如: #short_drama)"
              value={newCatTag}
              onChange={(e) => setNewCatTag(e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddLocalCategory}
              disabled={!newCatName.trim()}
              className="h-8 text-xs gap-1 flex-shrink-0"
            >
              <Plus className="w-3 h-3" /> 添加频道
            </Button>
          </div>
        </div>
      </div>

      {/* 7. 源站分类映射与 18+ 规则自定义 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">源站分类映射与 18+ 规则自定义</h3>
              <p className="text-[11px] text-muted-foreground">
                自主编辑每个采集站的原始分类（type_id）对应的标准语义标签及成人 18+ 标记
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mappingToast && (
              <span className="text-xs text-emerald-500 font-medium animate-fade-in">
                {mappingToast}
              </span>
            )}
            {onOpenSourceManager && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenSourceManager}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                title="打开采集源综合管理面板"
              >
                <Globe className="w-3.5 h-3.5 text-primary" />
                <span>源管理中心</span>
              </Button>
            )}
            {currentMappingSource && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteCurrentSource}
                className="h-7 text-xs gap-1 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                title="彻底删除当前采集源及其全部映射规则"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除此源</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsMappingJsonMode(!isMappingJsonMode)}
              className="h-7 text-xs gap-1"
            >
              <Code className="w-3.5 h-3.5" />
              <span>{isMappingJsonMode ? '可视化模式' : '高级 JSON'}</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSaveCurrentSourceMapping}
              className="h-7 text-xs gap-1 bg-primary text-primary-foreground font-semibold"
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存当前规则</span>
            </Button>
          </div>
        </div>
        <div className="space-y-4 pt-3 border-t border-border/80 text-xs">
          {/* Source Selector */}
          <div className="flex items-center justify-between gap-3 bg-secondary/50 p-2.5 rounded-xl border border-border/60">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">配置目标采集源:</span>
              <select
                value={mappingSourceId}
                onChange={(e) => setMappingSourceId(e.target.value)}
                className="bg-card border border-border rounded-lg px-2.5 py-1 text-xs text-foreground font-medium cursor-pointer"
              >
                <optgroup label="✅ 启用中的采集源">
                  {sourcesList
                    .filter((s) => s.enabled)
                    .map((src) => (
                      <option key={src.id} value={src.id}>
                        {src.name} ({Object.values(src.category_mapping || {}).flat().length} 条映射)
                      </option>
                    ))}
                </optgroup>
                {sourcesList.some((s) => !s.enabled) && (
                  <optgroup label="⏸️ 已禁用的采集源 (规则暂不生效)">
                    {sourcesList
                      .filter((s) => !s.enabled)
                      .map((src) => (
                        <option key={src.id} value={src.id}>
                          {src.name} [已禁用] ({Object.values(src.category_mapping || {}).flat().length} 条映射)
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
              <button
                type="button"
                onClick={handleRefreshSourceClasses}
                disabled={isRefreshingClasses}
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors cursor-pointer"
                title="重新向源站拉取原始分类"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isRefreshingClasses ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground font-mono">
                发现 {mappingClasses.length} 个原始分类
              </span>
              {onOpenSourceManager && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenSourceManager}
                  className="h-7 text-xs gap-1.5"
                  title="打开采集源管理，可统一配置测速、启禁用与映射"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>管理全部源</span>
                </Button>
              )}
            </div>
          </div>
          {currentMappingSource && !currentMappingSource.enabled && (
            <div className="flex items-center justify-between p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  【{currentMappingSource.name}】当前已禁用，其分类映射规则暂不参与频道解析。
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const updatedList = sourcesList.map((s) =>
                    s.id === currentMappingSource.id ? { ...s, enabled: true } : s
                  );
                  setSourcesList(updatedList);
                  clearVodCache(currentMappingSource.id);
                  await api.saveSources(updatedList);
                  onSourcesUpdated?.();
                }}
                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-xs cursor-pointer transition-colors"
              >
                立即启用此源
              </button>
            </div>
          )}

          {/* Editor Body */}
          {isMappingJsonMode ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>直接编辑 JSON 格式的 adult_type_ids 与 category_mapping:</span>
                <span className="font-mono text-[10px]">JSON 模式</span>
              </div>
              <textarea
                value={mappingJsonText}
                onChange={(e) => setMappingJsonText(e.target.value)}
                rows={12}
                className="w-full bg-secondary/30 border border-border rounded-xl p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="{\n  &quot;adult_type_ids&quot;: [],\n  &quot;category_mapping&quot;: {}\n}"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1">
                <span>源站分类名称与 ID</span>
                <div className="flex items-center gap-6">
                  <span>映射标准语义标签</span>
                  <span className="w-14 text-center">18+ 标记</span>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-1.5 pr-1">
                {mappingClasses.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground bg-secondary/20 rounded-xl">
                    正在读取该源站分类定义，或请稍后重试...
                  </div>
                ) : (
                  mappingClasses.map((cat) => {
                    let assignedTag = 'unmapped';
                    const mapping = currentMappingSource?.category_mapping || {};
                    for (const [tag, ids] of Object.entries(mapping)) {
                      if (ids.includes(cat.type_id)) {
                        assignedTag = tag;
                        break;
                      }
                    }
                    const isAdult = (currentMappingSource?.adult_type_ids || []).includes(
                      cat.type_id
                    );
                    const isTagOrphaned =
                      assignedTag !== 'unmapped' &&
                      !availableTags.some((t) => t.tag === assignedTag);

                    return (
                      <div
                        key={cat.type_id}
                        className={cn(
                          'flex items-center justify-between p-2 rounded-lg border transition-colors',
                          isTagOrphaned
                            ? 'bg-rose-500/10 border-rose-500/50 hover:bg-rose-500/15'
                            : 'bg-secondary/30 hover:bg-secondary/60 border-border/50'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-foreground text-xs truncate">
                            {cat.type_name}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-secondary border border-border text-muted-foreground font-mono">
                            ID: {cat.type_id}
                          </span>
                          {cat.type_pid && cat.type_pid !== '0' && (
                            <span className="text-[10px] text-muted-foreground/70 font-mono">
                              PID: {cat.type_pid}
                            </span>
                          )}
                          {isTagOrphaned && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-500 border border-rose-500/30 font-medium">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              <span>原标签【{assignedTag}】已删除，请重新指定</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-4 flex-shrink-0">
                          <select
                            value={assignedTag}
                            onChange={(e) =>
                              handleUpdateCategoryTag(cat.type_id, e.target.value)
                            }
                            className={cn(
                              'appearance-none bg-card border rounded px-2.5 py-1 text-xs text-foreground pr-7 cursor-pointer',
                              isTagOrphaned
                                ? 'border-rose-500 text-rose-500 font-semibold'
                                : 'border-border'
                            )}
                          >
                            <option value="unmapped">不映射 (透传)</option>
                            {isTagOrphaned && (
                              <option value={assignedTag} className="text-rose-500 font-bold">
                                {assignedTag} (已失效/需修改)
                              </option>
                            )}
                            {availableTags.map((item) => (
                              <option key={item.tag} value={item.tag}>
                                {item.tag} ({item.name})
                              </option>
                            ))}
                          </select>

                          <div className="w-14 flex justify-center">
                            <input
                              type="checkbox"
                              checked={isAdult}
                              onChange={(e) =>
                                handleToggleCategoryAdult(cat.type_id, e.target.checked)
                              }
                              className="w-4 h-4 accent-rose-500 cursor-pointer"
                              title="设为18+成人分类"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 7. 内容分级与递归树屏蔽 (18+模式与 type_pid 级联) */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">内容安全分级与递归屏蔽</h3>
            <p className="text-[11px] text-muted-foreground">
              18+ 成人保护模式，以及源站分类 ID 树状递归级联屏蔽（支持自动屏蔽所有子类）
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-3 border-t border-border/80 text-xs">
          {/* 18+ Mode Toggle */}
          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">18+ 成人分级模式</span>
                {taxonomy?.adult_mode ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/80 border border-rose-800 text-rose-300 font-mono font-medium flex items-center gap-1">
                    <Flame className="w-2.5 h-2.5 text-rose-400" /> 已启用
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-mono font-medium flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5 text-emerald-400" /> 保护中
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {taxonomy?.adult_mode
                  ? '已解除限制：展示源站 adultTypeIds、#18plus 以及源站伦理分类下的全部递归子类'
                  : '未成年人保护：自动过滤伦理片、福利短剧及通过 type_pid 继承的全部下级成人内容'}
              </p>
            </div>
            <input
              type="checkbox"
              checked={taxonomy?.adult_mode ?? false}
              onChange={(e) => handleToggleAdultMode(e.target.checked)}
              className="w-4 h-4 accent-rose-500 cursor-pointer"
            />
          </div>

          {/* Blocked Semantic Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] text-muted-foreground font-medium">
                屏蔽语义标签 ({(taxonomy?.blocked_tags || []).length} 个):
              </label>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>快捷屏蔽:</span>
                {['#sports', '#trailer', '#variety'].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleAddBlockedTag(tag)}
                    disabled={(taxonomy?.blocked_tags || []).includes(tag)}
                    className="hover:text-foreground/90 underline cursor-pointer disabled:opacity-40 disabled:no-underline font-mono"
                  >
                    +{tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-secondary/40 border border-border/80 rounded-xl">
              {(taxonomy?.blocked_tags || []).length === 0 ? (
                <span className="text-[11px] text-muted-foreground/80">未设置任何屏蔽标签</span>
              ) : (
                (taxonomy?.blocked_tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-card border border-border text-foreground/90 rounded text-xs font-mono"
                  >
                    <span>{tag}</span>
                    <button
                      onClick={() => handleRemoveBlockedTag(tag)}
                      className="text-muted-foreground hover:text-rose-400 transition-colors ml-0.5 cursor-pointer"
                      title="取消屏蔽"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Blocked Source Type IDs with Recursive PID Cascade tip */}
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-[11px] text-muted-foreground font-medium">
                  按源站分类 ID 递归屏蔽 (Tree Cascade Block):
                </label>
                <p className="text-[10px] text-muted-foreground">
                  提示：若屏蔽父分类（例如 22），则其包含的子分类与孙分类（type_pid 链）将全部自动静默屏蔽
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-secondary/40 border border-border/80 rounded-xl">
              {(taxonomy?.blocked_type_ids || []).length === 0 ? (
                <span className="text-[11px] text-muted-foreground/80">未设置任何具体分类 ID 屏蔽</span>
              ) : (
                (taxonomy?.blocked_type_ids || []).map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-card border border-border text-foreground/90 rounded text-xs font-mono"
                  >
                    <span>ID: {id} 及所有子类</span>
                    <button
                      onClick={() => handleRemoveBlockedTypeId(id)}
                      className="text-muted-foreground hover:text-rose-400 transition-colors ml-0.5 cursor-pointer"
                      title="取消屏蔽"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex items-center gap-2 max-w-sm pt-1">
              <Input
                type="text"
                placeholder="输入源站分类 ID (例如: 22)"
                value={newBlockedTypeId}
                onChange={(e) => setNewBlockedTypeId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBlockedTypeId()}
                className="h-8 text-xs font-mono"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddBlockedTypeId}
                className="h-8 gap-1 text-xs flex-shrink-0"
              >
                <Plus className="w-3 h-3" /> 级联屏蔽
              </Button>
            </div>
          </div>
        </div>
      </div>


      {/* 4. 关于与更新 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <ArrowUpCircle className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">关于与更新</h3>
            <p className="text-[11px] text-muted-foreground">
              当前版本 v{updater.currentVersion || '—'} · 从 GitHub Releases 检查并安装新版本
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-3 border-t border-border/80 text-xs">
          <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/80 rounded-xl">
            <div>
              <div className="font-medium text-foreground">自动检查更新</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                启动时及每 6 小时静默检查一次新版本
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.auto_update_enabled !== false}
              onChange={(e) => {
                setAutoCheckEnabled(e.target.checked);
                handleSave({ ...settings, auto_update_enabled: e.target.checked });
              }}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-muted-foreground min-w-0">
            {updater.status === 'checking' && '正在检查更新…'}
            {updater.status === 'up-to-date' && '已是最新版本'}
            {updater.status === 'available' && updater.info && (
              <span className="text-primary font-medium">
                发现新版本 v{updater.info.latest_version}
              </span>
            )}
            {updater.status === 'downloading' && `正在下载更新包 ${Math.round(updater.progress * 100)}%`}
            {updater.status === 'verifying' && '正在校验更新包完整性…'}
            {updater.status === 'installing' && '正在安装并重启应用…'}
            {updater.status === 'error' && (
              <span className="text-rose-400">{updater.error || '检查更新失败'}</span>
            )}
            {updater.status === 'idle' && '尚未检查更新'}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {updater.status === 'available' && updater.info && (
              <Button
                size="sm"
                onClick={() => void installUpdate()}
                className="text-xs gap-1.5"
              >
                <Download className="w-3 h-3" />
                {`更新到 v${updater.info.latest_version}`}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void checkForUpdates(true)}
              disabled={updater.status === 'checking'}
              className="text-xs gap-1.5"
            >
              <RefreshCw
                className={cn('w-3 h-3', updater.status === 'checking' && 'animate-spin')}
              />
              检查更新
            </Button>
          </div>
        </div>
      </div>

      {/* 5. 数据清理 */}
      <div className="bg-card border border-border shadow-sm rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">存储与重置</h3>
            <p className="text-[11px] text-muted-foreground">清理本地缓存或重置设置</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-3 border-t border-border/80 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleClearHistory} className="text-xs text-muted-foreground hover:text-rose-400">
            清空播放历史记录
          </Button>
          <Button variant="ghost" size="sm" onClick={handleResetDefaults} className="text-xs text-muted-foreground hover:text-foreground gap-1.5">
            <RotateCcw className="w-3 h-3" /> 恢复默认设置
          </Button>
        </div>
      </div>
    </div>
  );
};
