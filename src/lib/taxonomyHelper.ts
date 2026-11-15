import type { Category, Source } from '../types';

export interface CategoryTree {
  categories: Map<string, Category>;
  childrenMap: Map<string, string[]>;
  parentMap: Map<string, string>;
}

export function buildCategoryTree(classes: Category[]): CategoryTree {
  const categories = new Map<string, Category>();
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  for (const c of classes) {
    categories.set(c.type_id, c);
    if (c.type_pid) {
      const pid = c.type_pid.trim();
      if (pid && pid !== '0' && pid !== c.type_id) {
        if (!childrenMap.has(pid)) {
          childrenMap.set(pid, []);
        }
        childrenMap.get(pid)!.push(c.type_id);
        parentMap.set(c.type_id, pid);
      }
    }
  }

  return { categories, childrenMap, parentMap };
}

/**
 * Resolve all descendants (including root IDs) recursively using BFS with cycle detection
 */
export function resolveCascadeDescendants(
  roots: string[],
  childrenMap: Map<string, string[]>
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [];

  for (const root of roots) {
    const trimmed = root.trim();
    if (trimmed && !result.has(trimmed)) {
      result.add(trimmed);
      queue.push(trimmed);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current);
    if (children) {
      for (const child of children) {
        if (!result.has(child)) {
          result.add(child);
          queue.push(child);
        }
      }
    }
  }

  return result;
}

/**
 * Resolve ancestor chain from child up to root
 */
export function resolveAncestors(
  leafId: string,
  parentMap: Map<string, string>
): string[] {
  const ancestors: string[] = [];
  let current = leafId;
  const visited = new Set<string>([current]);

  while (parentMap.has(current)) {
    const parentId = parentMap.get(current)!;
    if (visited.has(parentId)) {
      break; // Cycle detected
    }
    visited.add(parentId);
    ancestors.push(parentId);
    current = parentId;
  }

  return ancestors;
}

/**
 * Resolve semantic tag with ancestor inheritance:
 * 1. Explicit mapping in source.category_mapping
 * 2. Ancestor inheritance (if parent is mapped to #movie, child inherits #movie)
 * 3. Fallback name heuristics (*片 -> #movie, *剧 -> #tv, *动漫 -> #anime)
 */
export function resolveSemanticTag(
  typeId: string,
  source: Source | undefined,
  tree: CategoryTree
): string | null {
  // 1. Check explicit adult_type_ids
  if (source?.adult_type_ids && source.adult_type_ids.includes(typeId)) {
    return '#18plus';
  }

  const mapping = source?.category_mapping;

  if (mapping) {
    // 2. Direct check in mapping
    for (const [tag, ids] of Object.entries(mapping)) {
      if (ids.includes(typeId)) {
        return tag;
      }
    }

    // 3. Ancestor inheritance
    const ancestors = resolveAncestors(typeId, tree.parentMap);
    for (const anc of ancestors) {
      if (source?.adult_type_ids && source.adult_type_ids.includes(anc)) {
        return '#18plus';
      }
      for (const [tag, ids] of Object.entries(mapping)) {
        if (ids.includes(anc)) {
          return tag;
        }
      }
    }
  } else if (source?.adult_type_ids) {
    const ancestors = resolveAncestors(typeId, tree.parentMap);
    for (const anc of ancestors) {
      if (source.adult_type_ids.includes(anc)) {
        return '#18plus';
      }
    }
  }

  // 4. Fallback name pattern matching
  const cat = tree.categories.get(typeId);
  if (cat) {
    const name = cat.type_name;
    if (
      name.includes('伦理') ||
      name.includes('成人') ||
      name.includes('福利') ||
      name.includes('写真') ||
      name.includes('情色') ||
      name.includes('三级') ||
      name.includes('18+')
    ) {
      return '#18plus';
    }
    if (name.includes('动漫') || name.includes('动画')) return '#anime';
    if (name.includes('短剧') || name.includes('爽剧') || name.includes('总裁')) return '#short_drama';
    if (name.includes('剧') && !name.includes('短剧')) return '#tv';
    if (name.includes('片') && !name.includes('短剧') && !name.includes('纪录')) return '#movie';
    if (name.includes('纪录')) return '#documentary';
    if (name.includes('综艺')) return '#variety';
    if (name.includes('赛事') || name.includes('球') || name.includes('运动')) return '#sports';
    if (name.includes('预告')) return '#trailer';
  }

  return null;
}
