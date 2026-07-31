// clipboard.js — 节点剪贴板(纯函数序列化/反序列化,递归重生成 id)
import { uid } from './utils.js';

/** 序列化节点子树为 JSON(移除 files 大体积数据,仅保留引用无关字段) */
export function serializeNodes(nodes) {
  return JSON.stringify(nodes.map(trimNode));
}

function trimNode(n) {
  return {
    text: n.text || '',
    note: n.note || '',
    color: n.color || null,
    fontColor: n.fontColor || null,
    spans: n.spans || null,
    collapsed: !!n.collapsed,
    fontSize: n.fontSize ?? 'M',
    side: n.side || 0,
    checked: n.checked ?? null,
    tags: Array.isArray(n.tags) ? n.tags.slice() : [],
    files: null, // 图片/附件不随剪贴板复制
    link: n.link || null,
    children: (n.children || []).map(trimNode),
  };
}

/** 反序列化为带全新 id 的节点数组 */
export function deserializeNodes(json) {
  const arr = JSON.parse(json);
  if (!Array.isArray(arr)) throw new Error('无效的剪贴板数据');
  const restore = (s) => {
    const n = {
      id: uid('n'),
      text: typeof s.text === 'string' ? s.text : String(s.text ?? ''),
      note: typeof s.note === 'string' ? s.note : '',
      color: s.color || null,
      fontColor: s.fontColor || null,
      spans: s.spans || null,
      collapsed: !!s.collapsed,
      fontSize: s.fontSize ?? 'M',
      side: [0, 1, 2].includes(s.side) ? s.side : 0,
      checked: s.checked ? true : null,
      tags: Array.isArray(s.tags) ? s.tags.map(String).slice(0, 50) : [],
      files: null,
      link: typeof s.link === 'string' && s.link ? s.link : null,
      children: Array.isArray(s.children) ? s.children.map(restore) : [],
      createdAt: Date.now(),
    };
    return n;
  };
  return arr.map(restore);
}

/** 判断剪贴板 JSON 是否为合法节点数组 */
export function isNodeClipboard(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length > 0 && arr.every((x) => x && typeof x.text === 'string');
  } catch (_) { return false; }
}

// 应用内剪贴板(跨文档/跨视图共享)
let _appClipboard = null;

export function setAppClipboard(json) {
  _appClipboard = json;
}

export function getAppClipboard() {
  return _appClipboard;
}
