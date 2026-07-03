// mindmap.js — 思维导图视图(SVG 无限画布,完整编辑)
import { el, escapeHtml, colorCss } from './utils.js';
import { findNode, flattenVisible } from './tree.js';

const FONT_SIZES = { S: 12, M: 14, L: 18 };
const NODE_H = 36;
const NODE_GAP_Y = 12;
const NODE_GAP_X = 80;
const NODE_MAX_W = 260;
const NODE_MIN_W = 60;
const CHAR_W = 9;
const LINE_H = 18;

export class Mindmap {
  constructor(container, doc, onChange) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange; // (doc, persist) => void
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.selectedId = doc.root.id;
    this.editingId = null;
    this._editingDraft = '';
    this._panning = null;
    this._attach();
  }

  setDoc(doc) {
    this.doc = doc;
    this.editingId = null;
    if (!findNode(doc.root, this.selectedId)) this.selectedId = doc.root.id;
    this.render();
    this.fit();
  }

  _attach() {
    const c = this.container;
    // 平移(背景拖拽)
    c.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mm-node') || e.target.closest('.mm-edit')) return;
      // 点击空白:取消选中
      if (e.button === 0) {
        this.selectedId = null;
        this.render();
      }
      this._panning = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      c.classList.add('panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._panning) return;
      const dx = e.clientX - this._panning.x;
      const dy = e.clientY - this._panning.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._panning.moved = true;
      this.tx = this._panning.tx + dx;
      this.ty = this._panning.ty + dy;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      this._panning = null;
      c.classList.remove('panning');
    });
    // 缩放(滚轮,以鼠标为中心)
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = c.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newScale = Math.min(3, Math.max(0.2, this.scale * delta));
      const ratio = newScale / this.scale;
      this.tx = cx - (cx - this.tx) * ratio;
      this.ty = cy - (cy - this.ty) * ratio;
      this.scale = newScale;
      this._applyTransform();
    }, { passive: false });

    // 键盘(容器获焦后)
    c.tabIndex = 0;
    c.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onKey(e) {
    if (this.editingId) return; // 编辑中不处理快捷键
    if (!this.selectedId) return;
    const found = findNode(this.doc.root, this.selectedId);
    if (!found) return;
    const { node, parent, index } = found;

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      this._addChild(node);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (parent) this._addSibling(parent, index);
      else this._addChild(node);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (parent) this._delete(parent, index);
      return;
    }
    if (e.key === 'F2' || (e.key === ' ' && !e.target.closest('.mm-edit'))) {
      e.preventDefault();
      this._startEdit(node);
      return;
    }
    if (e.key === 'ArrowUp' && parent && index > 0) {
      e.preventDefault();
      this.selectedId = parent.children[index - 1].id;
      this.render();
      return;
    }
    if (e.key === 'ArrowDown' && parent && index < parent.children.length - 1) {
      e.preventDefault();
      this.selectedId = parent.children[index + 1].id;
      this.render();
      return;
    }
    if (e.key === 'ArrowRight' && node.children && node.children.length) {
      e.preventDefault();
      this.selectedId = node.children[0].id;
      this.render();
      return;
    }
    if (e.key === 'ArrowLeft' && parent) {
      e.preventDefault();
      this.selectedId = parent.id;
      this.render();
      return;
    }
  }

  _addChild(parent) {
    const newNode = {
      id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: '新节点', note: '', color: null, collapsed: false, children: [],
      fontSize: parent.fontSize || 'M',
    };
    if (!parent.children) parent.children = [];
    parent.children.push(newNode);
    parent.collapsed = false;
    this.selectedId = newNode.id;
    this.onChange(this.doc, true);
    this.render();
    this._startEdit(newNode);
  }

  _addSibling(parent, index) {
    const newNode = {
      id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: '新节点', note: '', color: null, collapsed: false, children: [],
      fontSize: parent.fontSize || 'M',
    };
    parent.children.splice(index + 1, 0, newNode);
    this.selectedId = newNode.id;
    this.onChange(this.doc, true);
    this.render();
    this._startEdit(newNode);
  }

  _delete(parent, index) {
    const prev = parent.children[index - 1];
    parent.children.splice(index, 1);
    this.selectedId = prev ? prev.id : parent.id;
    this.onChange(this.doc, true);
    this.render();
  }

  _startEdit(node) {
    this.editingId = node.id;
    this._editingDraft = node.text;
    this.render();
  }

  // ---------- 缩放/平移 ----------
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
    const g = this.container.querySelector('#mm-root');
    if (!g) return;
    let bbox;
    try { bbox = g.getBBox(); } catch (e) { return; }
    const rect = this.container.getBoundingClientRect();
    if (bbox.width <= 0 || bbox.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
    const pad = 80;
    const sx = (rect.width - pad * 2) / bbox.width;
    const sy = (rect.height - pad * 2) / bbox.height;
    this.scale = Math.min(1.5, Math.min(sx, sy));
    if (this.scale <= 0) this.scale = 0.5;
    this.tx = pad - bbox.x * this.scale + (rect.width - bbox.width * this.scale - pad * 2) / 2;
    this.ty = pad - bbox.y * this.scale + (rect.height - bbox.height * this.scale - pad * 2) / 2;
    this._applyTransform();
  }

  // ---------- 渲染 ----------
  render() {
    const root = this.doc.root;
    measureNode(root);
    layoutHeight(root);
    assignPos(root, 0, 0);

    const nodes = [];
    const edges = [];
    collect(root, null, nodes, edges);

    // SVG 尺寸 = 容器尺寸(无限画布效果由 viewBox 配合 transform 实现)
    const rect = this.container.getBoundingClientRect();
    const cw = rect.width || 800;
    const ch = rect.height || 600;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';

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
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', e.to.color ? colorCss(e.to.color) : '#c4c9d0');
      path.setAttribute('stroke-width', '1.5');
      g.append(path);
    }

    // 节点
    for (const n of nodes) {
      const grp = document.createElementNS(ns, 'g');
      grp.setAttribute('class', 'mm-node' + (n.id === this.selectedId ? ' selected' : ''));
      grp.setAttribute('transform', `translate(${n.x},${n.y})`);
      grp.dataset.id = n.id;

      const fontSize = FONT_SIZES[n.fontSize || 'M'];

      // 编辑态:foreignObject + textarea
      if (this.editingId === n.id) {
        const fo = document.createElementNS(ns, 'foreignObject');
        fo.setAttribute('width', Math.max(n.w, 140));
        fo.setAttribute('height', NODE_H);
        const ta = el('input', {
          class: 'mm-edit',
          type: 'text',
          value: this._editingDraft,
          style: {
            width: Math.max(n.w - 16, 120) + 'px',
            height: (NODE_H - 4) + 'px',
            fontSize: fontSize + 'px',
          },
        });
        fo.append(ta);
        grp.append(fo);
        g.append(grp);
        requestAnimationFrame(() => {
          ta.focus();
          ta.select();
        });
        ta.addEventListener('input', () => { this._editingDraft = ta.value; });
        const commit = () => {
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.text = this._editingDraft || '空节点'; this.onChange(this.doc, true); }
          this.editingId = null;
          this.render();
          this._applyTransform();
        };
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); ta.blur(); }
          if (e.key === 'Escape') { this.editingId = null; this.render(); this._applyTransform(); }
          e.stopPropagation();
        });
        continue;
      }

      // 矩形
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'mm-node-rect');
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', 6);
      const isRoot = n.id === this.doc.root.id;
      if (n.color) {
        rect.setAttribute('fill', shade(n.color, 0.15));
        rect.setAttribute('stroke', colorCss(n.color));
        rect.setAttribute('stroke-width', '2');
      } else if (isRoot) {
        rect.setAttribute('fill', '#4f8cf0');
        rect.setAttribute('stroke', '#3d7be0');
        rect.setAttribute('stroke-width', '2');
      } else {
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#dadde2');
        rect.setAttribute('stroke-width', '1.5');
      }
      // 选中边框
      if (n.id === this.selectedId) {
        rect.setAttribute('stroke', '#4f8cf0');
        rect.setAttribute('stroke-width', '3');
      }
      grp.append(rect);

      // 文本(自动换行)
      const lines = wrapText(n.text, n.w - 16);
      const textH = lines.length * LINE_H;
      const startY = (NODE_H - textH) / 2 + fontSize - 2;
      for (let i = 0; i < lines.length; i++) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('class', 'mm-node-text');
        t.setAttribute('x', 8);
        t.setAttribute('y', startY + i * LINE_H);
        t.setAttribute('font-size', fontSize);
        t.setAttribute('font-family', '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
        if (isRoot && !n.color) t.setAttribute('fill', '#fff');
        else t.setAttribute('fill', '#2b333b');
        t.textContent = lines[i];
        grp.append(t);
      }

      // 折叠标记
      if (n.children && n.children.length > 0 && n.collapsed) {
        const badge = document.createElementNS(ns, 'circle');
        badge.setAttribute('cx', n.w);
        badge.setAttribute('cy', NODE_H / 2);
        badge.setAttribute('r', 8);
        badge.setAttribute('fill', '#4f8cf0');
        badge.setAttribute('stroke', '#fff');
        badge.setAttribute('stroke-width', 2);
        badge.setAttribute('class', 'mm-badge');
        grp.append(badge);
        const bn = document.createElementNS(ns, 'text');
        bn.setAttribute('x', n.w);
        bn.setAttribute('y', NODE_H / 2 + 4);
        bn.setAttribute('font-size', 11);
        bn.setAttribute('fill', '#fff');
        bn.setAttribute('text-anchor', 'middle');
        bn.setAttribute('font-weight', 'bold');
        bn.textContent = '+';
        grp.append(bn);
      }

      // 节点统计(子节点数)
      if (n.children && n.children.length > 0 && !n.collapsed) {
        const count = n.children.length;
        const ct = document.createElementNS(ns, 'text');
        ct.setAttribute('x', n.w + 6);
        ct.setAttribute('y', NODE_H / 2 + 4);
        ct.setAttribute('font-size', 10);
        ct.setAttribute('fill', '#9aa1ab');
        ct.textContent = `(${count})`;
        grp.append(ct);
      }

      // 交互
      grp.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._panning?.moved) return; // 拖拽中不触发
        this.selectedId = n.id;
        // Shift+点击折叠/展开
        if (e.shiftKey && n.children && n.children.length) {
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.collapsed = !f.node.collapsed; this.onChange(this.doc, true); }
        }
        // 双击编辑
        if (e.detail === 2) {
          this._startEdit(n);
          return;
        }
        this.render();
      });

      g.append(grp);
    }

    svg.append(g);
    this.container.replaceChildren(svg);
    this._applyTransform();
  }

  /** 对选中节点应用字号 */
  applyFontSize(size) {
    if (!this.selectedId) return;
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    f.node.fontSize = size;
    this.onChange(this.doc, true);
    this.render();
  }

  /** 节点计数 */
  countNodes() {
    let n = 0;
    const rec = (node) => { n++; if (node.children) node.children.forEach(rec); };
    rec(this.doc.root);
    return n;
  }
}

