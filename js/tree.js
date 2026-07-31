// tree.js — 文档树的遍历与结构操作(纯函数,不修改入参则返回新引用)
// 节点结构: { id, text, note, color, collapsed, children: [] }

/** 深度优先遍历(可见节点,尊重 collapsed) */
export function* walk(node, { includeCollapsed = false } = {}) {
  yield node;
  if (node.children && (!node.collapsed || includeCollapsed)) {
    for (const c of node.children) yield* walk(c, { includeCollapsed });
  }
}

/** 深度优先遍历所有节点(忽略折叠) */
export function* walkAll(node) {
  yield node;
  if (node.children) for (const c of node.children) yield* walkAll(c);
}

/** 查找节点及其父节点与索引 */
export function findNode(root, id) {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  if (!root.children) return null;
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c.id === id) return { node: c, parent: root, index: i };
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

/** 返回可见节点扁平序列(用于大纲渲染与导航) */
export function flattenVisible(root) {
  const out = [];
  const rec = (node, depth) => {
    out.push({ node, depth });
    if (node.children && !node.collapsed) {
      for (const c of node.children) rec(c, depth + 1);
    }
  };
  rec(root, 0);
  return out;
}

/** 在 parent.children[index] 后插入新兄弟节点 */
export function insertAfter(parent, index, newNode) {
  parent.children.splice(index + 1, 0, newNode);
}

/** 在 parent.children 末尾添加子节点 */
export function appendChild(parent, newNode) {
  parent.children.push(newNode);
}

/** 删除 parent.children[index] */
export function removeNode(parent, index) {
  return parent.children.splice(index, 1)[0];
}

/** 将节点从原位置移动到 targetParent 的 targetIndex。
 *  契约:targetIndex 是节点在 *最终* 数组中的索引(已扣除 src 移除造成的位置偏移)。 */
export function moveNode(srcParent, srcIndex, targetParent, targetIndex) {
  const [node] = srcParent.children.splice(srcIndex, 1);
  targetParent.children.splice(targetIndex, 0, node);
  return node;
}

/** 缩进:把 parent.children[i] 移到前一个兄弟的 children 末尾 */
export function indent(parent, index) {
  if (index <= 0) return false;
  const [node] = parent.children.splice(index, 1);
  const prev = parent.children[index - 1];
  if (!prev.children) prev.children = [];
  prev.children.push(node);
  prev.collapsed = false;
  return true;
}

/** 减少缩进:把 parent.children[i] 移到 grandparent 中 parent 之后 */
export function outdent(parent, index, grandparent) {
  if (!grandparent) return false;
  const parentIdx = grandparent.children.indexOf(parent);
  if (parentIdx < 0) return false;
  const [node] = parent.children.splice(index, 1);
  grandparent.children.splice(parentIdx + 1, 0, node);
  return true;
}

/** 计算节点子树是否包含某 id(用于防止拖拽到自身子树) */
export function contains(node, id) {
  if (node.id === id) return true;
  if (!node.children) return false;
  return node.children.some((c) => contains(c, id));
}

/** 统计可见/全部节点数 */
export function countNodes(root, visibleOnly = false) {
  let n = 1;
  if (root.children && (!visibleOnly || !root.collapsed)) {
    for (const c of root.children) n += countNodes(c, visibleOnly);
  }
  return n;
}

/** 收集选中集里最顶层的节点(含子节点的祖先被选中时,子树整体视为一项) */
export function collectTopmost(root, idSet) {
  const out = [];
  const rec = (node, parent, index) => {
    if (idSet.has(node.id)) { out.push({ node, parent, index }); return; }
    if (node.children) node.children.forEach((c, i) => rec(c, node, i));
  };
  rec(root, null, -1);
  return out;
}

/** 批量删除选中节点(返回被删除的节点数组);root 不可删 */
export function removeNodesByIds(root, idSet) {
  const targets = collectTopmost(root, idSet)
    .filter((t) => t.parent)
    .sort((a, b) => {
      if (a.parent === b.parent) return b.index - a.index; // 同父先删索引大的
      return 0;
    });
  return targets.map(({ parent, index }) => parent.children.splice(index, 1)[0]);
}

/** 按父节点分组选中节点索引:Map<parent, number[]> */
export function groupIndicesByParent(root, idSet) {
  const map = new Map();
  for (const { parent, index } of collectTopmost(root, idSet)) {
    if (!parent) continue;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  }
  for (const arr of map.values()) arr.sort((a, b) => a - b);
  return map;
}

/** 同一父节点内整块上移/下移 delta 位(多选移动),返回是否成功 */
export function moveBlock(parent, indices, delta) {
  if (!indices || indices.length === 0 || delta === 0) return false;
  const sorted = [...indices].sort((a, b) => a - b);
  const k = sorted.length;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const n = parent.children.length;
  let insertAt;
  if (delta > 0) {
    if (last + 1 >= n) return false;
    insertAt = last - k + 2;
  } else {
    if (first <= 0) return false;
    insertAt = first - 1;
  }
  const nodes = sorted.map((i) => parent.children[i]);
  nodes.forEach(() => parent.children.splice(first, 1));
  parent.children.splice(insertAt, 0, ...nodes);
  return true;
}

/** 排序兄弟节点:mode = name|time|length,dir = 1 升 / -1 降 */
export function sortSiblings(parent, mode = 'name', dir = 1) {
  if (!parent.children || parent.children.length < 2) return false;
  const sorted = [...parent.children];
  sorted.sort((a, b) => {
    if (mode === 'time') {
      const ka = a.createdAt || 0, kb = b.createdAt || 0;
      return ka === kb ? 0 : (ka < kb ? -1 : 1);
    }
    if (mode === 'length') {
      const ka = (a.text || '').length, kb = (b.text || '').length;
      return ka === kb ? 0 : (ka < kb ? -1 : 1);
    }
    return (a.text || '').localeCompare(b.text || '', 'zh');
  });
  parent.children = dir > 0 ? sorted : sorted.reverse();
  return true;
}

/** 统计节点数/字符数/字数(text+note,供字数统计) */
export function countText(root) {
  let nodes = 0, chars = 0, words = 0;
  const rec = (n) => {
    nodes++;
    const txt = ((n.text || '') + '\n' + (n.note || '')).trim();
    chars += txt.length;
    words += (txt.match(/\S+/g) || []).length;
    if (n.children) n.children.forEach(rec);
  };
  rec(root);
  return { nodes, chars, words };
}
