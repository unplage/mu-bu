// utils.js — 通用工具函数

let _measureCtx = null;
try {
  const _c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  _measureCtx = _c && typeof _c.getContext === 'function' ? _c.getContext('2d') : null;
} catch (_) { _measureCtx = null; }

/** 生成短随机 id */
export function uid(prefix = 'n') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 深拷贝(基于结构化克隆,支持 Date/Map/Set,不支持函数) */
export function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/** 防抖(带 cancel / flush) */
export function debounce(fn, ms = 200) {
  let t = null, lastArgs = null, lastThis = null;
  const debounced = function (...args) {
    lastArgs = args; lastThis = this;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, ms);
  };
  debounced.cancel = () => { clearTimeout(t); t = null; };
  debounced.flush = () => {
    if (t != null) {
      clearTimeout(t); t = null;
      fn.apply(lastThis, lastArgs);
    }
  };
  return debounced;
}

/** 创建 DOM 元素 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== false && v != null) node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** 转义 HTML */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/** 触发文件下载 */
export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文本像素宽度(canvas 测量;无 canvas 环境回退字符估宽) */
export function getTextWidth(text, fontSize, fontWeight = 'normal') {
  if (_measureCtx) {
    _measureCtx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
    return _measureCtx.measureText(text).width;
  }
  return String(text).length * fontSize * 0.6;
}

/** 颜色调色板(使用真实十六进制值,确保 SVG fill/stroke 属性可用) */
export const COLORS = [
  { key: 'red', name: '红', hex: '#ef6f6c' },
  { key: 'orange', name: '橙', hex: '#f0a04b' },
  { key: 'yellow', name: '黄', hex: '#e6c34a' },
  { key: 'green', name: '绿', hex: '#5cb85c' },
  { key: 'cyan', name: '青', hex: '#3bb8c4' },
  { key: 'blue', name: '蓝', hex: '#4f8cf0' },
  { key: 'purple', name: '紫', hex: '#9b7bd8' },
  { key: 'pink', name: '粉', hex: '#ec7cad' },
  { key: 'beige', name: '米', hex: '#f5e6c8' },
  { key: 'lavender', name: '薰', hex: '#c8b6e2' },
  { key: 'mint', name: '薄荷', hex: '#a8e6cf' },
  { key: 'brown', name: '棕', hex: '#a0785a' },
  { key: 'gray', name: '灰', hex: '#9aa1ab' },
  { key: 'deepRed', name: '深红', hex: '#c0392b' },
  { key: 'deepBlue', name: '深蓝', hex: '#2c3e80' },
  { key: 'deepGreen', name: '深绿', hex: '#27ae60' },
];
/** 字体颜色预设 */
export const FONT_COLORS = [
  '#2b333b', '#666666', '#999999', '#ffffff',
  '#c0392b', '#e74c3c', '#e67e22', '#f39c12',
  '#27ae60', '#2ecc71', '#2980b9', '#3498db',
  '#8e44ad', '#9b59b6', '#e91e63', '#ff5722',
  '#795548', '#607d8b', '#00bcd4', '#ff9800',
];
export function colorCss(key) {
  const c = COLORS.find((x) => x.key === key);
  return c ? c.hex : '#8a929c';
}