// ---------- 布局算法 ----------
function measureNode(node) {
  const text = node.text || '';
  const lines = text.split('\n');
  const maxLine = Math.max(...lines.map((l) => l.length), 1);
  const fontSize = FONT_SIZES[node.fontSize || 'M'];
  const charW = fontSize * 0.6;
  let w = maxLine * charW + 24;
  w = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, w));
  node._w = w;
  if (node.children) for (const c of node.children) measureNode(c);
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
  const item = {
    id: node.id, text: node.text, color: node.color, fontSize: node.fontSize,
    x: node.x, y: node.y, w: node._w,
    children: node.children, collapsed: node.collapsed,
  };
  nodes.push(item);
  if (parent) edges.push({ from: parent, to: item });
  if (node.children && !node.collapsed) {
    for (const c of node.children) collect(c, item, nodes, edges);
  }
}

function wrapText(text, maxW) {
  const maxChars = Math.max(4, Math.floor((maxW - 16) / (FONT_SIZES.M * 0.6)));
  const result = [];
  for (const line of (text || '').split('\n')) {
    if (line.length <= maxChars) { result.push(line); continue; }
    let s = line;
    while (s.length > maxChars) {
      result.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    if (s) result.push(s);
  }
  return result.length ? result : [''];
}

function shade(colorKey, alpha) {
  const map = {
    red: '#fbe7e6', orange: '#fdeede', yellow: '#fdf6dd', green: '#e6f5e6',
    cyan: '#e0f4f6', blue: '#e8f1fe', purple: '#efe9fb', pink: '#fbe9f1',
  };
  return map[colorKey] || '#ffffff';
}
