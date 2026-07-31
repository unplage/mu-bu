// mindmap.js — 思维导图视图(SVG 无限画布,完整编辑,自适应节点,触屏支持)
import { el, colorCss, getTextWidth, isLightColor, shade, isMobile } from './utils.js';
import { findNode } from './tree.js';

const FONT_SIZES = { S: 12, M: 14, L: 18 };
const LINE_HEIGHT_RATIO = 1.4;
const NODE_PAD_X = 12;
const NODE_PAD_Y = 8;
const NODE_GAP_Y = 10;
const NODE_GAP_X = 50;   // 层级间连线长度(紧凑)
const NODE_MIN_W = 50;
const NODE_MAX_W = 240;  // 超出换行
const LAYOUTS = ['right', 'down', 'radial', 'leftright'];

export class Mindmap {
  constructor(container, doc, onChange) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange; // (doc, persist) => void
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.layout = LAYOUTS.includes(doc.layout) ? doc.layout : 'right';
    this.selectedId = doc.root.id;
    this.editingId = null;
    this._editingDraft = '';
    this._panning = null;
    this._wasDragging = false;
    this._longPressTimer = null;
    this._longPressTriggered = false;
    this._attach();
  }

  setDoc(doc) {
    this.doc = doc;
    this.layout = LAYOUTS.includes(doc.layout) ? doc.layout : 'right';
    this.editingId = null;
    if (!findNode(doc.root, this.selectedId)) this.selectedId = doc.root.id;
    this.render();
    this.fit();
  }

  /** 切换布局(重绘 + 自适应) */
  setLayout(name) {
    if (!LAYOUTS.includes(name)) return;
    this.layout = name;
    this.render();
    this.fit();
  }

  _attach() {
    const c = this.container;
    c.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mm-edit')) return; // 编辑输入框内拖动不触发画布平移
      this._wasDragging = false;
      this._panning = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      c.classList.add('panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._panning) return;
      const dx = e.clientX - this._panning.x;
      const dy = e.clientY - this._panning.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._wasDragging = true;
      this.tx = this._panning.tx + dx;
      this.ty = this._panning.ty + dy;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      if (this._panning) {
        this._panning = null;
        c.classList.remove('panning');
      }
    });
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

    // 触屏:单指平移 / 双指缩放 / 长按编辑
    let touchData = null;
    c.addEventListener('touchstart', (e) => {
      if (e.target.closest('.mm-edit')) return;
      const t = e.touches[0];
      this._wasDragging = false;
      this._longPressTriggered = false;

      if (e.touches.length === 1) {
        touchData = { mode: 'pan', x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchData = { mode: 'pinch', dist: Math.hypot(dx, dy), scale: this.scale, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        this._wasDragging = true;
      }
      if (e.target.closest('.mm-node') && !e.target.closest('.mm-edit')) {
        const id = e.target.closest('.mm-node').dataset.id;
        if (id) {
          this._longPressTimer = setTimeout(() => {
            const f = findNode(this.doc.root, id);
            if (f) {
              this._longPressTriggered = true;
              this._startEdit(f.node);
            }
          }, 500);
        }
      }
    }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      if (!touchData) return;
      e.preventDefault();
      clearTimeout(this._longPressTimer);
      if (touchData.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchData.x;
        const dy = e.touches[0].clientY - touchData.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) this._wasDragging = true;
        this.tx = touchData.tx + dx;
        this.ty = touchData.ty + dy;
        this._applyTransform();
      } else if (touchData.mode === 'pinch' && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const newScale = Math.min(3, Math.max(0.2, touchData.scale * (newDist / touchData.dist)));
        const rect = c.getBoundingClientRect();
        const cx = touchData.cx - rect.left;
        const cy = touchData.cy - rect.top;
        const ratio = newScale / this.scale;
        this.tx = cx - (cx - this.tx) * ratio;
        this.ty = cy - (cy - this.ty) * ratio;
        this.scale = newScale;
        this._applyTransform();
      }
    }, { passive: false });
    c.addEventListener('touchend', () => {
      clearTimeout(this._longPressTimer);
      touchData = null;
    });

    c.tabIndex = 0;
    c.addEventListener('keydown', (e) => this._onKey(e));
    c.addEventListener('contextmenu', (e) => {
      const g = e.target.closest('.mm-node');
      if (!g) { this._closeContextMenu(); return; }
      e.preventDefault();
      const f = findNode(this.doc.root, g.dataset.id);
      if (!f) return;
      this._select(f.node.id);
      this._showContextMenu(e, f.node, f.parent, f.index);
    });
  }

  _onKey(e) {
    if (this.editingId) return;
    // 中文输入法组合期不响应结构快捷键
    if (e.isComposing || e.keyCode === 229) return;
    if (!this.selectedId) return;
    const found = findNode(this.doc.root, this.selectedId);
    if (!found) return;
    const { node, parent, index } = found;

    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this._addChild(node); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (parent) this._addSibling(parent, index); else this._addChild(node); return; }
    if (e.key === 'Backspace') { e.preventDefault(); if (parent) this._delete(parent, index); return; }
    if (e.key === 'F2' || e.key === ' ') { e.preventDefault(); this._startEdit(node); return; }
    if (e.key === 'ArrowUp' && parent && index > 0) { e.preventDefault(); this._select(parent.children[index - 1].id); return; }
    if (e.key === 'ArrowDown' && parent && index < parent.children.length - 1) { e.preventDefault(); this._select(parent.children[index + 1].id); return; }
    if (e.key === 'ArrowRight' && node.children && node.children.length) { e.preventDefault(); this._select(node.children[0].id); return; }
    if (e.key === 'ArrowLeft' && parent) { e.preventDefault(); this._select(parent.id); return; }
  }

  /** 选中(增量更新边框属性,不整图重绘) */
  _select(id) {
    if (this.selectedId === id) return;
    this._syncSelectionAttrs(this.selectedId, id);
    this.selectedId = id;
  }

  _addChild(parent) {
    const inheritedSize = parent.fontSize || 'M';
    const newNode = makeNode('新节点', inheritedSize, parent.color || null, parent.fontColor || null);
    if (!parent.children) parent.children = [];
    parent.children.push(newNode);
    parent.collapsed = false;
    this.selectedId = newNode.id;
    this.onChange(this.doc, true);
    this.render();
    this._startEdit(newNode);
  }

  _addSibling(parent, index) {
    const inheritedSize = parent.fontSize || 'M';
    const newNode = makeNode('新节点', inheritedSize, parent.color || null, parent.fontColor || null);
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
    if (this.editingId === node.id) return;
    this.editingId = node.id;
    this._editingDraft = node.text;
    this.render();
  }

  // ---------- 右键菜单 ----------
  _showContextMenu(e, node, parent, index) {
    this._closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'mm-ctx-menu';

    const addItem = (label, disabled, fn) => {
      const b = document.createElement('button');
      b.className = 'mm-ctx-item';
      b.textContent = label;
      b.disabled = disabled;
      if (!disabled) b.addEventListener('click', () => { this._closeContextMenu(); fn(); });
      menu.append(b);
    };

    addItem('添加子节点', false, () => this._addChild(node));
    addItem('添加兄弟节点', !parent, () => this._addSibling(parent, index));
    addItem('删除节点', !parent, () => this._delete(parent, index));
    if (node.children && node.children.length) {
      const isCollapsed = !!node.collapsed;
      addItem(isCollapsed ? '展开子节点' : '折叠子节点', false, () => {
        node.collapsed = !node.collapsed;
        this.onChange(this.doc, true);
        this.render();
      });
    }
    const sep = document.createElement('div');
    sep.className = 'mm-ctx-sep';
    menu.append(sep);
    addItem('放置左侧', false, () => { node.side = 1; this.onChange(this.doc, true); this.render(); });
    addItem('放置右侧', false, () => { node.side = 2; this.onChange(this.doc, true); this.render(); });
    addItem('自动交替', false, () => { node.side = 0; this.onChange(this.doc, true); this.render(); });

    menu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 260) + 'px';
    document.body.append(menu);
    this._ctxMenu = menu;

    const closeHandler = (ev) => { if (!menu.contains(ev.target)) this._closeContextMenu(); };
    document.addEventListener('mousedown', closeHandler, { once: true });
    this._ctxClose = closeHandler;
  }

  _closeContextMenu() {
    if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
    if (this._ctxClose) { this._ctxClose = null; }
  }

  _applyTransform() {
    const g = this.container.querySelector('#mm-root');
    if (g) g.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
  }

  zoomBy(factor) {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const newScale = Math.min(3, Math.max(0.2, this.scale * factor));
    const ratio = newScale / this.scale;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.scale = newScale;
    this._applyTransform();
  }
  resetZoom() { this.scale = 1; this.tx = 0; this.ty = 0; this._applyTransform(); }

  fit() {
    const g = this.container.querySelector('#mm-root');
    if (!g) return;
    let bbox;
    try { bbox = g.getBBox(); } catch (e) { return; }
    const rect = this.container.getBoundingClientRect();
    if (bbox.width <= 0 || bbox.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
    const pad = 60;
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
    // 1. 测量每个节点(宽高,基于字号与文本)
    measureNode(root);
    // 2. 按当前布局分配坐标
    if (this.layout === 'radial') {
      layoutRadial(root);
    } else {
      layoutHeight(root);
      if (this.layout === 'down') layoutDownTree(root);
      else if (this.layout === 'leftright') layoutLeftRight(root);
      else assignPos(root, 0, 0);
    }

    const nodes = [], edges = [];
    collect(root, null, nodes, edges);

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';

    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'mm-root');

    // 连线(贝塞尔曲线,形状随布局:水平/垂直/斜向/单侧)
    for (const e of edges) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', edgePath(this.layout, e.from, e.to));
      path.setAttribute('class', 'mm-edge');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', e.to.color ? (e.to.color.startsWith('#') ? e.to.color : colorCss(e.to.color)) : '#c4c9d0');
      path.setAttribute('stroke-width', '1.5');
      g.append(path);
    }

    // 节点
    for (const n of nodes) {
      const grp = document.createElementNS(ns, 'g');
      grp.setAttribute('class', 'mm-node');
      grp.setAttribute('transform', `translate(${n.x},${n.y})`);
      grp.dataset.id = n.id;
      const fontSize = typeof n.fontSize === 'number' ? n.fontSize : (FONT_SIZES[n.fontSize] || 14);
      const lineH = Math.round(fontSize * LINE_HEIGHT_RATIO);
      const rectColor = n.color ? (n.color.startsWith('#') ? n.color : colorCss(n.color)) : null;
      const isRoot = n.id === this.doc.root.id;

      // 编辑态
      if (this.editingId === n.id) {
        const fo = document.createElementNS(ns, 'foreignObject');
        fo.setAttribute('width', n.w);
        fo.setAttribute('height', n.h);
        const ta = el('input', {
          class: 'mm-edit',
          type: 'text',
          value: this._editingDraft,
          style: {
            width: (n.w - 4) + 'px',
            height: (n.h - 4) + 'px',
            fontSize: fontSize + 'px',
            lineHeight: lineH + 'px',
          },
        });
        fo.append(ta);
        grp.append(fo);
        g.append(grp);
        requestAnimationFrame(() => { ta.focus(); ta.select(); });
        ta.addEventListener('input', () => { this._editingDraft = ta.value; });
        const commit = () => {
          if (this.editingId !== n.id) return;
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.text = this._editingDraft || '空节点'; this.onChange(this.doc, true); }
          this.editingId = null;
          this.render();
          this._applyTransform();
        };
        ta.addEventListener('blur', commit);
        ta.addEventListener('keydown', (ev) => {
          // 输入法组合期不提交
          if (ev.isComposing || ev.keyCode === 229) return;
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          if (ev.key === 'Escape') { ev.preventDefault(); this.editingId = null; this.render(); this._applyTransform(); }
          ev.stopPropagation();
        });
        continue;
      }

      // 矩形(高度自适应)
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'mm-node-rect');
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      rect.setAttribute('rx', 6);
      if (n.color) {
        const hex = n.color.startsWith('#') ? n.color : colorCss(n.color);
        rect.setAttribute('fill', shade(n.color));
        rect.setAttribute('stroke', hex);
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
      if (n.id === this.selectedId) {
        rect.setAttribute('stroke', '#4f8cf0');
        rect.setAttribute('stroke-width', '3');
      }
      grp.append(rect);

      // 文本(支持多行,垂直居中)
      const lines = n.lines;
      const textH = lines.length * lineH;
      const startY = (n.h - textH) / 2 + fontSize - 3;
      // 字体颜色: node.fontColor > auto contrast
      let defaultTextColor = '#2b333b';
      if (isRoot && !n.color) defaultTextColor = '#fff';
      else if (n.color) defaultTextColor = isLightColor(rectColor) ? '#2b333b' : '#ffffff';
      const nodeFontColor = n.fontColor || defaultTextColor;
      // spans: 逐字颜色; null = 整节点统一颜色
      const hasSpans = Array.isArray(n.spans) && n.spans.length > 0 && n.spans.some((s) => s.color);
      for (let i = 0; i < lines.length; i++) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', NODE_PAD_X);
        t.setAttribute('y', startY + i * lineH);
        t.setAttribute('font-size', fontSize);
        t.setAttribute('font-family', '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
        t.setAttribute('class', 'mm-node-text');
        if (hasSpans) {
          // 逐行拆分 spans,每行内按 span 片段渲染 tspan
          const lineText = lines[i];
          let offset = 0;
          const lineSpans = splitSpansForLine(n.spans, lineText, n.text, i, lines);
          for (const sp of lineSpans) {
            const ts = document.createElementNS(ns, 'tspan');
            ts.setAttribute('fill', sp.color || nodeFontColor);
            ts.textContent = sp.text;
            t.append(ts);
          }
        } else {
          t.setAttribute('fill', nodeFontColor);
          t.textContent = lines[i];
        }
        grp.append(t);
      }

      // 折叠标记
      if (n.children && n.children.length > 0 && n.collapsed) {
        const badge = document.createElementNS(ns, 'circle');
        badge.setAttribute('cx', n.w + 4);
        badge.setAttribute('cy', n.h / 2);
        badge.setAttribute('r', 8);
        badge.setAttribute('fill', '#4f8cf0');
        badge.setAttribute('stroke', '#fff');
        badge.setAttribute('stroke-width', 2);
        grp.append(badge);
        const bn = document.createElementNS(ns, 'text');
        bn.setAttribute('x', n.w + 4);
        bn.setAttribute('y', n.h / 2 + 4);
        bn.setAttribute('font-size', 11);
        bn.setAttribute('fill', '#fff');
        bn.setAttribute('text-anchor', 'middle');
        bn.setAttribute('font-weight', 'bold');
        bn.textContent = '+';
        grp.append(bn);
      }

      // 子节点数标记
      if (n.children && n.children.length > 0 && !n.collapsed) {
        const ct = document.createElementNS(ns, 'text');
        ct.setAttribute('x', n.w + 6);
        ct.setAttribute('y', n.h / 2 + 4);
        ct.setAttribute('font-size', 10);
        ct.setAttribute('fill', '#9aa1ab');
        ct.textContent = `(${n.children.length})`;
        grp.append(ct);
      }

      // 交互
      grp.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasDrag = this._wasDragging;
        const wasLongPress = this._longPressTriggered;
        this._wasDragging = false;
        this._longPressTriggered = false;
        if (wasDrag || wasLongPress) return;

        if (e.shiftKey && n.children && n.children.length) {
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.collapsed = !f.node.collapsed; this.onChange(this.doc, true); }
        }
        if (e.detail === 2 && !isMobile) { this._startEdit(n); return; }
        // 普通单击:增量更新选中态,不整图重绘
        this._select(n.id);
      });

      g.append(grp);
    }

    svg.append(g);
    this.container.replaceChildren(svg);
    this._applyTransform();
  }

  /** 选中态边框增量更新(避免整图重绘) */
  _syncSelectionAttrs(prevId, newId) {
    const apply = (id, selected) => {
      const g = this.container.querySelector(`.mm-node[data-id="${id}"]`);
      if (!g) return;
      const rect = g.querySelector('.mm-node-rect');
      if (!rect) return;
      const f = findNode(this.doc.root, id);
      if (selected) {
        rect.setAttribute('stroke', '#4f8cf0');
        rect.setAttribute('stroke-width', '3');
      } else if (f) {
        const node = f.node;
        if (node.color) {
          rect.setAttribute('stroke', node.color.startsWith('#') ? node.color : colorCss(node.color));
          rect.setAttribute('stroke-width', '2');
        } else if (node.id === this.doc.root.id) {
          rect.setAttribute('stroke', '#3d7be0');
          rect.setAttribute('stroke-width', '2');
        } else {
          rect.setAttribute('stroke', '#dadde2');
          rect.setAttribute('stroke-width', '1.5');
        }
      }
    };
    apply(prevId, false);
    apply(newId, true);
  }

  applyFontSize(size) {
    if (!this.selectedId) return;
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    // S/M/L → 对应数字; 数字 8-72 保留; 其他→14
    if (size === 'S') f.node.fontSize = 12;
    else if (size === 'L') f.node.fontSize = 18;
    else if (size === 'M' || !size) f.node.fontSize = 14;
    else if (typeof size === 'number' && size >= 8 && size <= 72) f.node.fontSize = Math.round(size);
    else f.node.fontSize = 14;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
  }

  /** 设置节点字体颜色(整节点) */
  applyFontColor(hex) {
    if (!this.selectedId) return;
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    f.node.fontColor = hex || null;
    f.node.spans = null; // 清除逐字颜色,统一用 fontColor
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
  }

  countNodes() {
    let n = 0;
    const rec = (node) => { n++; if (node.children) node.children.forEach(rec); };
    rec(this.doc.root);
    return n;
  }
}

