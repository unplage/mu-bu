// outliner.js — 大纲视图渲染与编辑(虚拟化渲染:只渲染可视窗口内的行)
import { el, escapeHtml, colorCss } from './utils.js';
import { createNode } from './db.js';
import * as Clipboard from './clipboard.js';
import {
  flattenVisible, findNode, insertAfter, removeNode, indent, outdent, moveNode, contains,
  removeNodesByIds, groupIndicesByParent, moveBlock, collectTopmost,
} from './tree.js';

const DEFAULT_ROW_H = 30;   // 未测量前的行高估算(px)
const OVERSCAN = 6;         // 窗口上下额外渲染的行数
const VT_THRESHOLD = 200;   // 超过该行数启用虚拟化

export class Outliner {
  constructor(container, doc, onChange) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange; // (doc, persist) => void
    this.selectedId = doc.root.id;
    this._selectedExtra = new Set(); // 多选附加集合(不含主节点)
    this._selectionMode = false;     // 移动端选择模式:点按即多选
    this._anchorId = doc.root.id;    // 范围选择的锚点
    this._focusId = null;
    this._focusOffset = null;
    this._heights = new Map(); // id -> 行高 px
    this._flat = null;         // 最近一次 render 的可见节点序列
    this._searchQuery = '';    // 搜索高亮(只影响显示,不落模型)
    this._searchMatchIds = null;
    this._searchIndex = -1;
    this._scrollRaf = 0;
    this._scrollBound = () => this._scheduleWindow();
    this._attach();
  }

  /** 是否选中(主节点 + 多选附加) */
  isSelected(id) {
    return id === this.selectedId || this._selectedExtra.has(id);
  }

  /** 全部选中 id(主节点在前) */
  getSelectedIds() {
    return [this.selectedId, ...this._selectedExtra];
  }

  /**
   * 设置选中。opts: additive=Ctrl 追加/切换, range=Shift 范围选择。
   * 返回变化后的选中集 id 列表。
   */
  setSelection(id, { additive = false, range = false } = {}) {
    if (range && this._flat) {
      const flat = this._flat;
      const ai = flat.findIndex((x) => x.node.id === this._anchorId);
      const bi = flat.findIndex((x) => x.node.id === id);
      if (ai >= 0 && bi >= 0) {
        const [a, b] = [Math.min(ai, bi), Math.max(ai, bi)];
        this._selectedExtra = new Set(flat.slice(a, b + 1).map((x) => x.node.id));
        this._selectedExtra.delete(id);
        this.selectedId = id;
        return this.getSelectedIds();
      }
    }
    if (additive) {
      if (id === this.selectedId || this._selectedExtra.has(id)) {
        // 取消选中
        if (id === this.selectedId) {
          const arr = [...this._selectedExtra];
          this._selectedExtra.clear();
          if (arr.length) {
            this.selectedId = arr[arr.length - 1];
            arr.pop();
            arr.forEach((x) => this._selectedExtra.add(x));
          }
        } else {
          this._selectedExtra.delete(id);
        }
      } else {
        this._selectedExtra.add(id);
      }
    } else {
      this._selectedExtra.clear();
      this.selectedId = id;
    }
    this._anchorId = id;
    return this.getSelectedIds();
  }

  clearExtraSelection() {
    this._selectedExtra.clear();
  }

  /** 移动端选择模式:开启后点按即多选(桌面 Ctrl+点击行为不变) */
  setSelectionMode(on) {
    this._selectionMode = !!on;
    if (!on) this._selectedExtra.clear();
    this.render();
  }

  /** 上下移动选中节点(delta=-1/1);多选时整块移动 */
  moveNodeBy(delta) {
    if (this._selectedExtra.size > 0) return this.moveSelectedBlock(delta);
    const f = findNode(this.doc.root, this.selectedId);
    if (!f || !f.parent) return false;
    const { parent, index } = f;
    const target = index + delta;
    if (target < 0 || target >= parent.children.length) return false;
    moveNode(parent, index, parent, target);
    this._saveFocus();
    this.render();
    this._emitChange(true);
    return true;
  }

  setDoc(doc) {
    this.doc = doc;
    this.render();
  }

  /** 滚动容器(应用内为 .view-outline;测试中为 container 自身) */
  _scrollParent() {
    return this.container.closest('.view-outline') || this.container.parentElement || this.container;
  }

  _vtEnabled() {
    if (!this._flat || this._flat.length < VT_THRESHOLD) return false;
    const sp = this._scrollParent();
    return !!sp && (sp.clientHeight || 0) > 0;
  }

  _attach() {
    this.container.addEventListener('keydown', (e) => this._onKey(e));
    this.container.addEventListener('click', (e) => {
      const row = e.target.closest('.outline-row');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('.bullet')) {
        this._toggleCollapse(id);
        return;
      }
      // 复选框/标签×/文件等已有自己的点击处理并 stopPropagation
      if (e.target.closest('.node-check, .node-tag-x, .node-file-img, .node-file-chip, .node-link-chip, .node-tag-input, .node-link-input, .node-file-add')) return;
      const additive = e.ctrlKey || e.metaKey || this._selectionMode;
      const range = e.shiftKey;
      const before = this.getSelectedIds().join(',');
      this.setSelection(id, { additive, range });
      // 选中未变化(在已选节点文本内点击/拖动选字)时不要重渲染,否则丢失光标与文本选区
      if (before !== this.getSelectedIds().join(',')) {
        this._saveFocus();
        this.render();
      }
    });
    // 拖拽
    this.container.addEventListener('dragstart', (e) => this._onDragStart(e));
    this.container.addEventListener('dragover', (e) => this._onDragOver(e));
    this.container.addEventListener('drop', (e) => this._onDrop(e));
    this.container.addEventListener('dragend', () => this._clearDrop());
    this._scrollParent().addEventListener('scroll', this._scrollBound);
  }

  // ---------- 渲染 ----------
  /** 聚焦模式:只渲染该子树(viewRoot=null 回到全文档) */
  setViewRoot(root) {
    this._viewRoot = root || null;
    this.render();
  }

  /** 标签过滤:只显示带该标签的节点(null 清除) */
  setTagFilter(tag) {
    this._tagFilter = tag || null;
    this.render();
  }

  /** 定位并选中某节点(滚动到视口,不抢光标) */
  revealNode(id) {
    this.setSelection(id, {});
    if (!this._flat) this.render();
    const sp = this._scrollParent();
    const i = this._flat.findIndex((x) => x.node.id === id);
    if (i >= 0) {
      let top = 0;
      for (let j = 0; j < i; j++) top += this._heights.get(this._flat[j].node.id) || DEFAULT_ROW_H;
      const vh = sp.clientHeight || 0;
      if (top < (sp.scrollTop || 0) || top > (sp.scrollTop || 0) + vh - 40) {
        sp.scrollTop = Math.max(0, top - 40);
      }
    }
    this.render();
  }

  render() {
    const root = this._viewRoot || this.doc.root;
    let flat = flattenVisible(root);
    if (this._tagFilter) {
      flat = flat.filter((x) => (x.node.tags || []).includes(this._tagFilter));
    }
    this._flat = flat;
    if (this._vtEnabled()) {
      this._renderWindow();
    } else {
      this._renderRows(0, this._flat.length, 0, 0);
    }
  }

  _scheduleWindow() {
    cancelAnimationFrame(this._scrollRaf);
    this._scrollRaf = requestAnimationFrame(() => {
      if (this._vtEnabled()) this._renderWindow();
    });
  }

  /** 渲染窗口内行:顶部/底部占位块保证滚动高度正确 */
  _renderWindow() {
    const flat = this._flat;
    const sp = this._scrollParent();
    const vh = sp.clientHeight || 0;
    const st = sp.scrollTop || 0;
    const n = flat.length;
    const h = (i) => this._heights.get(flat[i].node.id) || DEFAULT_ROW_H;
    // 前缀累计高度
    const tops = new Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) { tops[i] = total; total += h(i); }
    // 视口窗口
    let start = 0;
    while (start < n && tops[start] < st - OVERSCAN * DEFAULT_ROW_H) start++;
    let end = start;
    while (end < n && tops[end] < st + vh + OVERSCAN * DEFAULT_ROW_H) end++;
    // 焦点行必须渲染(否则焦点丢失)
    if (this._focusId) {
      const fi = flat.findIndex((x) => x.node.id === this._focusId);
      if (fi >= 0) {
        if (fi < start) start = fi;
        if (fi >= end) end = fi + 1;
      }
    }
    if (start > 0) start--;
    if (start >= end) end = start + 1;
    const lastH = h(end - 1);
    this._renderRows(start, end, tops[start], total - tops[end - 1] - lastH);
  }

  _renderRows(start, end, spacerTop, spacerBottom) {
    const flat = this._flat;
    const frag = document.createDocumentFragment();
    if (spacerTop > 0) frag.append(el('div', { class: 'vt-spacer', style: { height: spacerTop + 'px' } }));
    for (let i = start; i < end; i++) {
      const { node, depth } = flat[i];
      const row = this._renderNode(node, depth);
      frag.append(row);
      const h = row.offsetHeight || 0;
      if (h > 0) this._heights.set(node.id, h);
    }
    if (spacerBottom > 0) frag.append(el('div', { class: 'vt-spacer', style: { height: spacerBottom + 'px' } }));
    this.container.replaceChildren(frag);
    // 搜索高亮(显示层,不落模型)
    if (this._searchQuery && this._searchMatchIds) {
      for (const el of this.container.querySelectorAll('.node-text')) {
        highlightSearchMatches(el, this._searchQuery);
      }
    }
    if (this._focusId) this._restoreFocus();
  }

  /** 通知(由 app 注入 toast) */
  notify(msg) {
    if (this._toast) this._toast(msg);
  }

  _renderNode(node, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = node.collapsed;
    const selected = this.isSelected(node.id);

    const bullet = el('div', {
      class: 'bullet' + (hasChildren ? ' has-children' : ' empty') + (isCollapsed ? ' collapsed' : ''),
      dataset: { id: node.id },
      draggable: depth !== 0 ? 'true' : 'false',
      title: depth !== 0 ? '拖拽排序' : undefined,
    });
    const dot = el('span', { class: 'bullet-dot' });
    if (node.color) {
      bullet.dataset.color = node.color;
      bullet.style.setProperty('--bullet-color', colorCss(node.color));
    }
    bullet.append(dot);

    const text = el('div', {
      class: 'node-text' + (!node.text ? ' is-empty' : ''),
      contenteditable: 'true',
      spellcheck: 'false',
      dataset: { id: node.id, placeholder: '输入内容…' },
    });
    text.innerHTML = textToHtml(node.text, node.spans, node.fontColor);

    const body = el('div', { class: 'node-body' }, [text]);
    const contentKids = [body];
    // 备注行:有内容或节点被选中时显示(灰色小字,可编辑)
    if (node.note || selected) {
      const note = el('div', {
        class: 'node-note' + (node.note ? ' has-note' : ''),
        contenteditable: 'true',
        spellcheck: 'false',
        dataset: { id: node.id, placeholder: '添加备注…' },
      });
      note.innerHTML = node.note ? escapeHtml(node.note).split('\n').join('<br>') : '';
      note.addEventListener('input', () => {
        const nf = findNode(this.doc.root, node.id);
        if (nf) nf.node.note = textToModel(note).replace(/\s+$/, '');
        const h = row.offsetHeight || 0;
        if (h > 0) this._heights.set(node.id, h);
        this._emitChange(false);
      });
      note.addEventListener('paste', (e) => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand?.('insertText', false, txt);
      });
      contentKids.push(note);
    }
    // 标签行:有标签或选中时显示(可编辑 #标签)
    if ((node.tags && node.tags.length) || selected) {
      const tagsRow = el('div', { class: 'node-tags' });
      (node.tags || []).forEach((t) => {
        const chip = el('span', { class: 'node-tag', dataset: { tag: t } }, [
          '#' + t,
          el('button', { class: 'node-tag-x', dataset: { tag: t }, title: '移除标签' }, '×'),
        ]);
        chip.querySelector('.node-tag-x').addEventListener('click', (e) => {
          e.stopPropagation();
          const f = findNode(this.doc.root, node.id);
          if (!f) return;
          f.node.tags = (f.node.tags || []).filter((x) => x !== t);
          this._saveFocus();
          this.render();
          this._emitChange(true);
        });
        tagsRow.append(chip);
      });
      const tagInput = el('input', { class: 'node-tag-input', dataset: { id: node.id }, placeholder: '添加 #标签' });
      const commitTags = () => {
        const raw = tagInput.value;
        tagInput.value = '';
        const parsed = raw.split(/[\s,，]+/).map((s) => s.replace(/^#/, '').trim()).filter(Boolean);
        if (!parsed.length) return;
        const f = findNode(this.doc.root, node.id);
        if (!f) return;
        const set = new Set([...(f.node.tags || []), ...parsed]);
        f.node.tags = [...set].slice(0, 50);
        this._saveFocus();
        this.render();
        this._emitChange(true);
      };
      tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTags(); }
        e.stopPropagation(); // 不触发行级结构操作
      });
      tagInput.addEventListener('blur', commitTags);
      tagInput.addEventListener('click', (e) => e.stopPropagation());
      tagsRow.append(tagInput);
      contentKids.push(tagsRow);
    }
    // 文件/链接行
    const hasFiles = node.files && node.files.length > 0;
    if (hasFiles || selected) {
      const filesRow = el('div', { class: 'node-files' });
      (node.files || []).forEach((f) => {
        if (f.isImage) {
          const img = el('img', { class: 'node-file-img', src: f.dataUrl, alt: f.name, title: f.name });
          img.addEventListener('click', () => window.open(f.dataUrl, '_blank'));
          filesRow.append(img);
        } else {
          const chip = el('span', { class: 'node-file-chip', title: f.name }, f.name);
          chip.addEventListener('click', () => window.open(f.dataUrl, '_blank'));
          filesRow.append(chip);
        }
      });
      if (selected) {
        const addBtn = el('button', { class: 'node-file-add', title: '插入图片/附件(≤5MB)' }, '＋ 图片/附件');
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*,.pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.zip';
          input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { this.notify?.('文件超过 5MB 上限'); return; }
            const reader = new FileReader();
            reader.onload = () => {
              const f = findNode(this.doc.root, node.id);
              if (!f) return;
              if ((f.node.files || []).length >= 20) { this.notify?.('每节点最多 20 个文件'); return; }
              f.node.files = f.node.files || [];
              f.node.files.push({
                id: 'f_' + Date.now().toString(36),
                name: file.name,
                mime: file.type,
                dataUrl: reader.result,
                isImage: !!file.type.startsWith('image/'),
              });
              this._saveFocus();
              this.render();
              this._emitChange(true);
            };
            reader.readAsDataURL(file);
          };
          input.click();
        });
        filesRow.append(addBtn);
      }
      contentKids.push(filesRow);
    }
    // 链接行
    if (node.link || selected) {
      if (node.link && !selected) {
        contentKids.push(el('a', {
          class: 'node-link-chip', href: node.link, target: '_blank', rel: 'noopener noreferrer',
        }, '🔗 ' + node.link));
      } else {
        const linkInput = el('input', { class: 'node-link-input', dataset: { id: node.id }, value: node.link || '', placeholder: '添加链接 https://…' });
        const commitLink = () => {
          const v = linkInput.value.trim();
          const f = findNode(this.doc.root, node.id);
          if (!f) return;
          f.node.link = (v && /^(https?:\/\/|mailto:)/i.test(v)) ? v : null;
          this._saveFocus();
          this.render();
          this._emitChange(true);
        };
        linkInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitLink(); }
          e.stopPropagation();
        });
        linkInput.addEventListener('blur', commitLink);
        linkInput.addEventListener('click', (e) => e.stopPropagation());
        contentKids.push(linkInput);
      }
    }
    const content = el('div', { class: 'outline-content' }, contentKids);
    // 待办复选框(始终渲染;未勾选时淡显,点击即可添加待办)
    const checkEl = el('button', {
      class: 'node-check' + (node.checked ? ' checked' : '') + (selected ? ' active' : '') + (node.checked ? '' : ' ghost'),
      dataset: { id: node.id },
      title: '待办(点击切换)',
    });
    checkEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = findNode(this.doc.root, node.id);
      if (!f) return;
      f.node.checked = f.node.checked ? null : true;
      this._saveFocus();
      this.render();
      this._emitChange(true);
    });
    const row = el('div', {
      class: 'outline-row' + (selected ? ' selected' : '') + (node.checked ? ' is-checked' : ''),
      dataset: { id: node.id, depth: String(depth) },
    }, [checkEl, bullet, content]);
    row.style.paddingLeft = (depth * 22) + 'px';

    // 输入处理:仅更新模型,不重渲染;顺带刷新行高缓存
    text.addEventListener('input', () => {
      // 先剥离搜索高亮 mark,避免污染 spans 重建
      unwrapSearchMarks(text);
      const f = findNode(this.doc.root, node.id);
      if (f) {
        f.node.text = textToModel(text);
        f.node.spans = spansFromDom(text);
      }
      text.classList.toggle('is-empty', text.textContent === '');
      const h = row.offsetHeight || 0;
      if (h > 0) this._heights.set(node.id, h);
      this._emitChange(false);
    });
    // 聚焦时剥离搜索高亮,防止编辑把 mark 存进模型
    text.addEventListener('focus', () => { unwrapSearchMarks(text); });
    // 阻止 contenteditable 换行产生 div,手动插入保留换行
    text.addEventListener('paste', (e) => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const lines = txt.split('\n');
      const frag = document.createDocumentFragment();
      lines.forEach((line, i) => {
        if (i > 0) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      range.insertNode(frag);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });

    return row;
  }

  // ---------- 焦点管理 ----------
  _saveFocus() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.anchorNode) return;
    const textEl = sel.anchorNode.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement?.closest('.node-text')
      : sel.anchorNode.closest?.('.node-text');
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
    // 虚拟化时把焦点行滚动进视口
    if (this._vtEnabled() && this._flat) {
      const sp = this._scrollParent();
      const i = this._flat.findIndex((x) => x.node.id === id);
      if (i >= 0) {
        let top = 0;
        for (let j = 0; j < i; j++) top += this._heights.get(this._flat[j].node.id) || DEFAULT_ROW_H;
        const vh = sp.clientHeight || 0;
        if (top < (sp.scrollTop || 0) || top > (sp.scrollTop || 0) + vh - 40) {
          sp.scrollTop = Math.max(0, top - 40);
        }
      }
    }
  }

  // ---------- 键盘 ----------
  _onKey(e) {
    // 中文输入法组合期(选词)不做结构操作:Enter 上屏、Backspace 删字等
    if (e.isComposing || e.keyCode === 229) return;
    const textEl = e.target.closest('.node-text');
    if (!textEl) return;
    const id = textEl.dataset.id;
    const found = findNode(this.doc.root, id);
    if (!found) return;
    const { node, parent, index } = found;

    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+Enter 切换待办
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      this.toggleTodo();
      return;
    }
    // Ctrl+A 全选
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    // Ctrl+C / Ctrl+X / Ctrl+V:有文本选区时走浏览器(文本复制);无选区时复制/粘贴节点
    if (mod && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
      const sel = window.getSelection();
      const hasTextSel = sel && sel.rangeCount > 0 && !sel.isCollapsed;
      const k = e.key.toLowerCase();
      if (k === 'v') {
        // 应用剪贴板为空时放行浏览器文本粘贴
        if (hasTextSel || !Clipboard.getAppClipboard()) return;
        e.preventDefault();
        this.pasteTo(id);
        return;
      }
      if (hasTextSel) return; // 文本复制/剪切走浏览器默认
      e.preventDefault();
      if (k === 'c') this.copySelected();
      else this.cutSelected();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 在光标处分割文本和 spans
      const split = splitAtCaret(textEl);
      const oldSpans = node.spans;
      node.text = split.before;
      node.spans = splitSpansAtOffset(oldSpans, split.before.length, node.text);
      const newNode = createNode(split.after);
      // 新节点继承父节点 fontColor; spans 从分割点继承
      newNode.fontColor = node.fontColor;
      newNode.spans = splitSpansAtOffset(oldSpans, split.before.length, split.after, true);
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
      if (!parent) return; // root 不可删
      let target;
      if (node.children && node.children.length > 0) {
        // 子节点提升到祖父级,避免删除丢数据
        const gpInfo = findNode(this.doc.root, parent.id);
        const grandparent = gpInfo ? gpInfo.parent : null;
        if (grandparent) {
          const pIdx = grandparent.children.indexOf(parent);
          grandparent.children.splice(pIdx + 1, 0, ...node.children);
        } else {
          this.doc.root.children.splice(index + 1, 0, ...node.children);
        }
        removeNode(parent, index);
        target = parent.id;
        this._focusNode(target, 'end');
      } else {
        target = previousVisibleId(this.doc.root, id) || parent?.id;
        removeNode(parent, index);
        this.selectedId = target;
        this._focusNode(target, 'end');
      }
      this._emitChange(true);
      return;
    }

    // 多选时 Backspace/Delete 整批删除
    if ((e.key === 'Backspace' || e.key === 'Delete') && this._selectedExtra.size > 0) {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (mod && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      this.deleteSelected();
      return;
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (this._selectedExtra.size > 0) {
        this.moveSelectedBlock(-1);
        return;
      }
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
      if (this._selectedExtra.size > 0) {
        this.moveSelectedBlock(1);
        return;
      }
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

  /** 设置选中节点的默认字体颜色 */
  applyFontColor(hex) {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    f.node.fontColor = hex || null;
    f.node.spans = null;
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }

  /** 对当前选中文本应用字体颜色(逐字着色) */
  applySelectionColor(hex, savedRange, savedTextEl) {
    let range, textEl;
    if (savedRange && savedTextEl) {
      range = savedRange;
      textEl = savedTextEl;
      // 保存期间可能已重渲染:按 nodeId 重新定位,避免用陈旧 DOM 算偏移
      if (!textEl.isConnected && savedTextEl.dataset?.id) {
        textEl = this.container.querySelector(`.node-text[data-id="${savedTextEl.dataset.id}"]`);
        if (!textEl) return;
      }
    } else {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      range = sel.getRangeAt(0);
      textEl = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    }
    if (!textEl || !textEl.closest?.('.node-text')) return;
    const id = textEl.closest('.node-text').dataset.id;
    const f = findNode(this.doc.root, id);
    if (!f) return;
    // 计算选区在节点文本中的偏移
    const preRange = document.createRange();
    preRange.selectNodeContents(textEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const selectedLen = range.toString().length;
    // 重建 spans 并着色(保留加粗/斜体等富文本属性)
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
        if (mid) {
          const ms = copySpan(sp, mid);
          ms.color = hex; // 仅被选区覆盖的片段换新颜色
          newSpans.push(ms);
        }
        if (after) newSpans.push(copySpan(sp, after));
      }
      pos = spEnd;
    }
    f.node.spans = newSpans.some(spanStyled) ? newSpans : null;
    this._saveFocus();
    this.render();
    this._emitChange(true);
  }

  /** 对当前选区应用内联格式(execCommand + 触发 input 重建 spans) */
  applyInlineFormat(cmd, value) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const textEl = sel.anchorNode?.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement?.closest('.node-text')
      : sel.anchorNode?.closest?.('.node-text');
    if (!textEl) return;
    // 高亮命令需要 styleWithCSS 才能产出 background 内联样式
    if (cmd === 'hiliteColor') document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value ?? null);
    textEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- 待办 / 多选批量 ----------
  toggleTodo() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f) return;
    f.node.checked = f.node.checked ? null : true;
    this.render();
    this._emitChange(true);
  }

  selectAll() {
    if (!this._flat || !this._flat.length) return;
    const ids = this._flat.map((x) => x.node.id);
    this.selectedId = ids[0];
    this._selectedExtra = new Set(ids.slice(1));
    this.render();
  }

  deleteSelected() {
    const ids = this.getSelectedIds();
    const removed = removeNodesByIds(this.doc.root, new Set(ids));
    if (!removed.length) return false;
    this._selectedExtra.clear();
    const target = previousVisibleId(this.doc.root, ids[0]) || nextVisibleId(this.doc.root, ids[0]) || this.doc.root.id;
    this.selectedId = target;
    this._focusNode(target, 'end');
    this._emitChange(true);
    return true;
  }

  indentSelectedMulti() {
    const ids = [...this.getSelectedIds()];
    let changed = false;
    for (const id of ids) {
      const f = findNode(this.doc.root, id);
      if (f && f.parent && indent(f.parent, f.index)) changed = true;
    }
    if (changed) { this._saveFocus(); this.render(); this._emitChange(true); }
  }

  outdentSelectedMulti() {
    const ids = [...this.getSelectedIds()];
    let changed = false;
    for (const id of ids) {
      const f = findNode(this.doc.root, id);
      if (!f || !f.parent) continue;
      const gp = findNode(this.doc.root, f.parent.id);
      if (outdent(f.parent, f.index, gp ? gp.parent : null)) changed = true;
    }
    if (changed) { this._saveFocus(); this.render(); this._emitChange(true); }
  }

  /** 多选整块移动(delta=-1/1);仅当全部选中同父时生效 */
  moveSelectedBlock(delta) {
    const map = groupIndicesByParent(this.doc.root, new Set(this.getSelectedIds()));
    if (map.size !== 1) return false;
    const [parent, indices] = [...map.entries()][0];
    if (!moveBlock(parent, indices, delta)) return false;
    this._saveFocus();
    this.render();
    this._emitChange(true);
    return true;
  }

  // ---------- 剪贴板 ----------
  copySelected() {
    const nodes = collectTopmostNodes(this.doc.root, new Set(this.getSelectedIds()));
    if (!nodes.length) return false;
    const json = Clipboard.serializeNodes(nodes);
    Clipboard.setAppClipboard(json);
    try { navigator.clipboard?.writeText(nodes.map((n) => n.text).join('\n')).catch(() => {}); } catch (_) {}
    return true;
  }

  cutSelected() {
    if (!this.copySelected()) return false;
    this.deleteSelected();
    return true;
  }

  pasteTo(targetId) {
    const json = Clipboard.getAppClipboard();
    if (!json) { this.notify('剪贴板为空,请先复制/剪切节点'); return false; }
    let nodes;
    try { nodes = Clipboard.deserializeNodes(json); } catch (_) { return false; }
    const tgt = findNode(this.doc.root, targetId);
    if (!tgt) return false;
    if (tgt.parent) {
      insertAfter(tgt.parent, tgt.index, ...nodes);
    } else {
      // 目标为根:插入到其子节点最前
      this.doc.root.children.unshift(...nodes);
    }
    this._selectedExtra.clear();
    this.selectedId = nodes[0].id;
    this._focusNode(nodes[0].id, 'end');
    this._emitChange(true);
    return true;
  }

  // ---------- 搜索 ----------
  /** 设置搜索词,返回匹配数 */
  setSearchQuery(q) {
    this._searchQuery = (q || '').toLowerCase();
    this._searchMatchIds = null;
    this._searchIndex = -1;
    if (!this._searchQuery) { this.render(); return 0; }
    const ids = [];
    for (const n of walkGen(this.doc.root)) {
      if (((n.text || '') + '\n' + (n.note || '')).toLowerCase().includes(this._searchQuery)) ids.push(n.id);
    }
    this._searchMatchIds = ids;
    this.render();
    return ids.length;
  }

  nextMatch() {
    if (!this._searchMatchIds || !this._searchMatchIds.length) return null;
    this._searchIndex = (this._searchIndex + 1) % this._searchMatchIds.length;
    return this.goToMatch(this._searchIndex);
  }

  prevMatch() {
    if (!this._searchMatchIds || !this._searchMatchIds.length) return null;
    this._searchIndex = (this._searchIndex - 1 + this._searchMatchIds.length) % this._searchMatchIds.length;
    return this.goToMatch(this._searchIndex);
  }

  goToMatch(i) {
    if (!this._searchMatchIds || i < 0 || i >= this._searchMatchIds.length) return null;
    this._searchIndex = i;
    const id = this._searchMatchIds[i];
    this._selectedExtra.clear();
    this.selectedId = id;
    this._focusNode(id, 'end');
    this.render();
    return id;
  }

  replaceCurrent(replacement) {
    if (this._searchIndex < 0 || !this._searchMatchIds) return false;
    const id = this._searchMatchIds[this._searchIndex];
    const f = findNode(this.doc.root, id);
    if (!f) return false;
    const q = this._searchQuery;
    let changed = false;
    if ((f.node.text || '').toLowerCase().includes(q)) {
      f.node.text = replaceAllCI(f.node.text, q, replacement);
      f.node.spans = null; // 替换会破坏 spans 偏移,重置为统一样式
      changed = true;
    }
    if ((f.node.note || '').toLowerCase().includes(q)) {
      f.node.note = replaceAllCI(f.node.note, q, replacement);
      changed = true;
    }
    if (changed) {
      this.setSearchQuery(q);
      this._emitChange(true);
      this.render();
    }
    return changed;
  }

  replaceAll(replacement) {
    const q = this._searchQuery;
    if (!q) return 0;
    let count = 0;
    const re = new RegExp(escapeRegExp(q), 'gi');
    for (const n of walkGen(this.doc.root)) {
      if ((n.text || '').toLowerCase().includes(q)) {
        count += (n.text.match(re) || []).length;
        n.text = replaceAllCI(n.text, q, replacement);
        n.spans = null;
      }
      if ((n.note || '').toLowerCase().includes(q)) {
        n.note = replaceAllCI(n.note, q, replacement);
      }
    }
    if (count) {
      this.setSearchQuery(q);
      this._emitChange(true);
      this.render();
    }
    return count;
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

  // ---------- 移动端按钮 ----------
  indentSelected() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f || !f.parent) return false;
    const { parent, index } = f;
    if (indent(parent, index)) {
      this._saveFocus();
      this.render();
      this._emitChange(true);
      return true;
    }
    return false;
  }

  outdentSelected() {
    const f = findNode(this.doc.root, this.selectedId);
    if (!f || !f.parent) return false;
    const { parent, index } = f;
    const gpInfo = findNode(this.doc.root, parent.id);
    const grandparent = gpInfo ? gpInfo.parent : null;
    if (outdent(parent, index, grandparent)) {
      this._saveFocus();
      this.render();
      this._emitChange(true);
      return true;
    }
    return false;
  }

  // ---------- 拖拽 ----------
  _onDragStart(e) {
    // 仅 bullet 为拖拽手柄(整行 draggable 会阻止文本选择)
    if (!e.target.closest('.bullet')) return;
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

function collectTopmostNodes(root, idSet) {
  return collectTopmost(root, idSet).map((t) => t.node);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceAllCI(str, from, to) {
  return String(str).replace(new RegExp(escapeRegExp(from), 'gi'), to);
}

/** 在节点文本内高亮搜索词(显示层,用 mark.search-hit,编辑前剥离) */
function highlightSearchMatches(textEl, query) {
  const q = String(query).toLowerCase();
  const re = new RegExp('(' + escapeRegExp(query) + ')', 'gi');
  const walker = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.toLowerCase().includes(q)) {
        const frag = document.createDocumentFragment();
        node.textContent.split(re).forEach((p) => {
          if (!p) return;
          if (p.toLowerCase() === q) {
            const mark = document.createElement('mark');
            mark.className = 'search-hit';
            mark.textContent = p;
            frag.append(mark);
          } else {
            frag.append(document.createTextNode(p));
          }
        });
        node.parentNode.replaceChild(frag, node);
      }
    } else {
      [...node.childNodes].forEach(walker);
    }
  };
  [...textEl.childNodes].forEach(walker);
}

