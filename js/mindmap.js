// mindmap.js — 思维导图视图(SVG)
import { el, escapeHtml, colorCss } from './utils.js';
import { findNode } from './tree.js';

const NODE_H = 34;
const NODE_GAP_Y = 10;
const NODE_GAP_X = 60;
const NODE_MAX_W = 220;
const NODE_MIN_W = 60;
const CHAR_W = 9; // 估算每字符宽度
const FONT_SIZE = 14;
const LINE_H = 18;

export class Mindmap {
  constructor(container, doc, onChange) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.editingId = null;
    this._editingDraft = '';
    this._panning = null;
    this._attach();
  }

  setDoc(doc) {
    this.doc = doc;
    this.editingId = null;
    this.render();
    this.fit();
  }

  _attach() {
    const c = this.container;
    // 平移
    c.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mm-node') || e.target.closest('.mm-edit')) return;
      this._panning = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      c.classList.add('panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._panning) return;
      this.tx = this._panning.tx + (e.clientX - this._panning.x);
      this.ty = this._panning.ty + (e.clientY - this._panning.y);
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      this._panning = null;
      c.classList.remove('panning');
    });
    // 缩放(滚轮)
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = c.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // 以鼠标为中心缩放
      const newScale = Math.min(3, Math.max(0.2, this.scale * delta));
      const ratio = newScale / this.scale;
      this.tx = cx - (cx - this.tx) * ratio;
      this.ty = cy - (cy - this.ty) * ratio;
      this.scale = newScale;
      this._applyTransform();
    }, { passive: false });
  }

  _applyTransform() {
    const g = this.container.querySelector('#mm-root');
    if (g) g.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
  }

  zoomBy(factor) {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newScale = Math.min(3, Math.max(0.2, this.scale * factor));
    const ratio = newScale / this.scale;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.scale = newScale;
    this._applyTransform();
  }
  resetZoom() { this.scale = 1; this._applyTransform(); }
  fit() {
    this.render();
    const g = this.container.querySelector('#mm-root');
    if (!g) return;
    try {
      const bbox = g.getBBox();
      const rect = this.container.getBoundingClientRect();
      if (bbox.width === 0 || rect.width === 0) return;
      const pad = 60;
      const sx = (rect.width - pad * 2) / bbox.width;
      const sy = (rect.height - pad * 2) / bbox.height;
      this.scale = Math.min(1.2, Math.min(sx, sy));
      this.tx = pad - bbox.x * this.scale;
      this.ty = pad - bbox.y * this.scale + (rect.height - bbox.height * this.scale) / 2;
      this._applyTransform();
    } catch (e) { /* getBBox 在未挂载时报错,忽略 */ }
  }

  // ---------- 渲染 ----------
  render() {
    const root = this.doc.root;
    // 1. 计算每个节点宽度(基于文本)
    measureNode(root);
    // 2. 布局:计算 subtreeHeight
    layoutHeight(root);
    // 3. 分配坐标
    assignPos(root, 0, 0);

    // 收集节点与连线
    const nodes = [];
    const edges = [];
    collect(root, null, nodes, edges);

    // 计算 svg 尺寸
    let maxX = 0, maxY = 0, minY = 0, minX = 0;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + NODE_H);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
    }
    const width = maxX - minX + 200;
    const height = maxY - minY + 200;

    // 构建 SVG
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `${minX - 100} ${minY - 100} ${width} ${height}`);

    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'mm-root');

    // 连线
    for (const e of edges) {
      const path = document.createElementNS(ns, 'path');
      const x1 = e.from.x + e.from.w;
      const y1 = e.from.y + NODE_H / 2;
      const x2 = e.to.x;
      const y2 = e.to.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      path.setAttribute('class', 'mm-edge');
      path.setAttribute('stroke', e.to.color ? colorCss(e.to.color) : '#c4c9d0');
      g.append(path);
    }

    // 节点
    for (const n of nodes) {
      const grp = document.createElementNS(ns, 'g');
      grp.setAttribute('class', 'mm-node');
      grp.setAttribute('transform', `translate(${n.x},${n.y})`);
      grp.dataset.id = n.id;

      if (this.editingId === n.id) {
        // 编辑态:用 foreignObject 渲染 input
        const fo = document.createElementNS(ns, 'foreignObject');
        fo.setAttribute('width', Math.max(n.w, 120));
        fo.setAttribute('height', NODE_H);
        fo.setAttribute('x', 0);
        fo.setAttribute('y', 0);
        const input = el('input', {
          class: 'mm-edit',
          type: 'text',
          value: this._editingDraft,
          style: { width: Math.max(n.w - 16, 100) + 'px', height: NODE_H + 'px' },
        });
        fo.append(input);
        grp.append(fo);
        g.append(grp);
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        });
        input.addEventListener('input', () => { this._editingDraft = input.value; });
        const commit = () => {
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.text = this._editingDraft; this.onChange(this.doc, true); }
          this.editingId = null;
          this.render();
          this._applyTransform();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { this.editingId = null; this.render(); this._applyTransform(); }
        });
        continue;
      }

      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'mm-node-rect');
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', 6);
      const isRoot = n.id === this.doc.root.id;
      if (n.color) {
        rect.setAttribute('fill', shade(n.color, 0.15));
        rect.setAttribute('stroke', colorCss(n.color));
        rect.setAttribute('stroke-width', '1.5');
      } else if (isRoot) {
        rect.setAttribute('fill', '#4f8cf0');
        rect.setAttribute('stroke', '#3d7be0');
      } else {
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#dadde2');
      }
      grp.append(rect);

      // 文本(自动换行)
      const lines = wrapText(n.text, n.w - 16);
      const textH = lines.length * LINE_H;
      const startY = (NODE_H - textH) / 2 + FONT_SIZE - 2;
      for (let i = 0; i < lines.length; i++) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('class', 'mm-node-text');
        t.setAttribute('x', 8);
        t.setAttribute('y', startY + i * LINE_H);
        t.setAttribute('font-size', FONT_SIZE);
        t.setAttribute('fill', (n.color || isRoot) ? '#2b333b' : (isRoot ? '#fff' : '#2b333b'));
        if (isRoot && !n.color) t.setAttribute('fill', '#fff');
        t.textContent = lines[i];
        grp.append(t);
      }

      // 折叠标记
      if (n.children && n.children.length > 0 && n.collapsed) {
        const badge = document.createElementNS(ns, 'circle');
        badge.setAttribute('cx', n.w);
        badge.setAttribute('cy', NODE_H / 2);
        badge.setAttribute('r', 6);
        badge.setAttribute('fill', '#4f8cf0');
        badge.setAttribute('stroke', '#fff');
        badge.setAttribute('stroke-width', 1.5);
        grp.append(badge);
        const bn = document.createElementNS(ns, 'text');
        bn.setAttribute('x', n.w);
        bn.setAttribute('y', NODE_H / 2 + 3);
        bn.setAttribute('font-size', 9);
        bn.setAttribute('fill', '#fff');
        bn.setAttribute('text-anchor', 'middle');
        bn.textContent = '+';
        grp.append(bn);
      }

      // 交互
      grp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.lastClickedId = n.id;
        if (e.shiftKey && n.children && n.children.length) {
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.collapsed = !f.node.collapsed; this.onChange(this.doc, true); this.render(); this._applyTransform(); }
          return;
        }
        this.editingId = n.id;
        this._editingDraft = n.text;
        this.render();
        this._applyTransform();
      });

      g.append(grp);
    }

    svg.append(g);
    this.container.replaceChildren(svg);
    this._applyTransform();
  }

  applyColorToSelected(colorKey) {
    // 思维导图无选中态,这里不做处理,配色由大纲驱动
  }
}