// ---------- 工厂 ----------
function makeNode(text = '', fontSize = 'M', color = null, fontColor = null) {
  const validSizes = ['S', 'M', 'L'];
  return {
    id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text, note: '', color, fontColor, spans: null, collapsed: false, children: [], side: 0,
    fontSize: validSizes.includes(fontSize) ? fontSize : (typeof fontSize === 'number' ? fontSize : 'M'),
  };
}

// ---------- 布局算法 ----------
/** 测量结果缓存(WeakMap):布局字段不写入文档模型,避免污染存储与导出 */
const MEASURE = new WeakMap();

/** 测量节点:按真实像素宽度换行(无 canvas 环境回退字符估宽) */
function measureNode(node) {
  // fontSize: 数字直接用; S/M/L 映射; 其他→14
  let fontSize;
  if (typeof node.fontSize === 'number' && node.fontSize >= 8 && node.fontSize <= 72) fontSize = node.fontSize;
  else if (FONT_SIZES[node.fontSize]) fontSize = FONT_SIZES[node.fontSize];
  else fontSize = 14;
  const lineH = Math.round(fontSize * LINE_HEIGHT_RATIO);
  const maxW = NODE_MAX_W - NODE_PAD_X * 2;

  // 换行:显式 \n + 按词/字符自动换行
  const lines = [];
  for (const paragraph of (node.text || '').split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    const words = paragraph.split(/(\s+)/);
    let current = '';
    for (const w of words) {
      let test = current + w;
      if (getTextWidth(test, fontSize) > maxW) {
        if (current) lines.push(current);
        if (getTextWidth(w, fontSize) > maxW) {
          let charCurrent = '';
          for (const ch of w) {
            if (getTextWidth(charCurrent + ch, fontSize) > maxW) {
              if (charCurrent) lines.push(charCurrent);
              charCurrent = ch;
            } else {
              charCurrent += ch;
            }
          }
          current = charCurrent;
        } else {
          current = w;
        }
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  if (!lines.length) lines.push('');

  // 宽度:最长行的像素宽 + padding,限制范围
  const maxLineW = Math.max(...lines.map((l) => getTextWidth(l, fontSize)), 20);
  const w = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, maxLineW + NODE_PAD_X * 2));
  // 高度:行数 * 行高 + 上下 padding
  const h = lines.length * lineH + NODE_PAD_Y * 2;

  MEASURE.set(node, { w, h, lines });
  if (node.children) for (const c of node.children) measureNode(c);
}

function layoutHeight(node) {
  const m = MEASURE.get(node);
  if (!node.children || node.collapsed || node.children.length === 0) {
    m.sh = m.h + NODE_GAP_Y;
    return m.sh;
  }
  let total = 0;
  for (const c of node.children) total += layoutHeight(c);
  m.sh = Math.max(m.h + NODE_GAP_Y, total);
  return m.sh;
}

/** 分配坐标:x 基于实际节点宽度 + 紧凑间隙(非固定层级宽) */
function assignPos(node, depth, yTop) {
  const m = MEASURE.get(node);
  if (depth === 0) {
    m.x = 0;
  }
  if (!node.children || node.collapsed || node.children.length === 0) {
    m.y = yTop + (m.sh - m.h) / 2;
    return;
  }
  let cur = yTop;
  for (const c of node.children) {
    const cm = MEASURE.get(c);
    cm.x = m.x + m.w + NODE_GAP_X;
    assignPos(c, depth + 1, cur);
    cur += cm.sh;
  }
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  m.y = (MEASURE.get(first).y + MEASURE.get(last).y) / 2;
}

/** 子树宽度(向下树图:水平堆叠间距) */
function subtreeWidth(node) {
  const m = MEASURE.get(node);
  if (!node.children || node.collapsed || node.children.length === 0) return m.w;
  let max = 0;
  for (const c of node.children) max = Math.max(max, subtreeWidth(c));
  return m.w + max + NODE_GAP_X;
}

/** 向下树图:子节点水平排列,垂直向下展开,相对父节点水平居中 */
function layoutDownTree(node) {
  const place = (n, x, y) => {
    const m = MEASURE.get(n);
    m.x = x;
    m.y = y;
    if (!n.children || n.collapsed || n.children.length === 0) return;
    const widths = n.children.map((c) => subtreeWidth(c));
    const total = widths.reduce((a, b) => a + b, 0) + NODE_GAP_X * (widths.length - 1);
    let cx = x + (m.w - total) / 2;
    for (let i = 0; i < n.children.length; i++) {
      place(n.children[i], cx, y + m.h + NODE_GAP_Y);
      cx += widths[i] + NODE_GAP_X;
    }
  };
  place(node, 0, 0);
}

/** 径向辐射:子节点按角度扇区分布,半径随层级增长 */
function layoutRadial(node) {
  const place = (n, cx, cy, angleStart, angleEnd, level) => {
    const m = MEASURE.get(n);
    m.x = cx - m.w / 2;
    m.y = cy - m.h / 2;
    if (!n.children || n.collapsed || n.children.length === 0) return;
    const count = n.children.length;
    let angleRange = Math.min(angleEnd - angleStart, Math.PI * 2 * 0.7);
    if (count === 1) angleRange = 0.6;
    const maxW = Math.max(...n.children.map((c) => MEASURE.get(c).w));
    let needR;
    if (count > 1) {
      const anglePer = angleRange / (count - 1);
      needR = anglePer > 0.01 ? (maxW + 20) / (2 * Math.sin(anglePer / 2)) : maxW * count / Math.PI;
    } else {
      needR = maxW;
    }
    const radius = Math.max(80 + level * 60, needR + 20);
    const start = angleStart + (angleEnd - angleStart - angleRange) / 2;
    for (let i = 0; i < count; i++) {
      const a = count > 1 ? start + angleRange * i / (count - 1) : start + angleRange / 2;
      place(n.children[i], cx + radius * Math.cos(a), cy + radius * Math.sin(a), a - 0.4, a + 0.4, level + 1);
    }
  };
  place(node, 0, 0, 0, Math.PI * 2, 0);
}

/** 左右交错:子节点左右交替展开,side=1 强制左 / side=2 强制右 / 0 自动 */
function layoutLeftRight(node) {
  const place = (n, x, y, rightSide) => {
    const m = MEASURE.get(n);
    m.x = x;
    m.y = y;
    if (!n.children || n.collapsed || n.children.length === 0) return;
    const heights = n.children.map((c) => layoutHeight(c));
    const total = heights.reduce((a, b) => a + b, 0);
    let cy = y + (m.h - total) / 2;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      let childSide, nextRight;
      if (c.side === 1) { childSide = false; nextRight = true; }
      else if (c.side === 2) { childSide = true; nextRight = false; }
      else { childSide = !rightSide; nextRight = !rightSide; }
      place(c, childSide ? x + m.w + NODE_GAP_X : x - m.w - NODE_GAP_X, cy, nextRight);
      cy += heights[i];
    }
  };
  place(node, 0, 0, true);
}