/** 剥离搜索高亮 mark(编辑/重建 spans 前调用) */
function unwrapSearchMarks(textEl) {
  textEl.querySelectorAll('mark.search-hit').forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
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
  // 将 <br> 与 <div> 转为 \n;span 标签也提取文本
  let out = '';
  textEl.childNodes.forEach((n, i) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeName === 'DIV') out += (i ? '\n' : '') + n.textContent;
    else if (n.nodeName === 'SPAN') out += n.textContent;
  });
  return out;
}

/** span 是否带任何样式(颜色/加粗/斜体/下划线/删除线/高亮) */
function spanStyled(sp) {
  return !!(sp && (sp.color || sp.b || sp.i || sp.u || sp.s || sp.hl));
}

/** 复制 span 属性到新文本 */
function copySpan(sp, text) {
  return { text, color: sp?.color || null, b: !!sp?.b, i: !!sp?.i, u: !!sp?.u, s: !!sp?.s, hl: sp?.hl || null };
}

/** span 的 CSS 样式串 */
function spanStyle(sp) {
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

function textToHtml(text, spans, fontColor) {
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
    const lineText = text.slice(pos, lineEnd);
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
function spansFromDom(textEl) {
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

/** 在指定偏移量处拆分 spans 数组(保留富文本属性) */
function splitSpansAtOffset(spans, offset, newText, isAfter) {
  if (!spans || spans.length === 0) return null;
  const result = [];
  let pos = 0;
  for (const sp of spans) {
    const spEnd = pos + sp.text.length;
    if (spEnd <= offset) { pos = spEnd; continue; }
    if (pos >= offset) { result.push(copySpan(sp, sp.text)); pos = spEnd; continue; }
    // span 跨越分割点
    const beforeText = sp.text.slice(0, offset - pos);
    const afterText = sp.text.slice(offset - pos);
    if (!isAfter && beforeText) result.push(copySpan(sp, beforeText));
    if (isAfter && afterText) result.push(copySpan(sp, afterText));
    pos = spEnd;
  }
  return result.length > 0 && result.some(spanStyled) ? result : null;
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