// ---------- 布局算法 ----------
function measureNode(node) {
  const text = node.text || '';
  // 估算宽度:最长行 * charW,限制范围
  const lines = text.split('\n');
  const maxLine = Math.max(...lines.map((l) => l.length), 1);
  let w = maxLine * CHAR_W + 20;
  // 多行时高度增大,这里仍用固定 NODE_H(多行由 wrap 处理,但不增加盒子高度以保证布局整洁)
  w = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, w));
  node._w = w;
  return w;
}

function layoutHeight(node) {
  if (!node.children || node.collapsed || node.children.length === 0) {
    node._sh = NODE_H + NODE_GAP_Y;
    return node._sh;
  }
  let total = 0;
  for (const c of node.children) total += layoutHeight(c);
  node._sh = Math.max(NODE_H + NODE_GAP_Y, total);
  return node._sh;
}

function assignPos(node, depth, yTop) {
  node.x = depth * (NODE_MAX_W + NODE_GAP_X);
  if (!node.children || node.collapsed || node.children.length === 0) {
    node.y = yTop + (NODE_H + NODE_GAP_Y - NODE_H) / 2;
    return;
  }
  let cur = yTop;
  for (const c of node.children) {
    assignPos(c, depth + 1, cur);
    cur += c._sh;
  }
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  node.y = (first.y + last.y) / 2;
}

function collect(node, parent, nodes, edges) {
  nodes.push({
    id: node.id, text: node.text, color: node.color,
    x: node.x, y: node.y, w: node._w,
    children: node.children, collapsed: node.collapsed,
  });
  if (parent) {
    edges.push({ from: parent, to: node });
  }
  if (node.children && !node.collapsed) {
    for (const c of node.children) collect(c, node, nodes, edges);
  }
}

function wrapText(text, maxW) {
  const maxChars = Math.max(4, Math.floor((maxW - 16) / CHAR_W));
  const result = [];
  for (const line of (text || '').split('\n')) {
    if (line.length <= maxChars) { result.push(line); continue; }
    let s = line;
    while (s.length > maxChars) {
      result.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    result.push(s);
  }
  return result.length ? result : [''];
}

// 颜色变浅(用于填充)
function shade(colorKey, alpha) {
  const map = {
    red: '#fbe7e6', orange: '#fdeede', yellow: '#fdf6dd', green: '#e6f5e6',
    cyan: '#e0f4f6', blue: '#e8f1fe', purple: '#efe9fb', pink: '#fbe9f1',
  };
  return map[colorKey] || '#ffffff';
}
