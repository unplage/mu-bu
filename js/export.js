// export.js — 导入导出(JSON / Markdown / OPML / TXT / PNG / SVG)
import { download, escapeHtml } from './utils.js';
import { walkAll } from './tree.js';

/** 导出 JSON 备份(完整文档对象) */
export function exportJSON(doc) {
  const data = JSON.stringify(doc, null, 2);
  download(`${safeName(doc.title)}.json`, data, 'application/json');
}

/** 从 JSON 文本导入(支持单文档或数组) */
export function importJSON(text) {
  const obj = JSON.parse(text);
  if (Array.isArray(obj)) return obj;
  return [obj];
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
      const bullet = '- ';
      const text = node.text.replace(/\n/g, '\n' + indent + '  ');
      lines.push(indent + bullet + text);
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
      lines.push('  '.repeat(depth - 1) + '• ' + node.text.replace(/\n/g, '\n'));
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
  const rec = (node, isRoot) => {
    const text = escapeHtml(node.text || '').replace(/\n/g, '&#10;');
    const children = (node.children || []).map((c) => rec(c, false)).join('\n');
    return `      <outline text="${text}">${children ? '\n' + children + '\n      ' : ''}</outline>`;
  };
  const body = rec(doc.root, true);
  return head + body + '\n  </body>\n</opml>';
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
    note: ol.getAttribute('_note') || '',
    color: null,
    collapsed: false,
    children: Array.from(ol.querySelectorAll(':scope > outline')).map(parseNode),
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

/** 导出 PNG(从思维导图 SVG 转换) */
export async function exportPNG(svgEl, title) {
  const svgStr = serializeSVG(svgEl);
  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const scale = 2; // 2x 清晰度
  const canvas = document.createElement('canvas');
  canvas.width = svgEl.viewBox.baseVal.width * scale;
  canvas.height = svgEl.viewBox.baseVal.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => {
    download(`${safeName(title)}.png`, blob, 'image/png');
  }, 'image/png');
}

/** 导出 SVG */
export function exportSVG(svgEl, title) {
  const svgStr = serializeSVG(svgEl);
  download(`${safeName(title)}.svg`, svgStr, 'image/svg+xml');
}

/** 序列化 SVG(内联样式) */
function serializeSVG(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // 内联关键样式
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .mm-edge { fill: none; stroke-width: 1.5; }
    .mm-node-text { user-select: none; }
    text { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  `;
  clone.insertBefore(style, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
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
