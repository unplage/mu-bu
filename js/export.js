// export.js — 导入导出(JSON / Markdown / OPML / TXT / PNG / SVG / HTML)
import { download, escapeHtml } from './utils.js';
import { createNode } from './db.js';

const NODE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink',
  'beige', 'lavender', 'mint', 'brown', 'gray', 'deepRed', 'deepBlue', 'deepGreen'];
const FONT_SIZES = ['S', 'M', 'L'];
const FONT_SIZE_MAP = { S: 12, M: 14, L: 18 };
const LAYOUTS = ['right', 'down', 'radial', 'leftright'];
const MAX_NODES = 50000;

/** 导出 JSON 备份(完整文档对象) */
export function exportJSON(doc) {
  const data = JSON.stringify(doc, null, 2);
  download(`${safeName(doc.title)}.json`, data, 'application/json');
}

/**
 * 校验并归一化文档结构(JSON 导入入口)。
 * 非法结构抛错;缺失字段补齐;非法 color/fontSize 归零。
 */
export function validateDoc(input) {
  if (!input || typeof input !== 'object') throw new Error('无效的文档格式');
  const counter = { n: 0 };
  const normalizeNode = (n) => {
    if (!n || typeof n !== 'object') throw new Error('节点必须是对象');
    if (++counter.n > MAX_NODES) throw new Error(`文档节点数超过 ${MAX_NODES} 上限`);
    const id = (typeof n.id === 'string' && n.id) ? n.id : 'n_' + Math.random().toString(36).slice(2, 9);
    // fontSize: S/M/L 字符串 → 对应数字; 数字 8-72 保留; 其他 → 14
    let fontSize = 14;
    if (FONT_SIZES.includes(n.fontSize)) fontSize = FONT_SIZE_MAP[n.fontSize];
    else if (typeof n.fontSize === 'number' && n.fontSize >= 8 && n.fontSize <= 72) fontSize = Math.round(n.fontSize);
    // fontColor: 有效 hex 或 null
    const fontColor = (typeof n.fontColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(n.fontColor)) ? n.fontColor : null;
    // spans: null 或合法数组(富文本属性 b/i/u/s/hl 一并归一化)
    let spans = null;
    if (Array.isArray(n.spans) && n.spans.length > 0) {
      const text = typeof n.text === 'string' ? n.text : String(n.text ?? '');
      const rebuilt = n.spans.filter((s) => s && typeof s === 'object' && typeof s.text === 'string');
      if (rebuilt.map((s) => s.text).join('') === text) {
        spans = rebuilt.map((s) => ({
          text: s.text,
          color: (typeof s.color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.color)) ? s.color : null,
          b: !!s.b,
          i: !!s.i,
          u: !!s.u,
          s: !!s.s,
          hl: (typeof s.hl === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.hl)) ? s.hl : null,
        }));
      }
    }
    // tags: 字符串数组(去空、去#、限长)
    let tags = [];
    if (Array.isArray(n.tags)) {
      tags = n.tags
        .map((t) => String(t ?? '').replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, 50);
    }
    // files: 图片/附件(data URL),逐项校验与限长
    let files = null;
    if (Array.isArray(n.files) && n.files.length > 0) {
      files = n.files
        .filter((f) => f && typeof f.dataUrl === 'string' && /^data:/.test(f.dataUrl))
        .slice(0, 20)
        .map((f) => ({
          id: (typeof f.id === 'string' && f.id) ? f.id : 'f_' + Math.random().toString(36).slice(2, 9),
          name: typeof f.name === 'string' ? f.name.slice(0, 120) : 'file',
          mime: typeof f.mime === 'string' ? f.mime.slice(0, 60) : '',
          dataUrl: f.dataUrl.slice(0, 6 * 1024 * 1024),
          isImage: !!f.isImage,
        }));
      if (files.length === 0) files = null;
    }
    return {
      id,
      text: typeof n.text === 'string' ? n.text : String(n.text ?? ''),
      note: typeof n.note === 'string' ? n.note : '',
      color: NODE_COLORS.includes(n.color) ? n.color : null,
      fontColor,
      spans,
      collapsed: !!n.collapsed,
      fontSize,
      side: [0, 1, 2].includes(n.side) ? n.side : 0,
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
      checked: n.checked ? true : null,
      tags,
      files,
      link: (typeof n.link === 'string' && /^(https?:\/\/|mailto:)/i.test(n.link)) ? n.link.slice(0, 500) : null,
      children: Array.isArray(n.children) ? n.children.map(normalizeNode) : [],
    };
  };
  return {
    id: (typeof input.id === 'string' && input.id) ? input.id : 'doc_' + Date.now().toString(36),
    title: typeof input.title === 'string' ? input.title : (input.title == null ? '未命名文档' : String(input.title)),
    layout: LAYOUTS.includes(input.layout) ? input.layout : 'right',
    theme: (typeof input.theme === 'string' && input.theme) ? input.theme : null,
    bg: (typeof input.bg === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(input.bg)) ? input.bg : null,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : Date.now(),
    root: normalizeNode(input.root),
  };
}

