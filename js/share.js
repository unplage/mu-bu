// share.js — 通过压缩编码生成只读分享链接(无需服务器)
import { gzipCompress, gzipDecompress, base64urlEncode, base64urlDecode } from './utils.js';

const LINK_LIMIT = 8000; // URL hash 长度上限,超过则提示用文件分享

const LAYOUTS = ['right', 'down', 'radial', 'leftright'];

/** 将文档编码为分享 hash */
export async function encodeShare(doc) {
  // 精简:只保留必要字段(files 图片/附件体积大,不进分享链接)
  const slim = {
    t: doc.title,
    l: (doc.layout && doc.layout !== 'right') ? doc.layout : undefined,
    m: doc.theme || undefined,
    b: doc.bg || undefined,
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
    o: n.fontColor || undefined,
    k: n.collapsed ? 1 : undefined,
    f: (n.fontSize && n.fontSize !== 'M' && n.fontSize !== 14) ? n.fontSize : undefined,
    d: (n.side && n.side !== 0) ? n.side : undefined,
    e: (n.checked !== null && n.checked !== undefined) ? (n.checked ? 1 : 0) : undefined,
    g: (Array.isArray(n.tags) && n.tags.length) ? n.tags.slice(0, 50) : undefined,
    l: n.link || undefined,
    t: (typeof n.createdAt === 'number') ? n.createdAt : undefined,
    s: (Array.isArray(n.spans) && n.spans.length > 0 && n.spans.some((sp) => sp.color || sp.b || sp.i || sp.u || sp.s || sp.hl)) ? n.spans.map((sp) => ({
      x: sp.text,
      c: sp.color || undefined,
      b: sp.b ? 1 : undefined,
      i: sp.i ? 1 : undefined,
      u: sp.u ? 1 : undefined,
      s: sp.s ? 1 : undefined,
      l: sp.hl || undefined,
    })) : undefined,
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
    layout: LAYOUTS.includes(slim.l) ? slim.l : 'right',
    theme: (typeof slim.m === 'string' && slim.m) ? slim.m : null,
    bg: (typeof slim.b === 'string' && /^#([0-9a-fA-F]{6})$/.test(slim.b)) ? slim.b : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root: restoreNode(slim.r),
  };
}

function restoreNode(s) {
  const text = s.x || '';
  let spans = null;
  if (Array.isArray(s.s) && s.s.length > 0) {
    const parsed = s.s.map((sp) => ({
      text: sp.x || '',
      color: (typeof sp.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(sp.c)) ? sp.c : null,
      b: !!sp.b,
      i: !!sp.i,
      u: !!sp.u,
      s: !!sp.s,
      hl: (typeof sp.l === 'string' && /^#[0-9a-fA-F]{6}$/.test(sp.l)) ? sp.l : null,
    }));
    if (parsed.map((sp) => sp.text).join('') === text) spans = parsed;
  }
  return {
    id: 'n_' + Math.random().toString(36).slice(2, 9),
    text,
    note: '',
    color: s.c || null,
    fontColor: (typeof s.o === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.o)) ? s.o : null,
    spans,
    collapsed: !!s.k,
    children: s.h ? s.h.map(restoreNode) : [],
    fontSize: (typeof s.f === 'number' && s.f >= 8 && s.f <= 72) ? s.f
      : (['S', 'L'].includes(s.f) ? s.f : 'M'),
    side: [0, 1, 2].includes(s.d) ? s.d : 0,
    createdAt: (typeof s.t === 'number') ? s.t : Date.now(),
    checked: s.e === undefined ? null : !!s.e,
    tags: Array.isArray(s.g) ? s.g.map(String).slice(0, 50) : [],
    files: null,
    link: (typeof s.l === 'string' && /^(https?:\/\/|mailto:)/i.test(s.l)) ? s.l : null,
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
