// mindmap.js — 思维导图视图(SVG 无限画布,完整编辑,自适应节点,触屏支持)
import { el, colorCss, getTextWidth, isLightColor, shade, isMobile, spanStyled, copySpan, textToHtml, spansFromDom, contentText } from './utils.js';
import { findNode, contains, removeNodesByIds } from './tree.js';
import * as Clipboard from './clipboard.js';

const FONT_SIZES = { S: 12, M: 14, L: 18 };
const LINE_HEIGHT_RATIO = 1.4;
const NODE_PAD_X = 12;
const NODE_PAD_Y = 8;
const NODE_GAP_Y = 10;
const NODE_GAP_X = 50;   // 层级间连线长度(紧凑)
const NODE_MIN_W = 50;
const NODE_MAX_W = 240;  // 超出换行
const LAYOUTS = ['right', 'down', 'radial', 'leftright'];

/** 导图主题(整体配色,节点显式 color 覆盖主题色) */
export const THEMES = {
  ocean: { bg: '#eef4fb', rootFill: '#2c6ed5', rootStroke: '#1f57b0', rootText: '#ffffff', levelStroke: ['#2c6ed5', '#4f8cf0', '#7faef5'], text: '#2b333b', edge: '#8fb4e8' },
  forest: { bg: '#eff6ee', rootFill: '#3a9d63', rootStroke: '#2c7a4c', rootText: '#ffffff', levelStroke: ['#3a9d63', '#5cb85c', '#8fd09f'], text: '#2b333b', edge: '#a3cfa8' },
  sunset: { bg: '#fdf3ef', rootFill: '#e0674f', rootStroke: '#c24f38', rootText: '#ffffff', levelStroke: ['#e0674f', '#f0a04b', '#f5c56b'], text: '#2b333b', edge: '#f0b28f' },
  mono: { bg: '#f5f5f5', rootFill: '#3a3f47', rootStroke: '#2a2e34', rootText: '#ffffff', levelStroke: ['#3a3f47', '#6a7280', '#aab2c0'], text: '#2b333b', edge: '#b9bfc7' },
};

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
    this._selectedExtra = new Set();
    this._selectionMode = false; // 移动端选择模式
    this.editingId = null;
    this._editingDraft = '';
    this._panning = null;
    this._wasDragging = false;
    this._dragCandidate = null;
    this._draggingNode = null;
    this._dropTarget = null;
    this._viewRoot = null;
    this._longPressTimer = null;
    this._longPressTriggered = false;
    this._attach();
  }

  setDoc(doc) {
    this.doc = doc;
    this.layout = LAYOUTS.includes(doc.layout) ? doc.layout : 'right';
    this.editingId = null;
    this._selectedExtra.clear();
    if (!findNode(doc.root, this.selectedId)) this.selectedId = doc.root.id;
    this.render();
    this.fit();
  }

  /** 同步文档引用但不重绘/不重置视角。触发方(结构操作/文本提交)自己会 render。 */
  syncDoc(doc) {
    this.doc = doc;
    this.layout = LAYOUTS.includes(doc.layout) ? doc.layout : 'right';
    if (!findNode(doc.root, this.selectedId)) this.selectedId = doc.root.id;
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
      this._dragCandidate = null;
      // 按下节点时记录候选拖拽(节点重排);空白处直接进入平移
      const nodeEl = e.target.closest('.mm-node');
      if (nodeEl) {
        const id = nodeEl.dataset.id;
        const f = findNode(this.doc.root, id);
        if (f && f.parent) this._dragCandidate = { id, x: e.clientX, y: e.clientY };
      }
      this._panning = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      c.classList.add('panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._panning) return;
      const dx = e.clientX - this._panning.x;
      const dy = e.clientY - this._panning.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this._wasDragging = true;
        // 起点在节点上:进入节点拖拽模式(不再平移)
        if (this._dragCandidate) {
          if (!this._draggingNode) this._enterNodeDrag();
          else this._updateNodeDrag(e);
          return;
        }
      }
      this.tx = this._panning.tx + dx;
      this.ty = this._panning.ty + dy;
      this._applyTransform();
    });
    window.addEventListener('mouseup', () => {
      if (this._panning) {
        this._panning = null;
        c.classList.remove('panning');
      }
      if (this._draggingNode) this._finishNodeDrag();
      this._dragCandidate = null;
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
              this._select(f.node.id);
              // 移动端无右键:长按弹完整菜单(编辑/增删/折叠/放左放右)
              this._showContextMenu({
                clientX: t.clientX, clientY: t.clientY, preventDefault() {}, stopPropagation() {},
              }, f.node, f.parent, f.index);
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
    c.addEventListener('touchend', (e) => {
      // 编辑中点击 mm-edit 外部(画布/其他节点):立即提交,不依赖 iOS 的 blur
      if (this.editingId && this._commitEdit && !e.target.closest('.mm-edit')) {
        this._commitEdit();
      }
      clearTimeout(this._longPressTimer);
      touchData = null;
      // 长按松手:抑制兼容 mouse 事件,避免右键菜单被紧随的 mousedown 误关/误触节点
      if (this._longPressTriggered) e.preventDefault();
      this._longPressTriggered = false;
    }, { passive: false });

    c.tabIndex = 0;
    c.addEventListener('keydown', (e) => this._onKey(e));
    c.addEventListener('contextmenu', (e) => {
      if (this._longPressTriggered) return;
      const g = e.target.closest('.mm-node');
      if (!g) { this._closeContextMenu(); return; }
      e.preventDefault();
      const f = findNode(this.doc.root, g.dataset.id);
      if (!f) return;
      this._select(f.node.id);
      this.container.focus();
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

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); this._toggleTodo(node); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this._selectAll(); return; }
    if (mod && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === 'v' && !Clipboard.getAppClipboard()) return; // 无节点剪贴板时放行
      e.preventDefault();
      if (k === 'c') this.copySelected();
      else if (k === 'x') this.cutSelected();
      else this.pasteTo(node.id);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); this._addChild(node); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (parent) this._addSibling(parent, index); else this._addChild(node); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (this._selectedExtra.size > 0 || mod) { this.deleteSelected(); return; }
      if (parent) this._delete(parent, index);
      return;
    }
    if (e.key === 'F2' || e.key === ' ') { e.preventDefault(); this._startEdit(node); return; }
    if (e.key === 'ArrowUp' && parent && index > 0) { e.preventDefault(); this._select(parent.children[index - 1].id); return; }
    if (e.key === 'ArrowDown' && parent && index < parent.children.length - 1) { e.preventDefault(); this._select(parent.children[index + 1].id); return; }
    if (e.key === 'ArrowRight' && node.children && node.children.length) { e.preventDefault(); this._select(node.children[0].id); return; }
    if (e.key === 'ArrowLeft' && parent) { e.preventDefault(); this._select(parent.id); return; }
  }

  /** 选中(增量更新边框属性,不整图重绘);additive=Ctrl 多选切换 */
  _select(id, additive) {
    if (additive) {
      if (id === this.selectedId || this._selectedExtra.has(id)) {
        // 取消选中
        if (id === this.selectedId) {
          const arr = [...this._selectedExtra];
          this._selectedExtra.clear();
          if (arr.length) {
            this.selectedId = arr.pop();
            arr.forEach((x) => this._selectedExtra.add(x));
          }
        } else {
          this._selectedExtra.delete(id);
        }
      } else {
        this._selectedExtra.add(id);
      }
      this._applySelectionAttr(id);
      return;
    }
    if (this.selectedId === id && this._selectedExtra.size === 0) return;
    const prevId = this.selectedId;
    this._selectedExtra.clear();
    this.selectedId = id;
    this._syncSelectionAttrs(prevId, id);
  }

  /** 批量删除选中节点 */
  deleteSelected() {
    const removed = removeNodesByIds(this.doc.root, new Set(this.getSelectedIds()));
    if (!removed.length) return false;
    this._selectedExtra.clear();
    const prev = previousSiblingId(this.doc.root, this.selectedId) || this.selectedId;
    const f = findNode(this.doc.root, prev);
    this.selectedId = f ? f.node.id : this.doc.root.id;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
    return true;
  }

  // ---------- 节点拖拽重排 ----------
  _enterNodeDrag() {
    this._wasDragging = true;
    this._draggingNode = { fromId: this._dragCandidate.id };
    const g = this.container.querySelector(`.mm-node[data-id="${this._dragCandidate.id}"]`);
    g?.classList.add('is-dragging');
    this.container.classList.add('node-dragging');
  }

  _updateNodeDrag(e) {
    const target = this._dropTargetAt(e.clientX, e.clientY);
    this.container.querySelectorAll('.mm-drop-before,.mm-drop-after,.mm-drop-child').forEach((x) =>
      x.classList.remove('mm-drop-before', 'mm-drop-after', 'mm-drop-child'));
    if (target) {
      const g = this.container.querySelector(`.mm-node[data-id="${target.node.id}"]`);
      g?.classList.add('mm-drop-' + target.place);
    }
    this._dropTarget = target;
  }

  _dropTargetAt(clientX, clientY) {
    if (!this._draggingNode) return null;
    let el = null;
    try { el = document.elementFromPoint(clientX, clientY); } catch (_) { return null; }
    const g = el && el.closest('.mm-node');
    if (!g) return null;
    const id = g.dataset.id;
    if (id === this._draggingNode.fromId) return null;
    const f = findNode(this.doc.root, id);
    if (!f) return null;
    if (contains(f.node, this._draggingNode.fromId)) return null; // 不能拖进自己子树
    const rect = g.getBoundingClientRect();
    if (rect.height <= 0) return null;
    const r = (clientY - rect.top) / rect.height;
    const place = r < 0.3 ? 'before' : (r > 0.7 ? 'after' : 'child');
    return { node: f.node, parent: f.parent, index: f.index, place };
  }

  _finishNodeDrag() {
    const drag = this._draggingNode;
    this._draggingNode = null;
    this._dragCandidate = null;
    this.container.classList.remove('node-dragging');
    this.container.querySelectorAll('.mm-node.is-dragging').forEach((x) => x.classList.remove('is-dragging'));
    this.container.querySelectorAll('.mm-drop-before,.mm-drop-after,.mm-drop-child').forEach((x) =>
      x.classList.remove('mm-drop-before', 'mm-drop-after', 'mm-drop-child'));
    const tgt = this._dropTarget;
    this._dropTarget = null;
    if (!tgt) return;
    const src = findNode(this.doc.root, drag.fromId);
    if (!src || !src.parent) return;
    if (contains(src.node, tgt.node.id)) return;
    const srcParent = src.parent;
    const srcIndex = src.index;
    if (tgt.place === 'child') {
      if (!tgt.node.children) tgt.node.children = [];
      tgt.node.children.push(src.node);
      srcParent.children.splice(srcIndex, 1);
      tgt.node.collapsed = false;
    } else {
      if (!tgt.parent) return;
      let idx = tgt.index;
      if (tgt.place === 'after') idx += 1;
      const sameParent = srcParent === tgt.parent;
      srcParent.children.splice(srcIndex, 1);
      if (sameParent && srcIndex < idx) idx -= 1;
      tgt.parent.children.splice(idx, 0, src.node);
    }
    this.selectedId = src.node.id;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
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
    this._startEdit(newNode, true);
  }

  _addSibling(parent, index) {
    const inheritedSize = parent.fontSize || 'M';
    const newNode = makeNode('新节点', inheritedSize, parent.color || null, parent.fontColor || null);
    parent.children.splice(index + 1, 0, newNode);
    this.selectedId = newNode.id;
    this.onChange(this.doc, true);
    this.render();
    this._startEdit(newNode, true);
  }

  _delete(parent, index) {
    const prev = parent.children[index - 1];
    parent.children.splice(index, 1);
    this.selectedId = prev ? prev.id : parent.id;
    this.onChange(this.doc, true);
    this.render();
  }

  _startEdit(node, selectAll = false) {
    if (this.editingId === node.id) return;
    this.editingId = node.id;
    this._editingDraft = textToHtml(node.text, node.spans, node.fontColor);
    this._editSelectAll = !!selectAll;
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
      if (!disabled) {
        b.addEventListener('click', () => { this._closeContextMenu(); fn(); });
        b.addEventListener('touchend', (ev) => {
          ev.preventDefault();
          this._closeContextMenu();
          fn();
        });
      }
      menu.append(b);
    };

    addItem('编辑', false, () => this._startEdit(node));
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
    if (this._ctxClose) {
      document.removeEventListener('mousedown', this._ctxClose);
      this._ctxClose = null;
    }
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
    const root = this._viewRoot || this.doc.root;
    const theme = THEMES[this.doc.theme] || null;
    this.container.style.background = this.doc.bg ? this.doc.bg : (theme ? theme.bg : '');
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
      path.setAttribute('stroke', e.to.color ? (e.to.color.startsWith('#') ? e.to.color : colorCss(e.to.color)) : (theme ? theme.edge : '#c4c9d0'));
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
      const isRoot = n.id === root.id;

      // 编辑态
      if (this.editingId === n.id) {
        const fo = document.createElementNS(ns, 'foreignObject');
        fo.setAttribute('width', n.w);
        fo.setAttribute('height', n.h);
        const ta = el('div', {
          class: 'mm-edit',
          contenteditable: 'true',
          spellcheck: 'false',
          dataset: { id: n.id },
          style: {
            width: (n.w - 4) + 'px',
            height: (n.h - 4) + 'px',
            fontSize: fontSize + 'px',
            lineHeight: lineH + 'px',
            textAlign: 'left',
            overflow: 'hidden',
          },
        });
        ta.innerHTML = this._editingDraft || '';
        fo.append(ta);
        grp.append(fo);
        g.append(grp);
        requestAnimationFrame(() => {
          try {
            ta.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(ta);
            // 编辑已有节点时不自动全选(只把光标放到末尾),避免残留全选被误当成用户选区
            if (!this._editSelectAll) range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) { /* 某些环境无完整 Selection/Range 实现,忽略 */ }
        });
        ta.addEventListener('input', () => { this._editingDraft = ta.innerHTML; });
        // 粘贴只保留纯文本,换行转 <br>,避免污染 spans 重建
        ta.addEventListener('paste', (e) => {
          e.preventDefault();
          const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
          const sel = window.getSelection();
          if (!sel.rangeCount) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const frag = document.createDocumentFragment();
          txt.split('\n').forEach((line, i) => {
            if (i > 0) frag.appendChild(document.createElement('br'));
            frag.appendChild(document.createTextNode(line));
          });
          range.insertNode(frag);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const commit = () => {
          if (this.editingId !== n.id) return;
          const f = findNode(this.doc.root, n.id);
          if (f) {
            const txt = contentText(ta).replace(/^\n+|\n+$/g, '');
            f.node.text = txt || '空节点';
            f.node.spans = txt ? spansFromDom(ta) : null;
            this.onChange(this.doc, true);
          }
          this.editingId = null;
          this._commitEdit = null;
          this.render();
          this._applyTransform();
        };
        this._commitEdit = commit;
        ta.addEventListener('blur', () => {
          const popover = document.getElementById('fontColorPopover');
          if (popover && !popover.hidden) return;
          commit();
        });
        ta.addEventListener('keydown', (ev) => {
          // 输入法组合期不提交
          if (ev.isComposing || ev.keyCode === 229) return;
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
          else if (ev.key === 'Enter') { ev.preventDefault(); document.execCommand?.('insertLineBreak', false, null); this._editingDraft = ta.innerHTML; }
          if (ev.key === 'Escape') { ev.preventDefault(); this.editingId = null; this._commitEdit = null; this.render(); this._applyTransform(); }
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
        rect.setAttribute('fill', theme ? theme.rootFill : '#4f8cf0');
        rect.setAttribute('stroke', theme ? theme.rootStroke : '#3d7be0');
        rect.setAttribute('stroke-width', '2');
      } else if (theme) {
        const c = theme.levelStroke[Math.max(0, n.depth - 1) % theme.levelStroke.length];
        rect.setAttribute('fill', shade(c));
        rect.setAttribute('stroke', c);
        rect.setAttribute('stroke-width', '1.5');
      } else {
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#dadde2');
        rect.setAttribute('stroke-width', '1.5');
      }
      if (n.id === this.selectedId || this._selectedExtra.has(n.id)) {
        rect.setAttribute('stroke', '#4f8cf0');
        rect.setAttribute('stroke-width', '3');
      }
      grp.append(rect);

      // 文本(顶对齐;备注/图片行位于其下)
      const lines = n.lines;
      const textH = lines.length * lineH;
      const startY = NODE_PAD_Y + fontSize - 3;
      const hasCheck = n.checked != null;
      const textX = hasCheck ? 24 : NODE_PAD_X;
      // 待办标记(勾选时实心蓝 + ✓)
      if (hasCheck) {
        const cb = document.createElementNS(ns, 'rect');
        cb.setAttribute('x', 4);
        cb.setAttribute('y', startY - fontSize + 1);
        cb.setAttribute('width', 14);
        cb.setAttribute('height', 14);
        cb.setAttribute('rx', 3);
        cb.setAttribute('fill', n.checked ? '#4f8cf0' : '#ffffff');
        cb.setAttribute('stroke', n.checked ? '#4f8cf0' : '#b9bfc7');
        cb.setAttribute('stroke-width', '1.5');
        grp.append(cb);
        if (n.checked) {
          const cm = document.createElementNS(ns, 'text');
          cm.setAttribute('x', 11);
          cm.setAttribute('y', startY - fontSize + 13);
          cm.setAttribute('font-size', 11);
          cm.setAttribute('fill', '#ffffff');
          cm.setAttribute('text-anchor', 'middle');
          cm.textContent = '✓';
          grp.append(cm);
        }
        cb.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const f = findNode(this.doc.root, n.id);
          if (f) this._toggleTodo(f.node);
        });
      }
      // 字体颜色: node.fontColor > 主题 > 自动对比色
      let defaultTextColor = theme ? theme.text : '#2b333b';
      if (isRoot && !n.color) defaultTextColor = theme ? theme.rootText : '#fff';
      else if (n.color) defaultTextColor = isLightColor(rectColor) ? '#2b333b' : '#ffffff';
      const nodeFontColor = n.fontColor || defaultTextColor;
      // spans: 逐字颜色/富文本; null = 整节点统一样式
      const hasSpans = Array.isArray(n.spans) && n.spans.length > 0 && n.spans.some(spanStyled);
      for (let i = 0; i < lines.length; i++) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', textX);
        t.setAttribute('y', startY + i * lineH);
        t.setAttribute('font-size', fontSize);
        t.setAttribute('font-family', '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
        t.setAttribute('class', 'mm-node-text');
        if (hasSpans) {
          // 逐行拆分 spans,每行内按 span 片段渲染 tspan;高亮段先画背景 rect
          const lineSpans = splitSpansForLine(n.spans, lines[i], n.text, i, lines);
          let xOff = 0;
          for (const sp of lineSpans) {
            if (sp.hl) {
              const hr = document.createElementNS(ns, 'rect');
              hr.setAttribute('x', textX + xOff);
              hr.setAttribute('y', startY + i * lineH - fontSize + 2);
              hr.setAttribute('width', getTextWidth(sp.text, fontSize));
              hr.setAttribute('height', lineH);
              hr.setAttribute('rx', 2);
              hr.setAttribute('fill', sp.hl);
              hr.setAttribute('opacity', '0.55');
              grp.append(hr);
            }
            const ts = document.createElementNS(ns, 'tspan');
            ts.setAttribute('fill', sp.color || nodeFontColor);
            if (sp.b) ts.setAttribute('font-weight', 'bold');
            if (sp.i) ts.setAttribute('font-style', 'italic');
            const deco = [];
            if (sp.u) deco.push('underline');
            if (sp.s) deco.push('line-through');
            if (deco.length) ts.setAttribute('text-decoration', deco.join(' '));
            ts.textContent = sp.text;
            t.append(ts);
            xOff += getTextWidth(sp.text, fontSize);
          }
        } else {
          t.setAttribute('fill', nodeFontColor);
          t.textContent = lines[i];
        }
        grp.append(t);
      }

      // 备注(灰色小字,只读显示)
      if (n.note) {
        const noteTop = NODE_PAD_Y + textH;
        const noteLines = n.note.split('\n');
        for (let i = 0; i < noteLines.length; i++) {
          const nt = document.createElementNS(ns, 'text');
          nt.setAttribute('x', NODE_PAD_X);
          nt.setAttribute('y', noteTop + 12 + i * 15);
          nt.setAttribute('font-size', 12);
          nt.setAttribute('fill', '#9aa1ab');
          nt.textContent = noteLines[i];
          grp.append(nt);
        }
      }
      // 图片 / 附件
      if (n.files && n.files.length) {
        const noteH = n.note ? n.note.split('\n').length * 15 + 6 : 0;
        const fileTop = NODE_PAD_Y + textH + noteH;
        const imgFiles = n.files.filter((f) => f.isImage);
        const otherFiles = n.files.filter((f) => !f.isImage);
        imgFiles.forEach((f, i) => {
          const imgW = Math.min(n.w - NODE_PAD_X * 2, 120);
          const img = document.createElementNS(ns, 'image');
          img.setAttribute('href', f.dataUrl);
          img.setAttribute('x', NODE_PAD_X);
          img.setAttribute('y', fileTop);
          img.setAttribute('width', imgW);
          img.setAttribute('height', 60);
          img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
          img.setAttribute('class', 'mm-node-img');
          grp.append(img);
        });
        otherFiles.forEach((f, i) => {
          const ft = document.createElementNS(ns, 'text');
          ft.setAttribute('x', NODE_PAD_X);
          ft.setAttribute('y', fileTop + 14 + i * 18);
          ft.setAttribute('font-size', 12);
          ft.setAttribute('fill', '#9aa1ab');
          ft.textContent = `📎 ${f.name}`;
          grp.append(ft);
        });
      }

      // 折叠标记(点击展开)
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
        const expand = (ev) => {
          ev.stopPropagation();
          const f = findNode(this.doc.root, n.id);
          if (f) { f.node.collapsed = false; this.onChange(this.doc, true); this.render(); this._applyTransform(); }
        };
        badge.addEventListener('click', expand);
        bn.addEventListener('click', expand);
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
        // 点击节点后把焦点还给画布容器,保证键盘快捷键(结构操作)持续可用
        this.container.focus();
        const wasDrag = this._wasDragging;
        const wasLongPress = this._longPressTriggered;
        this._wasDragging = false;
        this._longPressTriggered = false;
        if (wasDrag || wasLongPress) return;

        if (e.shiftKey && n.children && n.children.length) {
          const f = findNode(this.doc.root, n.id);
          if (f) {
            f.node.collapsed = !f.node.collapsed;
            this.onChange(this.doc, true);
            // 折叠/展开需重绘,否则视图不更新
            this.render();
            this._applyTransform();
          }
          return;
        }
        if (e.detail === 2 && !isMobile) { this._startEdit(n); return; }
        // 单击:增量更新选中态(Ctrl 或选择模式 = 多选),不整图重绘
        this._select(n.id, e.ctrlKey || e.metaKey || this._selectionMode);
      });

      g.append(grp);
    }

    svg.append(g);
    this.container.replaceChildren(svg);
    this._applyTransform();
  }

  /** 单节点选中态边框更新(增量,避免整图重绘) */
  _applySelectionAttr(id) {
    const g = this.container.querySelector(`.mm-node[data-id="${id}"]`);
    if (!g) return;
    const rect = g.querySelector('.mm-node-rect');
    if (!rect) return;
    const selected = id === this.selectedId || this._selectedExtra.has(id);
    const f = findNode(this.doc.root, id);
    if (selected) {
      rect.setAttribute('stroke', '#4f8cf0');
      rect.setAttribute('stroke-width', '3');
    } else if (f) {
      const node = f.node;
      if (node.color) {
        rect.setAttribute('stroke', node.color.startsWith('#') ? node.color : colorCss(node.color));
        rect.setAttribute('stroke-width', '2');
      } else if (node.id === (this._viewRoot || this.doc.root).id) {
        rect.setAttribute('stroke', '#3d7be0');
        rect.setAttribute('stroke-width', '2');
      } else {
        rect.setAttribute('stroke', '#dadde2');
        rect.setAttribute('stroke-width', '1.5');
      }
    }
  }

  /** 选中态边框增量更新(避免整图重绘) */
  _syncSelectionAttrs(prevId, newId) {
    this._applySelectionAttr(prevId);
    this._applySelectionAttr(newId);
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

  /** 对导图编辑框中的当前选区应用内联格式(execCommand + 触发 input 同步 draft) */
  applyInlineFormat(cmd, value) {
    const editEl = this.container.querySelector('.mm-edit');
    if (!editEl) return false;
    if (cmd === 'hiliteColor' || cmd === 'foreColor') document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value ?? null);
    editEl.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /** 对导图编辑框选区着色(模型级重建 spans,不依赖 execCommand;保留 b/i/u/s/hl) */
  applySelectionColor(hex, range, textEl, charStart, charEnd) {
    const id = textEl?.dataset?.id;
    if (!id) return;
    const f = findNode(this.doc.root, id);
    if (!f) return;
    // 先把未提交的编辑内容同步进模型(导图仅在提交时写模型,选中上色前必须先落盘)
    const txt = contentText(textEl);
    f.node.text = txt || '空节点';
    f.node.spans = txt ? spansFromDom(textEl) : null;
    // 计算选区偏移:优先用调用方算好的字符偏移(anchor/focus 直接算,不经过 Range)
    let startOffset = typeof charStart === 'number' ? charStart : null;
    let selectedLen = (typeof startOffset === 'number' && typeof charEnd === 'number') ? charEnd - startOffset : null;
    if (selectedLen == null || selectedLen < 0) {
      // 回退:Range.toString() 计算(普通 DOM 下可用)
      try {
        if (!range || !range.toString) return;
        const preRange = document.createRange();
        preRange.selectNodeContents(textEl);
        preRange.setEnd(range.startContainer, range.startOffset);
        startOffset = preRange.toString().length;
        selectedLen = range.toString().length;
      } catch (_) { return; }
    }
    if (selectedLen <= 0) return;
    // 重建 spans 并着色(仅被选区覆盖的片段换新颜色)
    const oldSpans = (f.node.spans && f.node.spans.length) ? f.node.spans : [{ text: f.node.text || '', color: null }];
    const newSpans = [];
    let pos = 0;
    for (const sp of oldSpans) {
      const spEnd = pos + sp.text.length;
      if (spEnd <= startOffset || pos >= startOffset + selectedLen) {
        newSpans.push(copySpan(sp, sp.text));
      } else {
        const before = sp.text.slice(0, Math.max(0, startOffset - pos));
        const mid = sp.text.slice(Math.max(0, startOffset - pos), Math.min(sp.text.length, startOffset + selectedLen - pos));
        const after = sp.text.slice(Math.min(sp.text.length, startOffset + selectedLen - pos));
        if (before) newSpans.push(copySpan(sp, before));
        if (mid) { const ms = copySpan(sp, mid); ms.color = hex; newSpans.push(ms); }
        if (after) newSpans.push(copySpan(sp, after));
      }
      pos = spEnd;
    }
    f.node.spans = newSpans.some(spanStyled) ? newSpans : null;
    this._editingDraft = textToHtml(f.node.text, f.node.spans, f.node.fontColor);
    // 更新打开中的编辑框(文本长度不变,按原偏移恢复选区),保持编辑态不中断
    const editEl = this.container.querySelector('.mm-edit');
    if (editEl) {
      const endOffset = startOffset + selectedLen;
      editEl.innerHTML = this._editingDraft;
      this._restoreTextRange(editEl, startOffset, endOffset);
    }
    this.onChange(this.doc, true);
    // 非编辑态(无存活编辑框可显示颜色):立即重绘,避免改动延迟到下次 render 才显现
    if (!editEl) {
      this.render();
      this._applyTransform();
    }
  }

  /** 按文本偏移重建编辑框选区(跨 span/文本节点) */
  _restoreTextRange(el, startOff, endOff) {
    try {
      const sel = window.getSelection();
      if (!sel) return;
      const s = this._textNodeAt(el, startOff);
      const e = this._textNodeAt(el, endOff);
      if (!s || !e) return;
      const range = document.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) { /* 无法恢复选区时忽略 */ }
  }

  _textNodeAt(el, offset) {
    let remaining = offset;
    const find = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        if (remaining <= n.textContent.length) return { node: n, offset: remaining };
        remaining -= n.textContent.length;
        return null;
      }
      if (n.nodeName === 'BR') {
        // <br> 占 1 个字符,与 node.text 的 \n 计数一致;边界落在 <br> 后的位置交给后续文本节点
        remaining -= 1;
        return null;
      }
      for (const c of n.childNodes) { const r = find(c); if (r) return r; }
      return null;
    };
    return find(el);
  }

  countNodes() {
    let n = 0;
    const rec = (node) => { n++; if (node.children) node.children.forEach(rec); };
    rec(this.doc.root);
    return n;
  }

  /** 选中集(主节点 + 多选附加) */
  getSelectedIds() {
    return [this.selectedId, ...this._selectedExtra];
  }

  /** 移动端选择模式:开启后点按即多选 */
  setSelectionMode(on) {
    this._selectionMode = !!on;
    if (!on) this._selectedExtra.clear();
    this.render();
  }

  _toggleTodo(node) {
    node.checked = node.checked ? null : true;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
  }

  _selectAll() {
    const ids = [];
    const rec = (n) => { ids.push(n.id); (n.children || []).forEach(rec); };
    rec(this.doc.root);
    if (!ids.length) return;
    this.selectedId = ids[0];
    this._selectedExtra = new Set(ids.slice(1));
    this.render();
  }

  /** 聚焦模式:只渲染该子树 */
  setViewRoot(root) {
    this._viewRoot = root || null;
    this.render();
    this.fit();
  }

  /** 定位并选中某节点(平移画布使其居中) */
  revealNode(id) {
    this._select(id);
    const g = this.container.querySelector(`.mm-node[data-id="${id}"]`);
    if (!g) return;
    const m = g.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    const rect = this.container.getBoundingClientRect();
    if (!m || rect.width <= 0) return;
    const w = parseFloat(g.querySelector('.mm-node-rect').getAttribute('width'));
    const h = parseFloat(g.querySelector('.mm-node-rect').getAttribute('height'));
    this.tx = rect.width / 2 - (parseFloat(m[1]) + w / 2) * this.scale;
    this.ty = rect.height / 2 - (parseFloat(m[2]) + h / 2) * this.scale;
    this._applyTransform();
  }

  copySelected() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return false;
    Clipboard.setAppClipboard(Clipboard.serializeNodes([f.node]));
    try { navigator.clipboard?.writeText(f.node.text).catch(() => {}); } catch (_) {}
    return true;
  }

  cutSelected() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f?.parent) return false;
    if (!this.copySelected()) return false;
    this._delete(f.parent, f.index);
    return true;
  }

  pasteTo(targetId) {
    const json = Clipboard.getAppClipboard();
    if (!json) return false;
    let nodes;
    try { nodes = Clipboard.deserializeNodes(json); } catch (_) { return false; }
    const tgt = findNode(this.doc.root, targetId);
    if (!tgt) return false;
    if (tgt.parent) {
      tgt.parent.children.splice(tgt.index + 1, 0, ...nodes);
    } else {
      this.doc.root.children.unshift(...nodes);
    }
    this.selectedId = nodes[0].id;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
    return true;
  }

  /** 切换折叠(供工具栏按钮) */
  toggleCollapse(id) {
    const f = findNode(this.doc.root, id);
    if (!f?.node?.children?.length) return false;
    f.node.collapsed = !f.node.collapsed;
    this.onChange(this.doc, true);
    this.render();
    this._applyTransform();
    return true;
  }
}