/** 从 JSON 文本导入(支持单文档或数组),逐项校验归一化 */
export function importJSON(text) {
  const obj = JSON.parse(text);
  const arr = Array.isArray(obj) ? obj : [obj];
  return arr.map(validateDoc);
}

/** 导出 Markdown(层级列表) */
export function exportMarkdown(doc) {
  const lines = [];
  lines.push(`# ${doc.title}`);
  lines.push('');
  const rec = (node, depth) => {
    if (depth === 0) {
      // root 不作为列表项,直接作为标题已写
    } else {
      const indent = '  '.repeat(depth - 1);
      const text = node.text.replace(/\n/g, '\n' + indent + '  ');
      lines.push(indent + '- ' + text);
      if (node.note) {
        const noteIndent = '  '.repeat(depth);
        lines.push(noteIndent + node.note.replace(/\n/g, '\n' + noteIndent));
      }
    }
    if (node.children) for (const c of node.children) rec(c, depth + 1);
  };
  rec(doc.root, 0);
  return lines.join('\n');
}
export function exportMarkdownFile(doc) {
  download(`${safeName(doc.title)}.md`, exportMarkdown(doc), 'text/markdown');
}

/** 导出纯文本缩进列表 */
export function exportText(doc) {
  const lines = [doc.title, ''];
  const rec = (node, depth) => {
    if (depth > 0) {
      lines.push('  '.repeat(depth - 1) + '• ' + node.text);
      if (node.note) lines.push('  '.repeat(depth) + node.note);
    }
    if (node.children) for (const c of node.children) rec(c, depth + 1);
  };
  rec(doc.root, 0);
  download(`${safeName(doc.title)}.txt`, lines.join('\n'), 'text/plain');
}

/** 导出 OPML */
export function exportOPML(doc) {
  const head = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeHtml(doc.title)}</title>
  </head>
  <body>