/** 将节点的 spans 按换行拆分为每行的 span 片段(供 tspan 渲染) */
function splitSpansForLine(spans, lineText, fullText, lineIndex, lines) {
  // 计算该行在全文中的起止偏移
  let startOffset = 0;
  for (let i = 0; i < lineIndex; i++) startOffset += lines[i].length + 1; // +1 for \n
  const endOffset = startOffset + lineText.length;
  const result = [];
  let pos = 0;
  for (const sp of spans) {
    const spStart = pos;
    const spEnd = pos + sp.text.length;
    if (spEnd <= startOffset || spStart >= endOffset) { pos = spEnd; continue; }
    const clipStart = Math.max(spStart, startOffset) - spStart;
    const clipEnd = Math.min(spEnd, endOffset) - spStart;
    result.push({ text: sp.text.slice(clipStart, clipEnd), color: sp.color });
    pos = spEnd;
  }
  return result.length ? result : [{ text: lineText, color: null }];
}

/** 连线路径:形状随布局(水平 / 垂直 / 斜向 / 单侧) */
function edgePath(layout, from, to) {
  const y1 = from.y + from.h / 2;
  const y2 = to.y + to.h / 2;
  if (layout === 'down') {
    const x1 = from.x + from.w / 2;
    const x2 = to.x + to.w / 2;
    const cy = Math.abs(y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1 + (y2 > y1 ? cy : -cy)} ${x2},${y2 - (y2 > y1 ? cy : -cy)} ${x2},${y2}`;
  }
  if (layout === 'radial') {
    const x1 = from.x + from.w / 2;
    const y1c = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2c = to.y + to.h / 2;
    const dx = x2 - x1;
    const dy = y2c - y1c;
    return `M${x1},${y1c} C${x1 + dx * 0.4},${y1c + dy * 0.1} ${x2 - dx * 0.4},${y2c - dy * 0.1} ${x2},${y2c}`;
  }
  if (layout === 'leftright' && to.x < from.x) {
    // 左侧子节点:从父左边缘连到子右边缘
    const x1 = from.x;
    const x2 = to.x + to.w;
    const mx = x1 + (x2 - x1) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
  // right / 左右交错右侧:水平贝塞尔
  const x1 = from.x + from.w;
  const x2 = to.x;
  const mx = x1 + (x2 - x1) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function collect(node, parent, nodes, edges) {
  const m = MEASURE.get(node);
  const item = {
    id: node.id, text: node.text, color: node.color, fontColor: node.fontColor, spans: node.spans,
    fontSize: node.fontSize, x: m.x, y: m.y, w: m.w, h: m.h, lines: m.lines,
    children: node.children, collapsed: node.collapsed,
  };
  nodes.push(item);
  if (parent) edges.push({ from: parent, to: item });
  if (node.children && !node.collapsed) {
    for (const c of node.children) collect(c, item, nodes, edges);
  }
}
