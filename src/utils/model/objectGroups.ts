import type { SlideElement } from '../../types/presentation';

export function objectGroupRoot(el: SlideElement | undefined, scope: string | null = null): string | undefined {
  const path = el?.objectGroupIds ?? [];
  return path[scope ? path.indexOf(scope) + 1 : 0];
}

/** Bound labels follow their containers through the existing dependent pipeline. */
export function expandObjectGroups(elements: Record<string, SlideElement>, ids: string[], scope: string | null = null): string[] {
  const roots = new Set(ids.map(id => objectGroupRoot(elements[id], scope)).filter(Boolean));
  return [...new Set([...ids, ...Object.values(elements)
    .filter(el => el.visible && !(el.type === 'text' && el.containerId) && roots.has(objectGroupRoot(el, scope)))
    .map(el => el.id)])];
}

export function toggleObjectGroup(elements: Record<string, SlideElement>, selected: string[], id: string, scope: string | null = null): string[] {
  const members = expandObjectGroups(elements, [id], scope);
  return members.every(member => selected.includes(member))
    ? selected.filter(member => !members.includes(member))
    : [...new Set([...selected, ...members])];
}

export function objectGroupLocked(elements: Record<string, SlideElement>, id: string, scope: string | null = null): boolean {
  const root = objectGroupRoot(elements[id], scope);
  return !!elements[id]?.locked || !!root && Object.values(elements).some(el => objectGroupRoot(el, scope) === root && el.locked);
}

/** Membership is per keyframe, outermost first. Grouping groups nests them;
 * ungroup removes one level. Geometry and z-order are never rewritten. */
export function planObjectGrouping(elements: Record<string, SlideElement>, ids: string[], mode: 'group' | 'ungroup', newId: () => string, scope: string | null = null): Map<string, string[]> {
  const selected = ids.map(id => elements[id]).filter(el => el?.visible && el.type !== 'group' && (!scope || el.objectGroupIds?.includes(scope)) && !(el.type === 'text' && el.containerId));
  const roots = new Set(selected.map(el => objectGroupRoot(el, scope)).filter(Boolean));
  const members = Object.values(elements).filter(el => selected.includes(el) || (objectGroupRoot(el, scope) && roots.has(objectGroupRoot(el, scope))));
  const changes = new Map<string, string[]>();
  if (mode === 'ungroup') {
    for (const el of members) if (objectGroupRoot(el, scope)) {
      const path = [...el.objectGroupIds!];
      path.splice(scope ? path.indexOf(scope) + 1 : 0, 1);
      changes.set(el.id, path);
    }
  } else {
    const units = new Set(selected.map(el => objectGroupRoot(el, scope) ? `group:${objectGroupRoot(el, scope)}` : `object:${el.id}`));
    if (units.size < 2 || members.some(el => el.locked)) return changes;
    const id = newId();
    for (const el of members) {
      const path = [...(el.objectGroupIds ?? [])];
      path.splice(scope ? path.indexOf(scope) + 1 : 0, 0, id);
      changes.set(el.id, path);
    }
  }
  return changes;
}

/** Move object identities, or merge a source group into a destination group.
 * Retain descendants below the merged group; never rewrite geometry/order. */
export function planGroupMembership(elements: Record<string, SlideElement>, ids: string[], target: string | null, sourceGroup?: string): Map<string, string[]> {
  const targetMember = target ? Object.values(elements).find(el => el.objectGroupIds?.includes(target)) : undefined;
  if (target && !targetMember) return new Map();
  const targetPath = target ? targetMember!.objectGroupIds!.slice(0, targetMember!.objectGroupIds!.indexOf(target) + 1) : [];
  if (sourceGroup && (targetPath.includes(sourceGroup) || !Object.values(elements).some(el => el.objectGroupIds?.includes(sourceGroup)))) return new Map();
  const moving = sourceGroup ? Object.values(elements).filter(el => el.objectGroupIds?.includes(sourceGroup)).map(el => el.id) : ids;
  const changes = new Map<string, string[]>();
  for (const id of moving) {
    const el = elements[id];
    if (!el || (el.type === 'text' && el.containerId)) continue;
    const old = el.objectGroupIds ?? [];
    const suffix = sourceGroup ? old.slice(old.indexOf(sourceGroup) + 1) : [];
    const path = [...targetPath, ...suffix];
    if (JSON.stringify(path) !== JSON.stringify(old)) changes.set(id, path);
  }
  return changes;
}