`;
  const rec = (node) => {
    const text = escapeHtml(node.text || '').replace(/\n/g, '&#10;');
    const children = (node.children || []).map(rec).join('\n');
    return `      <outline text="${text}">${children ? '\n' + children + '\n      ' : ''}</outline>`;
  };
  return head + rec(doc.root) + '\n  </body>\n</opml>';
}
export function exportOPMLFile(doc) {
  download(`${safeName(doc.title)}.opml`, exportOPML(doc), 'text/xml');
}

/** 从 OPML 导入 */
export function importOPML(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('OPML 解析失败');
  const rootOutline = xml.querySelector('opml > body > outline');
  if (!rootOutline) throw new Error('未找到 outline 节点');
  const parseNode = (ol) => ({
    id: 'n_' + Math.random().toString(36).slice(2, 9),
    text: (ol.getAttribute('text') || ol.getAttribute('title') || '').replace(/&#10;/g, '\n'),
    note: '',
    color: null,
    collapsed: false,
    children: Array.from(ol.querySelectorAll(':scope > outline')).map(parseNode),
    fontSize: 'M',
  });
  const title = xml.querySelector('opml > head > title')?.textContent || '导入文档';
  return {
    id: 'doc_' + Date.now().toString(36),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root: parseNode(rootOutline),
  };
}

/** 从 Markdown 文本导入 */
export function importMarkdown(text) {
  const lines = text.trim().split('\n');
  let title = '导入文档';
  const root = createNode(title);
  const stack = [{ node: root, depth: -1 }];

  for (const line of lines) {
    const stripped = line.trimStart();
    if (!stripped) continue;

    const headingMatch = stripped.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (depth === 1 && title === '导入文档') {
        title = text;
        root.text = text;
        continue;
      }
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const child = createNode(text);
      stack[stack.length - 1].node.children.push(child);
      stack.push({ node: child, depth });
      continue;
    }

    const listMatch = stripped.match(/^[-*+]\s+(.*)/);
    if (listMatch) {
      const indent = line.length - line.trimStart().length;
      const text = listMatch[1].trim();
      while (stack.length > 1 && stack[stack.length - 1].depth >= indent) stack.pop();
      const child = createNode(text);
      stack[stack.length - 1].node.children.push(child);
      stack.push({ node: child, depth: indent });
    }
  }

  return validateDoc({
    id: 'doc_' + Date.now().toString(36),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root,
  });
}

/** 从纯文本导入(按缩进解析层级) */
export function importText(text) {
  const lines = text.split('\n');
  let title = '导入文档';
  const root = createNode(title);
  const stack = [{ node: root, depth: -1 }];

  for (const line of lines) {
    const stripped = line.trimStart();
    if (!stripped) continue;

    if (title === '导入文档') {
      title = stripped.trim();
      root.text = title;
      continue;
    }

    const indent = line.length - stripped.length;
    while (stack.length > 1 && stack[stack.length - 1].depth >= indent) stack.pop();
    const content = stripped.replace(/^[-–—•·*]\s+/, '').trim();
    if (!content) continue;
    const child = createNode(content);
    stack[stack.length - 1].node.children.push(child);
    stack.push({ node: child, depth: indent });
  }

  return validateDoc({
    id: 'doc_' + Date.now().toString(36),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root,
  });
}

/** 从 HTML 文本导入(提取标题和列表) */
export function importHTML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const titleEl = doc.querySelector('h1');
  const title = titleEl ? titleEl.textContent.trim() : '导入文档';
  const root = createNode(title);

  const parseList = (listEl) => {
    const items = [];
    for (const child of listEl.children) {
      if (child.tagName !== 'LI') continue;
      const node = createNode(child.textContent.trim());
      for (const sub of child.children) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') {
          node.children = [];
          for (const c of sub.children) {
            if (c.tagName === 'LI') {
              const subNode = createNode(c.textContent.trim());
              node.children.push(subNode);
            }
          }
        }
      }
      items.push(node);
    }
    return items;
  };

  const body = doc.querySelector('body') || doc;
  for (const el of body.querySelectorAll('ul, ol')) {
    if (el.closest('li')) continue;
    root.children.push(...parseList(el));
  }

  return validateDoc({
    id: 'doc_' + Date.now().toString(36),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    root,
  });
}

/** 序列化 SVG(内联样式 + 依据内容计算 viewBox/尺寸,保证导出完整) */
function serializeSVG(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // 修复:移除 clone 中 <g> 的 transform,确保 viewBox 坐标与渲染一致
  const gClone = clone.querySelector('#mm-root');
  if (gClone) gClone.removeAttribute('transform');
  // 依据原始 SVG 的 <g> 计算 bbox(未变换坐标 = viewBox 坐标)
  const g = svgEl.querySelector('#mm-root');
  if (g && typeof g.getBBox === 'function') {
    try {
      const bb = g.getBBox();
      if (bb && bb.width > 0 && bb.height > 0) {
        const pad = 20;
        const x = bb.x - pad, y = bb.y - pad, w = bb.width + pad * 2, h = bb.height + pad * 2;
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      }
    } catch (_) { /* 部分环境 getBBox 不可用,保留原样 */ }
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .mm-edge { fill: none; stroke-width: 1.5; }
    .mm-node-text { user-select: none; }
    text { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  `;
  clone.insertBefore(style, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/** 导出 PNG(从思维导图 SVG 转换,2x 清晰度) */
export async function exportPNG(svgEl, title, bgColor = '#ffffff') {
  const svgStr = serializeSVG(svgEl);
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const scale = 2;
  const w = img.naturalWidth || 800;
  const h = img.naturalHeight || 600;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => {
    download(`${safeName(title)}.png`, blob, 'image/png');
  }, 'image/png');
}

/** 导出 SVG */
export function exportSVG(svgEl, title) {
  download(`${safeName(title)}.svg`, serializeSVG(svgEl), 'image/svg+xml');
}

function safeName(title) {
  return (title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

/** 统计文档信息 */
export function docStats(doc) {
  let nodes = 0, maxDepth = 0;
  const rec = (n, d) => {
    nodes++;
    maxDepth = Math.max(maxDepth, d);
    if (n.children) for (const c of n.children) rec(c, d + 1);
  };
  rec(doc.root, 0);
  return { nodes, maxDepth };
}
