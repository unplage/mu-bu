// outliner.js — 大纲视图渲染与编辑
import { el, escapeHtml, colorCss } from './utils.js';
import {
  flattenVisible, findNode, insertAfter, removeNode, indent, outdent, moveNode, contains,
} from './tree.js';

export class Outliner {
  constructor(container, doc, onChange) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange; // (doc) => void
    this.selectedId = doc.root.id;
    this._focusId = null;
    this._focusOffset = null;
    this._renderBound = () => this.render();
    this._attach();
  }

  setDoc(doc) {
    this.doc = doc;
    this.render();
  }

  _attach() {
    this.container.addEventListener('keydown', (e) => this._onKey(e));
    this.container.addEventListener('click', (e) => {
      const row = e.target.closest('.outline-row');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('.bullet')) {
        this._toggleCollapse(id);
      } else {
        this.selectedId = id;
      }
    });
    // 拖拽
    this.container.addEventListener('dragstart', (e) => this._onDragStart(e));
    this.container.addEventListener('dragover', (e) => this._onDragOver(e));
    this.container.addEventListener('drop', (e) => this._onDrop(e));
    this.container.addEventListener('dragend', () => this._clearDrop());
  }

  // ---------- 渲染 ----------
  render() {
    const flat = flattenVisible(this.doc.root);
    const frag = document.createDocumentFragment();
    for (const { node, depth } of flat) {
      frag.append(this._renderNode(node, depth));
    }
    this.container.replaceChildren(frag);
    if (this._focusId) {
      this._restoreFocus();
    }
  }

  _renderNode(node, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = node.collapsed;
    const selected = node.id === this.selectedId;

    const bullet = el('div', {
      class: 'bullet' + (hasChildren ? ' has-children' : ' empty') + (isCollapsed ? ' collapsed' : ''),
      dataset: { id: node.id },
    });
    const dot = el('span', { class: 'bullet-dot' });
    if (node.color) {
      bullet.dataset.color = node.color;
      bullet.style.setProperty('--bullet-color', colorCss(node.color));
    }
    bullet.append(dot);

    const text = el('div', {
      class: 'node-text',
      contenteditable: 'true',
      spellcheck: 'false',
      dataset: { id: node.id, placeholder: '输入内容…' },
    });
    text.innerHTML = textToHtml(node.text);

    const body = el('div', { class: 'node-body' }, [text]);
    const row = el('div', {
      class: 'outline-row' + (selected ? ' selected' : ''),
      dataset: { id: node.id, depth: String(depth) },
      draggable: 'true',
    }, [bullet, body]);
    row.style.paddingLeft = (depth * 22) + 'px';

    // 输入处理:仅更新模型,不重渲染
    text.addEventListener('input', () => {
      const f = findNode(this.doc.root, node.id);
      if (f) f.node.text = textToModel(text);
      this._emitChange(false);
    });
    // 阻止 contenteditable 换行产生 div
    text.addEventListener('paste', (e) => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand('insertText', false, txt);
    });

    return row;
  }

  // ---------- 焦点管理 ----------
  _saveFocus() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const textEl = sel.anchorNode?.parentElement?.closest('.node-text');
    if (!textEl) return;
    this._focusId = textEl.dataset.id;
    this._focusOffset = caretOffset(textEl);
  }

  _restoreFocus() {
    const id = this._focusId;
    const offset = this._focusOffset;
    this._focusId = null;
    this._focusOffset = null;
    const textEl = this.container.querySelector(`.node-text[data-id="${id}"]`);
    if (!textEl) return;
    textEl.focus();
    setCaret(textEl, offset);
  }

  _focusNode(id, offset = 'end') {
    this._focusId = id;
    this._focusOffset = offset;
    this.render();
  }

  // ---------- 键盘 ----------
  _onKey(e) {
    const textEl = e.target.closest('.node-text');
    if (!textEl) return;
    const id = textEl.dataset.id;
    const found = findNode(this.doc.root, id);
    if (!found) return;
    const { node, parent, index } = found;

    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 在光标处分割文本
      const split = splitAtCaret(textEl);
      node.text = split.before;
      const newNode = makeNode(split.after);
      if (parent) insertAfter(parent, index, newNode);
      else node.children.unshift(newNode); // root 无 parent
      this.selectedId = newNode.id;
      this._focusNode(newNode.id, 'start');
      this._emitChange(true);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // outdent: 需要 parent 的 parent(grandparent)
        const gpInfo = parent ? findNode(this.doc.root, parent.id) : null;
        const grandparent = gpInfo ? gpInfo.parent : null;
        if (parent && outdent(parent, index, grandparent)) {
          this._saveFocus();
          this.render();
          this._emitChange(true);
        }
      } else {
        if (parent && indent(parent, index)) {
          this._saveFocus();
          this.render();
          this._emitChange(true);
        }
      }
      return;
    }

    if (e.key === 'Backspace' && caretAtStart(textEl) && node.text === '') {
      e.preventDefault();
      // 删除空节点,聚焦前一个兄弟或父节点
      const target = previousVisibleId(this.doc.root, id) || parent?.id;
      if (parent) removeNode(parent, index);
      else return; // root 不可删
      this.selectedId = target;
      this._focusNode(target, 'end');
      this._emitChange(true);
      return;
    }

    if (mod && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      if (!parent) return; // root 不可删
      const target = previousVisibleId(this.doc.root, id) || nextVisibleId(this.doc.root, id) || parent.id;
      removeNode(parent, index);
      this.selectedId = target;
      this._focusNode(target, 'end');
      this._emitChange(true);
      return;
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (parent && index > 0) {
        moveNode(parent, index, parent, index - 1);
        this._saveFocus();
        this.render();
        this._emitChange(true);
      }
      return;
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      if (parent && index < parent.children.length - 1) {
        moveNode(parent, index, parent, index + 1);
        this._saveFocus();
        this.render();
        this._emitChange(true);
      }
      return;
    }

    if (e.key === 'ArrowUp' && (caretAtStart(textEl) || mod)) {
      e.preventDefault();
      const prev = previousVisibleId(this.doc.root, id);
      if (prev) {
        this.selectedId = prev;
        this._focusNode(prev, 'end');
      }
      return;
    }
    if (e.key === 'ArrowDown' && (caretAtEnd(textEl) || mod)) {
      e.preventDefault();
      const nxt = nextVisibleId(this.doc.root, id);
      if (nxt) {
        this.selectedId = nxt;
        this._focusNode(nxt, 'start');
      }
      return;
    }

    if (mod && e.key === '/') {
      e.preventDefault();
      this._toggleCollapse(id);
      return;
    }
  }

  _toggleCollapse(id) {
    const f = findNode(this.doc.root, id);
    if (!f || !f.node.children || f.node.children.length === 0) return;
    f.node.collapsed = !f.node.collapsed;
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }

  // ---------- 颜色 / 高亮 ----------
  setSelected(id) {
    this.selectedId = id;
    this.container.querySelectorAll('.outline-row').forEach((r) => {
      r.classList.toggle('selected', r.dataset.id === id);
    });
  }

  applyColor(colorKey) {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    f.node.color = colorKey || null;
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }

  toggleHighlight() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    // 用 color=yellow 模拟高亮快捷
    f.node.color = f.node.color === 'yellow' ? null : 'yellow';
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }

  collapseAll() {
    for (const n of walkGen(this.doc.root)) {
      if (n === this.doc.root) continue; // 不折叠根节点(文档本身)
      if (n.children && n.children.length) n.collapsed = true;
    }
    this.render();
    this._emitChange(true);
  }
  expandAll() {
    for (const n of walkGen(this.doc.root)) n.collapsed = false;
    this.render();
    this._emitChange(true);
  }

  // ---------- 拖拽 ----------
  _onDragStart(e) {
    const row = e.target.closest('.outline-row');
    if (!row) return;
    this._dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  }
  _onDragOver(e) {
    const row = e.target.closest('.outline-row');
    if (!row) return;
    const targetId = row.dataset.id;
    if (!this._dragId || contains(this._findNodeById(this._dragId), targetId)) return;
    e.preventDefault();
    this._clearDrop();
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.3) row.classList.add('drop-before');
    else if (y > h * 0.7) row.classList.add('drop-after');
    else row.classList.add('drop-child');
  }
  _onDrop(e) {
    e.preventDefault();
    const row = e.target.closest('.outline-row');
    if (!row || !this._dragId) return;
    const srcId = this._dragId;
    const tgtId = row.dataset.id;
    if (srcId === tgtId) return;
    const src = findNode(this.doc.root, srcId);
    const tgt = findNode(this.doc.root, tgtId);
    if (!src || !tgt) return;
    if (contains(src.node, tgtId)) return; // 不能拖到自己的子树

    const place = row.classList.contains('drop-before') ? 'before'
      : row.classList.contains('drop-after') ? 'after' : 'child';

    if (place === 'child') {
      if (!tgt.node.children) tgt.node.children = [];
      tgt.node.children.push(src.node);
      if (src.parent) removeNode(src.parent, src.index);
      tgt.node.collapsed = false;
    } else {
      if (!tgt.parent) return; // 不能在 root 前后插入
      let idx = tgt.index;
      if (place === 'after') idx += 1;
      const sameParent = src.parent === tgt.parent;
      if (src.parent) removeNode(src.parent, src.index);
      // 同父移动:src 在 tgt 之前时,移除后 idx 需回退 1
      if (sameParent && src.index < idx) idx -= 1;
      tgt.parent.children.splice(idx, 0, src.node);
    }
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }
  _clearDrop() {
    this.container.querySelectorAll('.drop-before,.drop-after,.drop-child')
      .forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-child'));
    this.container.querySelectorAll('.dragging').forEach((r) => r.classList.remove('dragging'));
  }
  _findNodeById(id) {
    return findNode(this.doc.root, id)?.node;
  }

  // ---------- 保存 ----------
  _emitChange(persist) {
    this.onChange(this.doc, persist);
  }
}

