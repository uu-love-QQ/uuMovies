import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Download,
  Upload,
  Globe,
  Radio,
  Sparkles,
  SlidersHorizontal,
  Code,
  Check,
  Search,
} from 'lucide-react';
import type { Source, TestResult, Category, UserTaxonomyConfig } from '../types';
import { api } from '../services/api';
import { clearVodCache } from '../lib/vodCache';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
interface SourceManagerModalProps {
  sources: Source[];
  activeSourceId: string;
  onSelectActiveSource: (sourceId: string) => void;
  onRefreshSources: () => void;
  onClose: () => void;
}

export const SourceManagerModal: React.FC<SourceManagerModalProps> = ({
  sources,
  activeSourceId,
  onSelectActiveSource,
  onRefreshSources,
  onClose,
}) => {
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [isTestingAll, setIsTestingAll] = useState(false);

  // Add/Edit modal state
  const [isEditing, setIsEditing] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formType, setFormType] = useState<'auto' | 'json' | 'xml'>('auto');
  const [formGroup, setFormGroup] = useState('默认源');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  // Category Mapping state
  const [taxonomy, setTaxonomy] = useState<UserTaxonomyConfig | null>(null);
  const [mappingSource, setMappingSource] = useState<Source | null>(null);
  const [mappingClasses, setMappingClasses] = useState<Category[]>([]);
  const [isRefreshingClasses, setIsRefreshingClasses] = useState(false);
  const [isMappingJsonMode, setIsMappingJsonMode] = useState(false);
  const [mappingJsonText, setMappingJsonText] = useState('');
  const [mappingSearch, setMappingSearch] = useState('');
  const [mappingToast, setMappingToast] = useState<string | null>(null);

  useEffect(() => {
    api.getTaxonomy().then(setTaxonomy).catch(console.error);
  }, []);

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
    if (taxonomy.adult_mode && !list.some((item) => item.tag === '#18plus')) {
      list.push({ tag: '#18plus', name: '18+' });
    }
    return list;
  }, [taxonomy]);

  const openMappingModal = (src: Source) => {
    setMappingSource(src);
    setMappingSearch('');
    setIsMappingJsonMode(false);
    const configData = {
      adult_type_ids: src.adult_type_ids || [],
      category_mapping: src.category_mapping || {},
    };
    setMappingJsonText(JSON.stringify(configData, null, 2));
    setIsRefreshingClasses(true);
    api
      .getSourceClasses(src.id)
      .then((cls) => {
        setMappingClasses(cls || []);
      })
      .catch(console.error)
      .finally(() => setIsRefreshingClasses(false));
  };

  const handleUpdateCategoryTag = async (typeId: string, newTag: string) => {
    if (!mappingSource) return;
    const currentMapping = { ...(mappingSource.category_mapping || {}) };

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

    const updatedSource: Source = {
      ...mappingSource,
      category_mapping: currentMapping,
    };
    setMappingSource(updatedSource);
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

    const updatedList = sources.map((s) =>
      s.id === mappingSource.id ? updatedSource : s
    );
    clearVodCache(mappingSource.id);
    try {
      await api.saveSources(updatedList);
      onRefreshSources();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleCategoryAdult = async (typeId: string, isAdult: boolean) => {
    if (!mappingSource) return;
    let adults = [...(mappingSource.adult_type_ids || [])];
    if (isAdult) {
      if (!adults.includes(typeId)) adults.push(typeId);
    } else {
      adults = adults.filter((id) => id !== typeId);
    }

    const updatedSource: Source = {
      ...mappingSource,
      adult_type_ids: adults,
    };
    setMappingSource(updatedSource);
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

    const updatedList = sources.map((s) =>
      s.id === mappingSource.id ? updatedSource : s
    );
    clearVodCache(mappingSource.id);
    try {
      await api.saveSources(updatedList);
      onRefreshSources();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveMappingJson = async () => {
    if (!mappingSource) return;
    try {
      const parsed = JSON.parse(mappingJsonText);
      const updatedSource: Source = {
        ...mappingSource,
        adult_type_ids: parsed.adult_type_ids || [],
        category_mapping: parsed.category_mapping || {},
      };
      setMappingSource(updatedSource);
      const updatedList = sources.map((s) =>
        s.id === mappingSource.id ? updatedSource : s
      );
      clearVodCache(mappingSource.id);
      await api.saveSources(updatedList);
      onRefreshSources();
      setMappingToast('已保存规则');
      setTimeout(() => setMappingToast(null), 2000);
    } catch (e) {
      alert('JSON 格式错误，请检查语法');
    }
  };
  // Open Add modal
  const openAddModal = () => {
    setEditingSource(null);
    setFormName('');
    setFormUrl('');
    setFormType('auto');
    setFormGroup('自定义源');
    setFormError(null);
    setIsEditing(true);
  };

  // Open Edit modal
  const openEditModal = (src: Source) => {
    setEditingSource(src);
    setFormName(src.name);
    setFormUrl(src.api_url);
    setFormType(src.api_type);
    setFormGroup(src.group || '默认源');
    setFormError(null);
    setIsEditing(true);
  };

  // Test single source
  const testSource = async (src: Source) => {
    setTestingIds((prev) => new Set(prev).add(src.id));
    try {
      const res = await api.testSingleSource(src);
      setTestResults((prev) => ({ ...prev, [src.id]: res }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '测试失败';
      setTestResults((prev) => ({
        ...prev,
        [src.id]: {
          source_id: src.id,
          name: src.name,
          ok: false,
          latency_ms: 0,
          categories_count: 0,
          error: msg,
        },
      }));
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(src.id);
        return next;
      });
    }
  };

  // Test all sources
  const testAll = async () => {
    setIsTestingAll(true);
    try {
      const results = await api.testAllSources();
      const map: Record<string, TestResult> = {};
      for (const r of results) {
        map[r.source_id] = r;
      }
      setTestResults(map);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTestingAll(false);
    }
  };

  // Toggle enable/disable
  const toggleEnabled = async (src: Source) => {
    const updated = sources.map((s) =>
      s.id === src.id ? { ...s, enabled: !s.enabled } : s
    );
    await api.saveSources(updated);
    onRefreshSources();
  };

  // Delete source
  const deleteSource = async (srcId: string) => {
    if (!confirm('确定要删除此采集源吗？')) return;
    const updated = sources.filter((s) => s.id !== srcId);
    await api.saveSources(updated);
    if (activeSourceId === srcId && updated.length > 0) {
      onSelectActiveSource(updated[0].id);
    }
    onRefreshSources();
  };

  // Reset to default
  const resetDefault = async () => {
    if (!confirm('确定要恢复内置默认源吗？自定义源可能会被重置')) return;
    const res = await api.resetDefaultSources();
    if (res.length > 0) {
      onSelectActiveSource(res[0].id);
    }
    onRefreshSources();
  };

  // Save add/edit
  const handleSaveSource = async () => {
    setFormError(null);
    const cleanUrl = formUrl.trim();
    const cleanName = formName.trim();
    if (!cleanName) {
      setFormError('请输入采集源名称');
      return;
    }
    if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
      setFormError('请输入有效的采集接口URL (以 http:// 或 https:// 开头)');
      return;
    }

    setIsSaving(true);
    try {
      const targetSource: Source = {
        id: editingSource ? editingSource.id : `custom_${Date.now()}`,
        name: cleanName,
        api_url: cleanUrl,
        api_type: formType,
        enabled: editingSource ? editingSource.enabled : true,
        group: formGroup || '自定义源',
        category_mapping: editingSource?.category_mapping || {},
        adult_type_ids: editingSource?.adult_type_ids || [],
        subscription_id: editingSource?.subscription_id,
      };

      clearVodCache(targetSource.id);
      // Test before adding
      const test = await api.testSingleSource(targetSource);
      if (!test.ok) {
        setFormError(`源连接测试失败: ${test.error || '未知错误'}`);
        setIsSaving(false);
        return;
      }

      let updated: Source[];
      if (editingSource) {
        updated = sources.map((s) => (s.id === editingSource.id ? targetSource : s));
      } else {
        updated = [...sources, targetSource];
      }

      await api.saveSources(updated);
      setIsEditing(false);
      onRefreshSources();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // Export JSON
  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sources, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `movies_sources_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  // Import JSON
  const handleImport = async () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importJson);
      if (!Array.isArray(parsed)) {
        setImportError('JSON格式错误，必须为采集源数组');
        return;
      }
      for (const item of parsed) {
        if (!item.name || !item.api_url) {
          setImportError('源格式不符合规范，缺少 name 或 api_url');
          return;
        }
      }
      await api.saveSources(parsed);
      setShowImportModal(false);
      setImportJson('');
      onRefreshSources();
    } catch (e: unknown) {
      setImportError(`解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl max-h-[85vh] bg-card border border-border rounded-3xl shadow-2xl flex flex-col overflow-hidden text-foreground"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-zinc-400" />
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span>采集源管理</span>
                <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">
                  AppleCMS v10/v8
                </span>
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                支持任意标准苹果CMS JSON/XML 接口，支持多源并发测速与聚合
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-secondary/30 border-b border-border flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 px-3 py-1 bg-primary text-primary-foreground font-semibold rounded-md text-xs shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加源</span>
            </button>
            <button
              onClick={testAll}
              disabled={isTestingAll}
              className="flex items-center gap-1.5 px-3 py-1 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md text-xs font-medium transition-colors cursor-pointer border border-border"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isTestingAll ? 'animate-spin' : ''}`} />
              <span>{isTestingAll ? '测速中...' : '一键测速'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors cursor-pointer"
              title="导入源配置"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入</span>
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors cursor-pointer"
              title="导出源配置"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出</span>
            </button>
            <button
              onClick={resetDefault}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              恢复默认
            </button>
          </div>
        </div>

        {/* Sources List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-thin">
          {sources.map((src) => {
            const isTesting = testingIds.has(src.id) || isTestingAll;
            const testResult = testResults[src.id];
            const isActive = src.id === activeSourceId;

            return (
              <div
                key={src.id}
                className={`p-3.5 rounded-xl border transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isActive
                    ? 'bg-primary/5 border-primary shadow-sm'
                    : 'bg-card border-border hover:border-primary/50'
                } ${!src.enabled ? 'opacity-50' : ''}`}
              >
                {/* Source Info */}
                <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                  <button
                    onClick={() => onSelectActiveSource(src.id)}
                    className="mt-0.5 sm:mt-0 p-1 text-gray-400 hover:text-indigo-400 transition-all"
                    title={isActive ? '当前默认首选源' : '设为当前首选源'}
                  >
                    <Radio className={`w-5 h-5 ${isActive ? 'text-indigo-500 fill-indigo-500/20' : ''}`} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-base font-bold text-foreground truncate">{src.name}</h4>
                      {isActive && (
                        <span className="px-1.5 py-0.2 bg-primary/10 border border-primary/20 text-primary text-[10px] rounded font-medium">
                          首选
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground border border-border/80 rounded uppercase">
                        {src.api_type}
                      </span>
                      {src.group && (
                        <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground border border-border/80 rounded">
                          {src.group}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-1">
                      {src.api_url}
                    </p>
                  </div>
                </div>

                {/* Status & Latency badge */}
                <div className="flex items-center gap-4 self-end md:self-center">
                  <div className="text-right">
                    {isTesting ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                        <Sparkles className="w-3 h-3 animate-spin text-primary" /> 测速中
                      </span>
                    ) : testResult ? (
                      testResult.ok ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{testResult.latency_ms} ms</span>
                          <span className="text-muted-foreground">({testResult.categories_count}分类)</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-rose-400 font-medium" title={testResult.error}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>离线/超时</span>
                        </div>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">未测试</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => testSource(src)}
                      disabled={isTesting}
                      className="p-2 text-muted-foreground hover:text-primary hover:bg-secondary rounded-lg transition-all cursor-pointer"
                      title="单独测速"
                    >
                      <RotateCw className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => toggleEnabled(src)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                        src.enabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : 'bg-secondary text-muted-foreground border border-border'
                      }`}
                    >
                      {src.enabled ? '已启用' : '已禁用'}
                    </button>
                    <button
                      onClick={() => openMappingModal(src)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-md text-xs font-medium transition-all cursor-pointer"
                      title="配置该源分类映射与18+规则"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                      <span>规则映射</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        ({Object.values(src.category_mapping || {}).flat().length})
                      </span>
                    </button>
                    <button
                      onClick={() => openEditModal(src)}
                      className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all cursor-pointer"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteSource(src.id)}
                      className="p-2 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add/Edit Modal Sub-dialog */}
        {isEditing && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6 text-foreground">
              <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
                <h3 className="text-lg font-bold text-foreground">
                  {editingSource ? '编辑采集源' : '添加 AppleCMS 采集源'}
                </h3>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-1.5 text-gray-400 hover:text-white rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-rose-950/60 border border-rose-500/40 text-rose-300 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="space-y-4 text-sm">
                <div>
                  <label className="block text-muted-foreground text-xs font-medium mb-1.5">
                    源名称
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如: 量子高清源"
                    className="w-full px-3.5 py-2.5 bg-secondary/70 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground text-xs font-medium mb-1.5">
                    API 接口地址 (提供给苹果CMS采集的地址)
                  </label>
                  <input
                    type="text"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="例如: https://cj.lziapi.com/api.php/provide/vod/"
                    className="w-full px-3.5 py-2.5 bg-secondary/70 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-muted-foreground text-xs font-medium mb-1.5">
                      接口格式
                    </label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as 'auto' | 'json' | 'xml')}
                      className="w-full px-3 py-2 bg-card border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="auto">自动识别 (推荐)</option>
                      <option value="json">JSON 格式</option>
                      <option value="xml">XML 格式</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-muted-foreground text-xs font-medium mb-1.5">
                      分组标识
                    </label>
                    <input
                      type="text"
                      value={formGroup}
                      onChange={(e) => setFormGroup(e.target.value)}
                      placeholder="自定义源"
                      className="w-full px-3 py-2 bg-secondary/70 border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground rounded-lg text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveSource}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-sm shadow-md transition-all disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin" />
                      <span>正在测试连接...</span>
                    </>
                  ) : (
                    <span>测试并保存</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import JSON Modal */}
        {showImportModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6 text-foreground">
              <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
                <h3 className="text-base font-bold text-foreground">批量导入采集源 (JSON)</h3>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {importError && (
                <div className="mb-3 p-2.5 bg-rose-950/60 border border-rose-500/40 text-rose-300 rounded-lg text-xs">
                  {importError}
                </div>
              )}

              <p className="text-xs text-muted-foreground mb-2">
                粘贴包含源对象的 JSON 数组（可包含 name, api_url, api_type 等字段）：
              </p>

              <textarea
                rows={8}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder='[&#10;  {&#10;    "id": "my_source",&#10;    "name": "示例源",&#10;    "api_url": "https://.../api.php/provide/vod/",&#10;    "api_type": "auto",&#10;    "enabled": true&#10;  }&#10;]'
                className="w-full p-3 bg-secondary/70 border border-border rounded-xl text-foreground font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />

              <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-border">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground rounded-lg text-sm cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleImport}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-sm shadow-md transition-all cursor-pointer"
                >
                  确认导入
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Category Mapping Sub-dialog */}
        {mappingSource && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-3xl max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden text-foreground">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <SlidersHorizontal className="w-5 h-5 text-primary" />
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>【{mappingSource.name}】规则映射</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border font-mono',
                        mappingSource.enabled
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'bg-secondary text-muted-foreground border-border'
                      )}>
                        {mappingSource.enabled ? '已启用 (规则生效)' : '已禁用 (规则暂不生效)'}
                      </span>
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate max-w-md">
                      {mappingSource.api_url}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {mappingToast && (
                    <span className="text-xs text-emerald-500 font-medium animate-fade-in">
                      {mappingToast}
                    </span>
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
                  <button
                    onClick={() => setMappingSource(null)}
                    className="p-1 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {!mappingSource.enabled && (
                <div className="mx-6 mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>当前采集源处于禁用状态，其分类映射不会参与前端频道聚合。</span>
                  </div>
                  <button
                    onClick={() => toggleEnabled(mappingSource)}
                    className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-[11px] cursor-pointer"
                  >
                    立即启用
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-thin">
                {isMappingJsonMode ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      高级模式：直接编辑该源的 adult_type_ids 与 category_mapping 字典。
                    </p>
                    <textarea
                      rows={14}
                      value={mappingJsonText}
                      onChange={(e) => setMappingJsonText(e.target.value)}
                      className="w-full p-3 bg-secondary/50 border border-border rounded-xl text-foreground font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleSaveMappingJson} className="h-8 gap-1.5">
                        <Check className="w-3.5 h-3.5" /> 保存 JSON
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="relative flex-1 max-w-xs">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="过滤源站分类名称或 ID..."
                          value={mappingSearch}
                          onChange={(e) => setMappingSearch(e.target.value)}
                          className="h-8 pl-8 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          共 {mappingClasses.length} 个分类
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openMappingModal(mappingSource)}
                          disabled={isRefreshingClasses}
                          className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <RotateCw className={cn('w-3 h-3', isRefreshingClasses ? 'animate-spin' : '')} />
                          <span>重新探测</span>
                        </Button>
                      </div>
                    </div>

                    <div className="border border-border/70 rounded-xl overflow-hidden divide-y divide-border/50 max-h-[50vh] overflow-y-auto scrollbar-thin">
                      {mappingClasses.length === 0 ? (
                        <div className="p-8 text-center text-xs text-muted-foreground">
                          {isRefreshingClasses ? '正在探测源站分类列表...' : '未发现分类或源站暂不可达'}
                        </div>
                      ) : (
                        mappingClasses
                          .filter((c) =>
                            !mappingSearch.trim() ||
                            c.type_name.toLowerCase().includes(mappingSearch.toLowerCase().trim()) ||
                            c.type_id.includes(mappingSearch.trim())
                          )
                          .map((cat) => {
                            let assignedTag = 'unmapped';
                            const mapping = mappingSource.category_mapping || {};
                            for (const [tag, ids] of Object.entries(mapping)) {
                              if (ids.includes(cat.type_id)) {
                                assignedTag = tag;
                                break;
                              }
                            }
                            const isAdult = (mappingSource.adult_type_ids || []).includes(cat.type_id);
                            const isTagOrphaned =
                              assignedTag !== 'unmapped' &&
                              !availableTags.some((t) => t.tag === assignedTag);

                            return (
                              <div
                                key={cat.type_id}
                                className={cn(
                                  'flex items-center justify-between p-2.5 text-xs transition-colors',
                                  isTagOrphaned ? 'bg-rose-500/10' : 'hover:bg-secondary/40'
                                )}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                                  <span className="font-medium text-foreground truncate">
                                    {cat.type_name}
                                  </span>
                                  <span className="px-1.5 py-0.2 bg-secondary border border-border text-muted-foreground text-[10px] font-mono rounded">
                                    ID: {cat.type_id}
                                  </span>
                                  {cat.type_pid && cat.type_pid !== '0' && (
                                    <span className="text-[10px] text-muted-foreground/70 font-mono">
                                      PID: {cat.type_pid}
                                    </span>
                                  )}
                                  {isTagOrphaned && (
                                    <span className="text-[10px] text-rose-500 font-medium">
                                      [原标签已删除]
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
                                      isTagOrphaned ? 'border-rose-500 text-rose-500 font-semibold' : 'border-border'
                                    )}
                                  >
                                    <option value="unmapped">不映射 (透传)</option>
                                    {isTagOrphaned && (
                                      <option value={assignedTag} className="text-rose-500 font-bold">
                                        {assignedTag} (已失效)
                                      </option>
                                    )}
                                    {availableTags.map((item) => (
                                      <option key={item.tag} value={item.tag}>
                                        {item.tag} ({item.name})
                                      </option>
                                    ))}
                                  </select>

                                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={isAdult}
                                      onChange={(e) =>
                                        handleToggleCategoryAdult(cat.type_id, e.target.checked)
                                      }
                                      className="w-3.5 h-3.5 accent-rose-500 cursor-pointer"
                                    />
                                    <span>18+</span>
                                  </label>
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
          </div>
        )}
      </div>
    </div>
  );
};