// ---------- 工厂 ----------
function makeNode(text = '', fontSize = 'M', color = null, fontColor = null) {
  const validSizes = ['S', 'M', 'L'];
  return {
    id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text, note: '', color, fontColor, spans: null, collapsed: false, children: [], side: 0,
    fontSize: validSizes.includes(fontSize) ? fontSize : (typeof fontSize === 'number' ? fontSize : 'M'),
    createdAt: Date.now(), checked: null, tags: [], files: null, link: null,
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
  // 高度:文本 + 备注 + 图片/附件 行 + 上下 padding
  const noteLines = (node.note || '').split('\n');
  const noteH = node.note ? noteLines.length * 15 + 6 : 0;
  const files = Array.isArray(node.files) ? node.files : [];
  const hasImg = files.some((f) => f.isImage);
  const fileH = files.length ? (hasImg ? 66 : 22) : 0;
  const textH = lines.length * lineH;
  const h = NODE_PAD_Y * 2 + textH + noteH + fileH;

  MEASURE.set(node, { w, h, lines, noteLines, noteH, fileH, files });
  // 折叠子树不渲染也不参与布局,无需测量
  if (node.children && !node.collapsed) for (const c of node.children) measureNode(c);
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

/** 统计子树可见叶子数(用于径向角度分配,大树占更多角度避免重叠) */
function leafCount(node) {
  if (!node.children || node.collapsed || node.children.length === 0) return 1;
  return node.children.reduce((a, c) => a + leafCount(c), 0);
}

/** 径向辐射:按子树叶子数比例分配角度扇区,半径随层级增长 */
function layoutRadial(node) {
  const place = (n, cx, cy, angleStart, angleEnd, level) => {
    const m = MEASURE.get(n);
    m.x = cx - m.w / 2;
    m.y = cy - m.h / 2;
    if (!n.children || n.collapsed || n.children.length === 0) return;
    const count = n.children.length;
    const weights = n.children.map(leafCount);
    const totalW = weights.reduce((a, b) => a + b, 0) || count;
    const maxW = Math.max(...n.children.map((c) => MEASURE.get(c).w));
    // 半径:至少容纳最宽的兄弟节点
    let needR;
    if (count > 1) {
      const anglePer = (Math.PI * 2 * 0.7) / Math.max(count - 1, 1);
      needR = anglePer > 0.01 ? (maxW + 20) / (2 * Math.sin(anglePer / 2)) : maxW * count / Math.PI;
    } else {
      needR = maxW;
    }
    const radius = Math.max(80 + level * 60, needR + 20);
    // 本节点可用角度范围:传入扇区内、但最多占整圆的 0.7
    const usable = Math.min(angleEnd - angleStart, Math.PI * 2 * 0.7);
    let cur = angleStart + (angleEnd - angleStart - usable) / 2;
    for (let i = 0; i < count; i++) {
      const sector = usable * weights[i] / totalW;
      const a = cur + sector / 2;
      place(n.children[i], cx + radius * Math.cos(a), cy + radius * Math.sin(a), cur, cur + sector, level + 1);
      cur += sector;
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

/** 树序遍历中 id 的前一个节点 id(用于删除后焦点回落) */
function previousSiblingId(root, id) {
  let prev = null;
  let found = false;
  const rec = (n) => {
    if (found) return;
    if (n.id === id) { found = true; return; }
    prev = n;
    if (n.children) n.children.forEach(rec);
  };
  rec(root);
  return found ? (prev ? prev.id : null) : null;
}

/** 将节点的 spans 按换行拆分为每行的 span 片段(供 tspan 渲染,保留富文本属性) */
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
    result.push({
      text: sp.text.slice(clipStart, clipEnd),
      color: sp.color || null,
      b: !!sp.b, i: !!sp.i, u: !!sp.u, s: !!sp.s, hl: sp.hl || null,
    });
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
    id: node.id, text: node.text, note: node.note, color: node.color, fontColor: node.fontColor,
    spans: node.spans, fontSize: node.fontSize, checked: node.checked, tags: node.tags || [],
    files: node.files, link: node.link, x: m.x, y: m.y, w: m.w, h: m.h, lines: m.lines,
    depth: parent ? parent.depth + 1 : 0,
    children: node.children, collapsed: node.collapsed,
  };
  nodes.push(item);
  if (parent) edges.push({ from: parent, to: item });
  if (node.children && !node.collapsed) {
    for (const c of node.children) collect(c, item, nodes, edges);
  }
}