// ---------- 纯函数辅助 ----------
function* walkGen(node) {
  yield node;
  if (node.children) for (const c of node.children) yield* walkGen(c);
}

function makeNode(text = '') {
  return {
    id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    text,
    note: '',
    color: null,
    collapsed: false,
    children: [],
  };
}

function previousVisibleId(root, id) {
  const flat = flattenVisible(root);
  const i = flat.findIndex((x) => x.node.id === id);
  return i > 0 ? flat[i - 1].node.id : null;
}
function nextVisibleId(root, id) {
  const flat = flattenVisible(root);
  const i = flat.findIndex((x) => x.node.id === id);
  return i >= 0 && i < flat.length - 1 ? flat[i + 1].node.id : null;
}

// ---------- 光标与文本 ----------
function textToModel(textEl) {
  // 将 <br> 与 <div> 转为 \n
  let out = '';
  textEl.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeName === 'DIV') out += (i ? '\n' : '') + n.textContent;
  });
  return out;
}

function textToHtml(text) {
  if (!text) return '';
  const lines = escapeHtml(text).split('\n');
  return lines.map((l, i) => i === 0 ? l : '<br>' + l).join('');
}

function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  let count = 0;
  pre.cloneContents().childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) count += n.textContent.length;
    else if (n.nodeName === 'BR') count += 1;
    else count += n.textContent.length;
  });
  return count;
}

function setCaret(el, offset) {
  if (offset === 'start') offset = 0;
  if (offset === 'end') offset = el.textContent.length;
  const sel = window.getSelection();
  const range = document.createRange();
  // 遍历子节点定位
  let cur = 0;
  let placed = false;
  const walk = (node) => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (cur + len >= offset) {
        range.setStart(node, offset - cur);
        range.collapse(true);
        placed = true;
        return;
      }
      cur += len;
    } else if (node.nodeName === 'BR') {
      if (cur === offset) {
        range.setStartBefore(node);
        range.collapse(true);
        placed = true;
        return;
      }
      cur += 1;
    } else {
      node.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretAtStart(el) {
  return caretOffset(el) === 0;
}
function caretAtEnd(el) {
  return caretOffset(el) >= el.textContent.length;
}

function splitAtCaret(el) {
  const off = caretOffset(el);
  const full = textToModel(el);
  return { before: full.slice(0, off), after: full.slice(off) };
}
