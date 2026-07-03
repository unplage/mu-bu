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
