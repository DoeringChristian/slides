import type { ObjectMeta, SlideElement } from '../../types/presentation';

export type ObjectListNode = { kind: 'object'; id: string; object: ObjectMeta } |
  { kind: 'group'; id: string; children: ObjectListNode[]; memberIds: string[] };

/** Membership comes from this keyframe; missing objects stay available as loose tiles. */
export function objectListTree(objects: ObjectMeta[], elements: Record<string, SlideElement>): ObjectListNode[] {
  const roots: ObjectListNode[] = [];
  for (const object of objects) {
    let siblings = roots;
    for (const groupId of elements[object.id]?.objectGroupIds ?? []) {
      let group = siblings.find(node => node.kind === 'group' && node.id === groupId);
      if (!group) { group = { kind: 'group', id: groupId, children: [], memberIds: [] }; siblings.push(group); }
      if (group.kind !== 'group') continue;
      group.memberIds.push(object.id);
      siblings = group.children;
    }
    siblings.push({ kind: 'object', id: object.id, object });
  }
  return roots;
}
export function flattenObjectList(nodes: ObjectListNode[], expanded: Set<string>, depth = 0): { node: ObjectListNode; depth: number }[] {
  return nodes.flatMap(node => [{ node, depth }, ...(node.kind === 'group' && expanded.has(node.id) ? flattenObjectList(node.children, expanded, depth + 1) : [])]);
}