/** 判断十六进制颜色是否浅色(决定文字颜色) */
export function isLightColor(hex) {
  if (!hex) return true;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

/** 彩色节点浅色填充 */
export function shade(colorKey) {
  if (!colorKey) return '#ffffff';
  // 直接 hex 颜色:生成浅色版本
  if (colorKey.startsWith('#') && colorKey.length === 7) {
    const r = parseInt(colorKey.slice(1, 3), 16);
    const g = parseInt(colorKey.slice(3, 5), 16);
    const b = parseInt(colorKey.slice(5, 7), 16);
    const lr = Math.round(r + (255 - r) * 0.85);
    const lg = Math.round(g + (255 - g) * 0.85);
    const lb = Math.round(b + (255 - b) * 0.85);
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  }
  const map = {
    red: '#fbe7e6', orange: '#fdeede', yellow: '#fdf6dd', green: '#e6f5e6',
    cyan: '#e0f4f6', blue: '#e8f1fe', purple: '#efe9fb', pink: '#fbe9f1',
    beige: '#faf3e6', lavender: '#f0ebf8', mint: '#e8f8f0', brown: '#f2ebe4',
    gray: '#f0f1f3', deepRed: '#fbe7e6', deepBlue: '#e8ecf8', deepGreen: '#e6f5e6',
  };
  return map[colorKey] || '#ffffff';
}

/** 格式化日期 */
export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + '天前';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** base64url 编解码(用于分享链接) */
export function base64urlEncode(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Gzip 压缩/解压(基于原生 CompressionStream,旧浏览器回退无压缩) */
export async function gzipCompress(str) {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(str);
  try {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch (_) { return new TextEncoder().encode(str); }
}
export async function gzipDecompress(bytes) {
  if (typeof DecompressionStream === 'undefined') return new TextDecoder().decode(bytes);
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch (_) { return new TextDecoder().decode(bytes); }
}

/** 是否为移动设备(UA 判断) */
export const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone/i.test(navigator.userAgent || '');

// ---------- 富文本 span 工具(大纲/导图共用) ----------

/** span 是否带任何样式(颜色/加粗/斜体/下划线/删除线/高亮) */
export function spanStyled(sp) {
  return !!(sp && (sp.color || sp.b || sp.i || sp.u || sp.s || sp.hl));
}

/** 复制 span 属性到新文本 */
export function copySpan(sp, text) {
  return { text, color: sp?.color || null, b: !!sp?.b, i: !!sp?.i, u: !!sp?.u, s: !!sp?.s, hl: sp?.hl || null };
}

/** span 的 CSS 样式串 */
export function spanStyle(sp) {
  const parts = [];
  if (sp.color) parts.push(`color:${sp.color}`);
  if (sp.b) parts.push('font-weight:bold');
  if (sp.i) parts.push('font-style:italic');
  const deco = [];
  if (sp.u) deco.push('underline');
  if (sp.s) deco.push('line-through');
  if (deco.length) parts.push(`text-decoration:${deco.join(' ')}`);
  if (sp.hl) parts.push(`background:${sp.hl}`);
  return parts.join(';');
}

/** 将节点文本与 spans 渲染为可编辑 HTML(纯文本用 <br> 换行) */
export function textToHtml(text, spans, fontColor) {
  if (!text) return '';
  const hasSpans = Array.isArray(spans) && spans.length > 0 && spans.some(spanStyled);
  if (!hasSpans) {
    // 无逐字样式:纯文本 + <br>
    const lines = escapeHtml(text).split('\n');
    return lines.map((l, i) => i === 0 ? l : '<br>' + l).join('');
  }
  // 有 spans:按 \n 拆行,每行内按 span 片段渲染 <span style="...">
  const result = [];
  let pos = 0;
  for (let lineIdx = 0; ; lineIdx++) {
    const nlIdx = text.indexOf('\n', pos);
    const lineEnd = nlIdx === -1 ? text.length : nlIdx;
    if (lineIdx > 0) result.push('<br>');
    // 渲染该行的 spans
    let linePos = 0;
    for (const sp of spans) {
      const spStart = linePos;
      const spEnd = linePos + sp.text.length;
      if (spEnd <= pos || spStart >= lineEnd) { linePos = spEnd; continue; }
      const clipStart = Math.max(spStart, pos) - spStart;
      const clipEnd = Math.min(spEnd, lineEnd) - spStart;
      const segment = sp.text.slice(clipStart, clipEnd);
      if (segment) {
        const style = spanStyle(sp);
        if (style) result.push(`<span style="${style}">${escapeHtml(segment)}</span>`);
        else result.push(escapeHtml(segment));
      }
      linePos = spEnd;
    }
    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }
  return result.join('');
}

/** 从 contenteditable DOM 重建 spans 数组(沿祖先收集有效样式) */
export function spansFromDom(textEl) {
  const spans = [];
  let hasStyle = false;
  // 沿祖先链汇总某文本节点上的生效样式
  const effectiveStyle = (el) => {
    const sp = { color: null, b: false, i: false, u: false, s: false, hl: null };
    let node = el;
    while (node && node !== textEl) {
      const name = node.nodeName;
      const st = node.style;
      if (name === 'B' || name === 'STRONG' || name === 'SPAN') {
        const fw = st ? st.fontWeight : null;
        if (name === 'B' || name === 'STRONG' || fw === 'bold' || (fw && parseInt(fw, 10) >= 600)) sp.b = true;
        if (st && st.color) sp.color = st.color;
        if (st && st.fontStyle === 'italic') sp.i = true;
        if (st && /underline/.test(st.textDecoration)) sp.u = true;
        if (st && /line-through/.test(st.textDecoration)) sp.s = true;
        if (st && /^#/.test(st.backgroundColor)) sp.hl = st.backgroundColor;
      } else if (name === 'I' || name === 'EM') {
        sp.i = true;
      } else if (name === 'U') {
        sp.u = true;
      } else if (name === 'S' || name === 'STRIKE' || name === 'DEL') {
        sp.s = true;
      } else if (name === 'MARK') {
        sp.hl = '#ffff00';
      } else if (name === 'FONT') {
        // 某些浏览器 execCommand('foreColor') 产出 <font color>,需兜底识别
        const fc = node.getAttribute?.('color');
        if (fc && /^#/.test(fc)) sp.color = fc;
      }
      node = node.parentElement;
    }
    return sp;
  };
  const walk = (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.textContent) {
        const st = effectiveStyle(n.parentElement);
        if (spanStyled(st)) hasStyle = true;
        spans.push(copySpan(st, n.textContent));
      }
    } else if (n.nodeName === 'BR') {
      spans.push({ text: '\n', color: null });
    } else if (n.nodeName === 'DIV') {
      // contenteditable 换行可能生成 DIV,保留结构
      if (spans.length > 0) spans.push({ text: '\n', color: null });
      n.childNodes.forEach(walk);
    } else {
      n.childNodes.forEach(walk);
    }
  };
  walk(textEl);
  return hasStyle && spans.length > 0 ? spans : null;
}

/** 提取 contenteditable 纯文本(<br>/<div> 转 \n,span 取文本) */
export function contentText(textEl) {
  let out = '';
  const walk = (n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeName === 'DIV') out += (out && !out.endsWith('\n') ? '\n' : '');
    n.childNodes.forEach(walk);
  };
  textEl.childNodes.forEach(walk);
  return out;
}

/** 计算 (node, offset) 在元素内的字符偏移(文本节点长度 + <br>=1,与 contentText 对齐;不依赖 Range.toString) */
export function charOffsetIn(el, node, offset) {
  let count = 0, found = false;
  const walk = (n) => {
    if (found) return;
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) { count += offset; found = true; return; }
      count += n.textContent.length;
    } else if (n.nodeName === 'BR') {
      if (n === node) { count += offset || 0; found = true; return; }
      count += 1;
    } else if (n.nodeType === Node.ELEMENT_NODE && n === node) {
      // 元素边界:偏移为该元素前 offset 个子节点的字符总数
      for (let i = 0; i < offset && i < n.childNodes.length; i++) walk(n.childNodes[i]);
      found = true;
      return;
    } else {
      for (const c of n.childNodes) walk(c);
    }
  };
  walk(el);
  return count;
}
