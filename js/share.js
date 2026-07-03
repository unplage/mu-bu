// share.js — 通过压缩编码生成只读分享链接(无需服务器)
import { gzipCompress, gzipDecompress, base64urlEncode, base64urlDecode } from './utils.js';

const LINK_LIMIT = 12000; // URL hash 长度上限,超过则提示用文件分享

/** 将文档编码为分享 hash */
export async function encodeShare(doc) {
  // 精简:只保留必要字段
  const slim = {
    t: doc.title,
    r: trimNode(doc.root),
  };
  const json = JSON.stringify(slim);
  const bytes = await gzipCompress(json);
  return base64urlEncode(bytes);
}

function trimNode(n) {
  return {
    x: n.text,
    c: n.color || undefined,
    k: n.collapsed ? 1 : undefined,
    h: (n.children && n.children.length) ? n.children.map(trimNode) : undefined,
  };
}

/** 从分享 hash 解码文档 */
export async function decodeShare(hash) {
  const bytes = base64urlDecode(hash);
  const json = await gzipDecompress(bytes);
  const slim = JSON.parse(json);
  return {
    id: 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: slim.t || '分享文档',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root: restoreNode(slim.r),
  };
}

function restoreNode(s) {
  return {
    id: 'n_' + Math.random().toString(36).slice(2, 9),
    text: s.x || '',
    note: '',
    color: s.c || null,
    collapsed: !!s.k,
    children: s.h ? s.h.map(restoreNode) : [],
  };
}

/** 生成分享链接 */
export async function buildShareLink(doc) {
  const hash = await encodeShare(doc);
  const base = location.origin + location.pathname;
  return { link: `${base}#share=${hash}`, length: hash.length, limit: LINK_LIMIT };
}

/** 检查 URL 是否含分享数据 */
export function getShareHashFromURL() {
  const m = location.hash.match(/share=([^&]+)/);
  return m ? m[1] : null;
}
