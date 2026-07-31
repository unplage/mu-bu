// app.js — 主控制器
import { Outliner } from './outliner.js';
import { Mindmap } from './mindmap.js';
import * as DB from './db.js';
import * as Export from './export.js';
import * as Share from './share.js';
import { el, COLORS, formatDate, debounce, isMobile } from './utils.js';
import { findNode, countText, sortSiblings, flattenVisible } from './tree.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.doc = null;
    this.docs = [];
    this.view = 'outline';
    this.outliner = null;
    this.mindmap = null;
    this.history = [];
    this.redoStack = [];
    this._saveDebounced = debounce((d) => this._persist(d), 400);
    this._pushHistoryDebounced = debounce((d) => this._pushHistory(d, true), 800);
    this._init();
  }

  async _init() {
    this._cacheEls();
    this._bindToolbar();
    this._bindSidebar();
    this._bindModals();
    this._bindMindmapControls();
    this._bindMobileActions();
    this._bindResize();
    this._initColorGrid();
    this.el.mmHint.textContent = isMobile
      ? '长按弹菜单 · 双指缩放 · 拖拽平移 · 单击选中'
      : 'Tab 添加子节点 · Enter 添加兄弟 · 双击编辑 · Shift+点击折叠 · 拖拽平移 · 滚轮缩放';

    // 防抖保存的兜底冲刷:切后台/关闭页面前把最后一次编辑落盘
    const flushSave = () => { if (this.doc) this._saveDebounced.flush(); };
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
    });

    await this.refreshDocs();

    // 检查分享链接
    const shareHash = Share.getShareHashFromURL();
    if (shareHash) {
      try {
        const doc = await Share.decodeShare(shareHash);
        this.doc = doc;
        this._afterDocLoad(true);
        this.toast('已载入分享文档,可编辑后会自动保存为新文档');
        history.replaceState(null, '', location.pathname);
      } catch (e) {
        this.toast('分享链接解析失败');
      }
    } else if (this.docs.length) {
      await this.openDoc(this.docs[0].id);
    } else {
      await this.newDoc();
    }

    this._registerSW();
  }

  /** 保存并刷新侧边栏;失败给出可见提示(避免静默丢数据) */
  _persist(doc) {
    DB.saveDoc(doc)
      .then(() => this.refreshDocs())
      .catch((e) => this.toast('保存失败: ' + (e?.message || e)));
  }

  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 注册失败', e));
    }
  }

  _cacheEls() {
    this.el = {
      docList: $('#docList'),
      newDoc: $('#newDoc'),
      importFile: $('#importFile'),
      searchDocs: $('#searchDocs'),
      docTitle: $('#docTitle'),
      openSidebar: $('#openSidebar'),
      closeSidebar: $('#closeSidebar'),
      sidebar: $('#sidebar'),
      sidebarOverlay: $('#sidebarOverlay'),
      viewOutline: $('#viewOutline'),
      viewMindmap: $('#viewMindmap'),
      outlineView: $('#outlineView'),
      mindmapView: $('#mindmapView'),
      outlineTree: $('#outlineTree'),
      mindmapCanvas: $('#mindmapCanvas'),
      colorPopover: $('#colorPopover'),
      colorGrid: $('#colorGrid'),
      colorClear: $('#colorClear'),
      collapseAll: $('#collapseAll'),
      expandAll: $('#expandAll'),
      undoBtn: $('#undoBtn'),
      redoBtn: $('#redoBtn'),
      exportBtn: $('#exportBtn'),
      exportModal: $('#exportModal'),
      shareBtn: $('#shareBtn'),
      shareModal: $('#shareModal'),
      shareLink: $('#shareLink'),
      shareNote: $('#shareNote'),
      copyShare: $('#copyShare'),
      shareDownload: $('#shareDownload'),
      deleteDoc: $('#deleteDoc'),
      toast: $('#toast'),
      mmZoomIn: $('#mmZoomIn'),
      mmZoomOut: $('#mmZoomOut'),
      mmZoomFit: $('#mmZoomFit'),
      mmZoomReset: $('#mmZoomReset'),
      mmAddChild: $('#mmAddChild'),
      mmAddSibling: $('#mmAddSibling'),
      mmDelete: $('#mmDelete'),
      mmToggleCollapse: $('#mmToggleCollapse'),
      mmFontSize: $('#mmFontSize'),
      mmFontColor: $('#mmFontColor'),
      mmColor: $('#mmColor'),
      mmLayout: $('#mmLayout'),
      mmHint: $('#mmHint'),
      mmStatus: $('#mmStatus'),
      fontSizePopover: $('#fontSizePopover'),
      fontSizeRange: $('#fontSizeRange'),
      fontSizeNumber: $('#fontSizeNumber'),
      fontColorPopover: $('#fontColorPopover'),
      fontColorGrid: $('#fontColorGrid'),
      fontColorHex: $('#fontColorHex'),
      fontColorApply: $('#fontColorApply'),
      fontColorClear: $('#fontColorClear'),
      colorPopover: $('#colorPopover'),
      colorGrid: $('#colorGrid'),
      colorHexInput: $('#colorHexInput'),
      colorHexApply: $('#colorHexApply'),
      colorClear: $('#colorClear'),
      layoutPopover: $('#layoutPopover'),
      indentBtn: $('#indentBtn'),
      outdentBtn: $('#outdentBtn'),
      fmtBold: $('#fmtBold'),
      fmtItalic: $('#fmtItalic'),
      fmtUnderline: $('#fmtUnderline'),
      fmtStrike: $('#fmtStrike'),
      fmtHighlight: $('#fmtHighlight'),
      sortBtn: $('#sortBtn'),
      sortPopover: $('#sortPopover'),
      focusBtn: $('#focusBtn'),
      focusBar: $('#focusBar'),
      focusBack: $('#focusBack'),
      focusTitle: $('#focusTitle'),
      presentBtn: $('#presentBtn'),
      presentModal: $('#presentModal'),
      presentContent: $('#presentContent'),
      presentPrev: $('#presentPrev'),
      presentNext: $('#presentNext'),
      presentExit: $('#presentExit'),
      searchToggle: $('#searchToggle'),
      searchBar: $('#searchBar'),
      searchInput: $('#searchInput'),
      searchPrev: $('#searchPrev'),
      searchNext: $('#searchNext'),
      searchCount: $('#searchCount'),
      searchReplace: $('#searchReplace'),
      searchReplaceOne: $('#searchReplaceOne'),
      searchReplaceAll: $('#searchReplaceAll'),
      searchClose: $('#searchClose'),
      tagBar: $('#tagBar'),
      tocBtn: $('#tocBtn'),
      tocPanel: $('#tocPanel'),
      tocList: $('#tocList'),
      tocClose: $('#tocClose'),
      olStatus: $('#olStatus'),
      olActionBar: $('#olActionBar'),
      actUp: $('#actUp'),
      actDown: $('#actDown'),
      actIndent: $('#actIndent'),
      actOutdent: $('#actOutdent'),
      actDelete: $('#actDelete'),
      actColor: $('#actColor'),
      actMulti: $('#actMulti'),
      actDone: $('#actDone'),
      mmMulti: $('#mmMulti'),
      mmMultiDone: $('#mmMultiDone'),
    };
  }

  // ---------- 工具栏 ----------
  _bindToolbar() {
    this.el.viewOutline.addEventListener('click', () => this.switchView('outline'));
    this.el.viewMindmap.addEventListener('click', () => this.switchView('mindmap'));
    this.el.docTitle.addEventListener('input', () => {
      if (!this.doc) return;
      this.doc.title = this.el.docTitle.value;
      this._saveDebounced(this.doc);
      this.refreshDocs();
    });
    this.el.collapseAll.addEventListener('click', () => this.outliner?.collapseAll());
    this.el.expandAll.addEventListener('click', () => this.outliner?.expandAll());
    this.el.exportBtn.addEventListener('click', () => this.el.exportModal.hidden = false);
    this.el.shareBtn.addEventListener('click', () => this._share());
    this.el.deleteDoc.addEventListener('click', () => this._deleteDoc());
    this.el.undoBtn.addEventListener('click', () => this._undo());
    this.el.redoBtn.addEventListener('click', () => this._redo());
    this.el.indentBtn.addEventListener('click', () => { if (this.outliner) this.outliner.indentSelected(); });
    this.el.outdentBtn.addEventListener('click', () => { if (this.outliner) this.outliner.outdentSelected(); });

    document.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey;
      const inTextEdit = e.target.closest?.('.node-text, .mm-edit');
      const k = e.key.toLowerCase();
      // 搜索(Ctrl+F)
      if (mod && k === 'f') {
        e.preventDefault();
        this._openSearch();
        return;
      }
      // 内容编辑态内:Ctrl+Z 放行原生文本撤销;Ctrl+B/I/U 由浏览器原生处理
      if (inTextEdit) return;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this._redo(); else this._undo();
        return;
      }
      // 焦点不在文本编辑框时,Ctrl+C/X/V 作用于选中节点
      if (mod && ['c', 'x', 'v'].includes(k)) {
        if (this.view === 'outline' && this.outliner) {
          e.preventDefault();
          if (k === 'c') this.outliner.copySelected();
          else if (k === 'x') this.outliner.cutSelected();
          else this.outliner.pasteTo(this.outliner.selectedId);
        } else if (this.view === 'mindmap' && this.mindmap) {
          e.preventDefault();
          if (k === 'c') this.mindmap.copySelected();
          else if (k === 'x') this.mindmap.cutSelected();
          else this.mindmap.pasteTo(this.mindmap.selectedId);
        }
        return;
      }
      // Ctrl+A 全选
      if (mod && k === 'a' && this.view === 'outline') {
        e.preventDefault();
        this.outliner?.selectAll();
      }
    });

    // 富文本格式按钮:mousedown 时保存文本选区(按钮会抢焦点),click 时恢复并执行
    const fmtCmd = (cmd) => ({
      mousedown: (e) => { e.preventDefault(); this._saveTextSelection(); },
      click: () => {
        if (!this.outliner) return;
        const saved = this._savedTextSelection;
        this._savedTextSelection = null;
        if (!saved?.range) { this.toast('请先选中要格式化的文本'); return; }
        const sel = window.getSelection();
        saved.textEl.focus();
        sel.removeAllRanges();
        sel.addRange(saved.range);
        this.outliner.applyInlineFormat(cmd);
      },
    });
    for (const [btn, cmd] of [
      [this.el.fmtBold, 'bold'],
      [this.el.fmtItalic, 'italic'],
      [this.el.fmtUnderline, 'underline'],
      [this.el.fmtStrike, 'strikeThrough'],
      [this.el.fmtHighlight, 'hiliteColor'],
    ]) {
      btn.addEventListener('mousedown', fmtCmd(cmd).mousedown);
      btn.addEventListener('click', fmtCmd(cmd).click);
    }

    // 排序
    this.el.sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const show = this.el.sortPopover.hidden;
      this._hideAllPopovers();
      if (show) this._positionPopover(this.el.sortPopover, this.el.sortBtn);
    });
    this.el.sortPopover.addEventListener('click', (e) => {
      const item = e.target.closest('[data-sort]');
      if (!item) return;
      const [mode, dir] = item.dataset.sort.split(':');
      this._sortSelected(mode, parseInt(dir, 10));
      this.el.sortPopover.hidden = true;
    });

    // 聚焦
    this.el.focusBtn.addEventListener('click', () => {
      const id = this._currentSelectedId();
      if (!id) return;
      const node = this._findNode(this.doc.root, id);
      if (!node) return;
      this._setFocusNode(node);
    });
    this.el.focusBack.addEventListener('click', () => this._clearFocus());

    // 放映
    this.el.presentBtn.addEventListener('click', () => this._openPresent());
    this.el.presentPrev.addEventListener('click', () => this._presentStep(-1));
    this.el.presentNext.addEventListener('click', () => this._presentStep(1));
    this.el.presentExit.addEventListener('click', () => this._closePresent());
    this.el.presentContent.addEventListener('click', () => this._presentStep(1));

    // 搜索
    this.el.searchToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.searchBar.hidden) this._openSearch(); else this._closeSearch();
    });
    this.el.searchInput.addEventListener('input', () => this._doSearch());
    this.el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) this._searchStep(-1); else this._searchStep(1); }
      if (e.key === 'Escape') this._closeSearch();
      e.stopPropagation();
    });
    this.el.searchPrev.addEventListener('click', () => this._searchStep(-1));
    this.el.searchNext.addEventListener('click', () => this._searchStep(1));
    this.el.searchReplaceOne.addEventListener('click', () => {
      if (!this.outliner) return;
      if (this.outliner.replaceCurrent(this.el.searchReplace.value)) this._doSearch(true);
      else this.toast('没有可替换的匹配');
    });
    this.el.searchReplaceAll.addEventListener('click', () => {
      if (!this.outliner) return;
      const n = this.outliner.replaceAll(this.el.searchReplace.value);
      if (n) { this._doSearch(true); this.toast(`已替换 ${n} 处`); }
      else this.toast('没有可替换的匹配');
    });
    this.el.searchClose.addEventListener('click', () => this._closeSearch());

    // 目录
    this.el.tocBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.tocPanel.hidden) { this._renderToc(); this.el.tocPanel.hidden = false; }
      else this.el.tocPanel.hidden = true;
    });
    this.el.tocClose.addEventListener('click', () => { this.el.tocPanel.hidden = true; });
    this.el.tocList.addEventListener('click', (e) => {
      const item = e.target.closest('.toc-item');
      if (!item) return;
      this._revealNode(item.dataset.id);
      this.el.tocPanel.hidden = true;
    });
  }

  switchView(view) {
    this.view = view;
    this.el.viewOutline.classList.toggle('active', view === 'outline');
    this.el.viewMindmap.classList.toggle('active', view === 'mindmap');
    this.el.outlineView.hidden = view !== 'outline';
    this.el.mindmapView.hidden = view !== 'mindmap';
    this.el.olActionBar.hidden = view !== 'outline';
    // 切换到的视图同步最新 doc(双向同步)
    if (view === 'mindmap' && this.mindmap) {
      this.mindmap.setDoc(this.doc);
      this._updateMindmapStatus();
      requestAnimationFrame(() => this.el.mindmapCanvas.focus());
    } else if (view === 'outline' && this.outliner) {
      this.outliner.setDoc(this.doc);
      this._updateOutlineStatus();
    }
  }

  // ---------- 侧边栏 ----------
  _bindSidebar() {
    this.el.newDoc.addEventListener('click', () => this.newDoc());
    const toggleSidebar = (open) => {
      this.el.sidebar.classList.toggle('open', open);
      this.el.sidebarOverlay.classList.toggle('show', open);
    };
    this.el.openSidebar.addEventListener('click', () => toggleSidebar(true));
    this.el.closeSidebar.addEventListener('click', () => toggleSidebar(false));
    this.el.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    this.el.importFile.addEventListener('change', (e) => this._import(e.target.files[0]));
    this.el.searchDocs.addEventListener('input', () => this._renderDocList());
    this.el.docList.addEventListener('click', (e) => {
      const item = e.target.closest('.doc-item');
      if (item) this.openDoc(item.dataset.id);
    });
  }

  async refreshDocs() {
    this.docs = await DB.listDocs();
    this._renderDocList();
  }

  _renderDocList() {
    const q = (this.el.searchDocs.value || '').trim().toLowerCase();
    const list = q ? this.docs.filter((d) => d.title.toLowerCase().includes(q)) : this.docs;
    this.el.docList.replaceChildren(
      ...list.map((d) => el('li', {
        class: 'doc-item' + (this.doc && d.id === this.doc.id ? ' active' : ''),
        dataset: { id: d.id },
      }, [
        el('span', { class: 'doc-name' }, d.title || '未命名'),
        el('span', { class: 'doc-date' }, formatDate(d.updatedAt)),
      ]))
    );
  }

  async newDoc() {
    const doc = DB.createDoc('未命名文档');
    await DB.saveDoc(doc);
    this.doc = doc;
    await this.refreshDocs();
    this._afterDocLoad();
    this.el.docTitle.focus();
    this.el.docTitle.select();
    this.el.searchDocs.value = '';
    this._renderDocList();
    if (window.innerWidth <= 760 || window.matchMedia('(pointer: coarse)').matches) {
      this.el.sidebar.classList.remove('open');
    }
  }

  async openDoc(id) {
    const doc = await DB.getDoc(id);
    if (!doc) return;
    this.doc = doc;
    this._afterDocLoad();
    this.el.searchDocs.value = '';
    this._renderDocList();
    if (window.innerWidth <= 760 || window.matchMedia('(pointer: coarse)').matches) {
      this.el.sidebar.classList.remove('open');
    }
  }

  async _deleteDoc() {
    if (!this.doc) return;
    if (!confirm(`确认删除「${this.doc.title || '未命名'}」?此操作不可恢复。`)) return;
    await DB.deleteDoc(this.doc.id);
    this.docs = await DB.listDocs();
    if (this.docs.length) await this.openDoc(this.docs[0].id);
    else await this.newDoc();
    this._renderDocList();
    this.toast('已删除');
  }

  async _import(file) {
    if (!file) return;
    try {
      const text = await file.text();
      let docs = [];
      if (file.name.endsWith('.json')) {
        docs = Export.importJSON(text); // 内部做结构校验与归一化
      } else if (file.name.endsWith('.opml') || file.name.endsWith('.xml')) {
        docs = [Export.importOPML(text)];
      } else {
        this.toast('不支持的文件格式');
        return;
      }
      for (const d of docs) await DB.saveDoc(d);
      await this.refreshDocs();
      await this.openDoc(docs[0].id);
      this.toast(`已导入 ${docs.length} 个文档`);
    } catch (e) {
      console.error(e);
      this.toast('导入失败: ' + e.message);
    } finally {
      this.el.importFile.value = '';
    }
  }

  _afterDocLoad(noPushHistory = false) {
    this.el.docTitle.value = this.doc.title;
    if (!this.outliner) {
      this.outliner = new Outliner(this.el.outlineTree, this.doc, (d, persist) => this._onChange(d, persist));
      this.outliner._toast = (m) => this.toast(m);
    } else {
      this.outliner.setDoc(this.doc);
    }
    if (!this.mindmap) {
      this.mindmap = new Mindmap(this.el.mindmapCanvas, this.doc, (d, persist) => this._onChange(d, persist));
      this.mindmap._toast = (m) => this.toast(m);
    } else {
      this.mindmap.setDoc(this.doc);
    }
    if (!noPushHistory) {
      this.history = [JSON.stringify(this.doc.root)];
      this.redoStack = [];
    }
    // 重置临时状态:聚焦/搜索/标签过滤/目录
    this._clearFocus();
    this._closeSearch();
    this.outliner.setTagFilter(null);
    this.el.tocPanel.hidden = true;
    this._updateUndoRedo();
    this.switchView(this.view);
    this._renderDocList();
    this._updateOutlineStatus();
    this._updateMindmapStatus();
    this._renderTagBar();
  }

  _onChange(doc, persist) {
    this.doc = doc;
    if (persist) {
      this._pushHistoryDebounced.cancel();
      this._pushHistory(doc);
      this._persist(doc);
    } else {
      this._saveDebounced(doc);
      this._pushHistoryDebounced(doc);
    }
    // 当前视图的非编辑组件同步模型(避免切回时丢失改动);不重绘以免重置缩放/视角
    if (this.view === 'mindmap' && this.mindmap && !this.mindmap.editingId) {
      this.mindmap.syncDoc(doc);
    }
    if (this.view === 'outline' && this.outliner) {
      // 大纲正在编辑时不重渲染(避免光标跳),仅更新 doc 引用
      this.outliner.doc = doc;
    }
    this._updateMindmapStatus();
    this._updateOutlineStatus();
    this._renderTagBar();
  }

  // ---------- 撤销 / 重做 ----------
  _pushHistory(doc = this.doc, isDebounced = false) {
    const last = this.history[this.history.length - 1];
    const current = JSON.stringify(doc.root);
    if (last === current) return;
    this.history.push(current);
    if (this.history.length > 50) this.history.shift();
    if (!isDebounced) this.redoStack = [];
    this._updateUndoRedo();
  }

  _undo() {
    if (this.history.length <= 1) return;
    this.redoStack.push(this.history.pop());
    const root = JSON.parse(this.history[this.history.length - 1]);
    this.doc.root = root;
    this.outliner.setDoc(this.doc);
    this.mindmap.setDoc(this.doc);
    this._persist(this.doc);
    this._updateUndoRedo();
  }

  _redo() {
    if (this.redoStack.length === 0) return;
    const state = this.redoStack.pop();
    this.history.push(state);
    this.doc.root = JSON.parse(state);
    this.outliner.setDoc(this.doc);
    this.mindmap.setDoc(this.doc);
    this._persist(this.doc);
    this._updateUndoRedo();
  }

  _updateUndoRedo() {
    this.el.undoBtn.disabled = this.history.length <= 1;
    this.el.redoBtn.disabled = this.redoStack.length === 0;
  }

  // ---------- 配色 ----------
  _initColorGrid() {
    this.el.colorGrid.replaceChildren(
      ...COLORS.map((c) => el('div', {
        class: 'color-swatch',
        style: { background: c.hex },
        title: c.name,
        dataset: { color: c.key },
      }))
    );
    this.el.colorGrid.addEventListener('click', (e) => {
      const sw = e.target.closest('.color-swatch');
      if (!sw) return;
      this._applyColorToSelected(sw.dataset.color);
      this._hideColorPopover();
    });
    this.el.colorClear.addEventListener('click', () => {
      this._applyColorToSelected(null);
      this._hideColorPopover();
    });
  }

  /** 统一配色:应用到全部选中节点,并同步两个视图 */
  _applyColorToSelected(colorKey) {
    const ids = this._currentSelectedIds();
    if (!ids.length) return;
    let changed = false;
    for (const id of ids) {
      const node = this._findNode(this.doc.root, id);
      if (!node) continue;
      node.color = colorKey || null;
      changed = true;
    }
    if (!changed) return;
    // 大纲重渲染(保持焦点)
    if (this.outliner) {
      this.outliner._saveFocus();
      this.outliner.render();
    }
    // 思维导图重绘
    if (this.mindmap) {
      this.mindmap.render();
      this.mindmap._applyTransform();
    }
    this._onChange(this.doc, true);
  }

  _toggleColorPopover(e, btn) {
    e.stopPropagation();
    if (this.el.colorPopover.hidden) {
      const rect = btn.getBoundingClientRect();
      this.el.colorPopover.style.position = 'fixed';
      this.el.colorPopover.style.top = (rect.bottom + 6) + 'px';
      this.el.colorPopover.style.left = Math.max(0, rect.left - 90) + 'px';
      this.el.colorPopover.style.right = 'auto';
      this.el.colorPopover.hidden = false;
      const cur = this._selectedColor();
      this.el.colorGrid.querySelectorAll('.color-swatch').forEach((s) => {
        s.classList.toggle('active', s.dataset.color === cur);
      });
    } else {
      this._hideColorPopover();
    }
  }
  _hideColorPopover() { this.el.colorPopover.hidden = true; }

  /** 获取节点字号(数字) */
  _getNodeFontSize(node) {
    if (!node) return 14;
    if (typeof node.fontSize === 'number') return node.fontSize;
    if (node.fontSize === 'S') return 12;
    if (node.fontSize === 'L') return 18;
    return 14;
  }

  /** 初始化字体颜色网格 */
  _initFontColorGrid() {
    if (this._fontColorGridInited) return;
    this._fontColorGridInited = true;
    import('./utils.js').then(({ FONT_COLORS }) => {
      this.el.fontColorGrid.replaceChildren(
        ...FONT_COLORS.map((c) => el('div', {
          class: 'color-swatch',
          style: { background: c },
          title: c,
          dataset: { color: c },
        }))
      );
      this.el.fontColorGrid.addEventListener('click', (e) => {
        const sw = e.target.closest('.color-swatch');
        if (!sw) return;
        this._applyFontColorToSelected(sw.dataset.color);
        this.el.fontColorPopover.hidden = true;
      });
    });
  }

  /** 应用字体颜色到选中节点 */
  _applyFontColorToSelected(hex) {
    if (this.view === 'mindmap' && this.mindmap) {
      this.mindmap.applyFontColor(hex);
    } else if (this.outliner) {
      // 优先用缓存的选区( popover 打开会丢失焦点 )
      const saved = this._savedTextSelection;
      this._savedTextSelection = null;
      if (saved && saved.range && !saved.range.collapsed) {
        this.outliner.applySelectionColor(hex, saved.range, saved.textEl);
      } else {
        // 回退到实时 Selection
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          this.outliner.applySelectionColor(hex);
        } else {
          this.outliner.applyFontColor(hex);
        }
      }
    }
  }

  /** 应用自定义背景色(直接设 hex,不走 COLORS 预设) */
  _applyCustomBgColor(hex) {
    const ids = this._currentSelectedIds();
    if (!ids.length) return;
    let changed = false;
    for (const id of ids) {
      const node = this._findNode(this.doc.root, id);
      if (!node) continue;
      node.color = hex;
      changed = true;
    }
    if (!changed) return;
    if (this.outliner) { this.outliner._saveFocus(); this.outliner.render(); }
    if (this.mindmap) { this.mindmap.render(); this.mindmap._applyTransform(); }
    this._onChange(this.doc, true);
  }
  _selectedColor() {
    const id = this._currentSelectedId();
    if (!id) return null;
    const node = this._findNode(this.doc.root, id);
    return node?.color || null;
  }
  _findNode(root, id) {
    if (root.id === id) return root;
    if (!root.children) return null;
    for (const c of root.children) { const r = this._findNode(c, id); if (r) return r; }
    return null;
  }

  // ---------- 模态框 ----------
  _bindModals() {
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        b.closest('.modal').hidden = true;
      });
    });
    this.el.exportModal.addEventListener('click', (e) => {
      const item = e.target.closest('.export-item');
      if (!item) return;
      this._doExport(item.dataset.export);
    });
    this.el.copyShare.addEventListener('click', () => {
      this.el.shareLink.select();
      const copy = async () => {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(this.el.shareLink.value);
          return;
        }
        // 非安全上下文等环境降级:临时 textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = this.el.shareLink.value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand?.('copy');
        ta.remove();
        if (!ok) throw new Error('复制被浏览器拒绝');
      };
      copy()
        .then(() => this.toast('已复制链接'))
        .catch(() => this.toast('复制失败,请手动选中链接复制'));
    });
    this.el.shareDownload.addEventListener('click', () => {
      Export.exportJSON(this.doc);
    });
  }

  async _doExport(type) {
    if (!this.doc) return;
    try {
      switch (type) {
        case 'json': Export.exportJSON(this.doc); break;
        case 'markdown': Export.exportMarkdownFile(this.doc); break;
        case 'opml': Export.exportOPMLFile(this.doc); break;
        case 'txt': Export.exportText(this.doc); break;
        case 'png': await this._exportPNG(); break;
        case 'svg': this._exportSVG(); break;
      }
      this.el.exportModal.hidden = true;
      this.toast('已导出');
    } catch (e) {
      console.error(e);
      this.toast('导出失败: ' + e.message);
    }
  }

  async _exportPNG() {
    // 确保思维导图已渲染(双 rAF 等布局稳定)
    const wasOutline = this.view === 'outline';
    if (wasOutline) this.switchView('mindmap');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const svg = this.el.mindmapCanvas.querySelector('svg');
    if (!svg) throw new Error('思维导图未就绪');
    await Export.exportPNG(svg, this.doc.title);
  }
  _exportSVG() {
    const wasOutline = this.view === 'outline';
    if (wasOutline) this.switchView('mindmap');
    const svg = this.el.mindmapCanvas.querySelector('svg');
    if (!svg) throw new Error('思维导图未就绪');
    Export.exportSVG(svg, this.doc.title);
  }

  // ---------- 分享 ----------
  async _share() {
    if (!this.doc) return;
    this.el.shareModal.hidden = false;
    this.el.shareLink.value = '生成中…';
    this.el.shareNote.textContent = '';
    try {
      const { link, length, limit } = await Share.buildShareLink(this.doc);
      if (length > limit) {
        this.el.shareLink.value = '';
        this.el.shareNote.innerHTML = '⚠ 文档过大,超出链接生成上限。请使用下方「下载 .mubu 文件分享」。';
      } else if (length > limit * 0.85) {
        this.el.shareLink.value = link;
        this.el.shareNote.textContent = '⚠ 文档较大,接近链接长度上限。建议改用「下载 .mubu 文件分享」。';
      } else {
        this.el.shareLink.value = link;
        this.el.shareNote.textContent = `链接已压缩(${length} 字符),接收者打开即可查看。`;
      }
    } catch (e) {
      this.el.shareLink.value = '';
      this.el.shareNote.textContent = '生成失败: ' + e.message;
    }
  }

  // ---------- 思维导图控制 ----------
  _bindMindmapControls() {
    this.el.mmZoomIn.addEventListener('click', (e) => { e.stopPropagation(); this.mindmap?.zoomBy(1.2); });
    this.el.mmZoomOut.addEventListener('click', (e) => { e.stopPropagation(); this.mindmap?.zoomBy(1 / 1.2); });
    this.el.mmZoomFit.addEventListener('click', (e) => { e.stopPropagation(); this.mindmap?.fit(); });
    this.el.mmZoomReset.addEventListener('click', (e) => { e.stopPropagation(); this.mindmap?.resetZoom(); });
    this.el.mmAddChild.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.mindmapCanvas.focus();
      if (this.mindmap?.selectedId) {
        const f = findNode(this.doc.root, this.mindmap.selectedId);
        if (f) this.mindmap._addChild(f.node);
      } else {
        this.toast('请先点击选中一个节点');
      }
    });
    this.el.mmAddSibling.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.mindmapCanvas.focus();
      if (this.mindmap?.selectedId) {
        const f = findNode(this.doc.root, this.mindmap.selectedId);
        if (f?.parent) this.mindmap._addSibling(f.parent, f.index);
        else this.toast('根节点无兄弟');
      } else {
        this.toast('请先点击选中一个节点');
      }
    });
    this.el.mmDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.mindmapCanvas.focus();
      if (this.mindmap?.selectedId) {
        const f = findNode(this.doc.root, this.mindmap.selectedId);
        if (f?.parent) this.mindmap._delete(f.parent, f.index);
        else this.toast('根节点不可删除');
      } else {
        this.toast('请先点击选中一个节点');
      }
    });
    this.el.mmToggleCollapse.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.mindmapCanvas.focus();
      if (this.mindmap?.selectedId) {
        if (!this.mindmap.toggleCollapse(this.mindmap.selectedId)) this.toast('该节点没有子节点');
      } else {
        this.toast('请先点击选中一个节点');
      }
    });
    // 字号选择(slider + number + preset buttons)
    this.el.mmFontSize.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.fontSizePopover.hidden) {
        const rect = this.el.mmFontSize.getBoundingClientRect();
        this.el.fontSizePopover.style.position = 'fixed';
        this.el.fontSizePopover.style.top = (rect.bottom + 6) + 'px';
        this.el.fontSizePopover.style.right = (window.innerWidth - rect.right) + 'px';
        this.el.fontSizePopover.style.left = 'auto';
        this.el.fontSizePopover.hidden = false;
        const f = this.mindmap?.selectedId ? findNode(this.doc.root, this.mindmap.selectedId) : null;
        const cur = this._getNodeFontSize(f?.node);
        this.el.fontSizeRange.value = cur;
        this.el.fontSizeNumber.value = cur;
        this.el.fontSizePopover.querySelectorAll('.font-size-item').forEach((b) => {
          b.classList.toggle('active', parseInt(b.dataset.size) === cur);
        });
      } else {
        this.el.fontSizePopover.hidden = true;
      }
    });
    this.el.fontSizeRange.addEventListener('input', () => {
      this.el.fontSizeNumber.value = this.el.fontSizeRange.value;
      this.mindmap?.applyFontSize(parseInt(this.el.fontSizeRange.value));
    });
    this.el.fontSizeNumber.addEventListener('change', () => {
      const v = Math.max(8, Math.min(72, parseInt(this.el.fontSizeNumber.value) || 14));
      this.el.fontSizeNumber.value = v;
      this.el.fontSizeRange.value = v;
      this.mindmap?.applyFontSize(v);
    });
    this.el.fontSizePopover.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.font-size-item');
      if (!item) return;
      const v = parseInt(item.dataset.size);
      this.el.fontSizeRange.value = v;
      this.el.fontSizeNumber.value = v;
      this.mindmap?.applyFontSize(v);
      this.el.fontSizePopover.querySelectorAll('.font-size-item').forEach((b) => {
        b.classList.toggle('active', parseInt(b.dataset.size) === v);
      });
    });
    // 字体颜色
    this.el.mmFontColor.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.fontColorPopover.hidden) {
        // 缓存当前选区( popover 打开会丢失焦点 )
        this._savedTextSelection = null;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const container = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement : range.startContainer;
          if (container?.closest?.('.node-text')) {
            this._savedTextSelection = {
              range: range.cloneRange(),
              textEl: container.closest('.node-text'),
              nodeId: container.closest('.node-text').dataset.id,
            };
          }
        }
        const rect = this.el.mmFontColor.getBoundingClientRect();
        this.el.fontColorPopover.style.position = 'fixed';
        this.el.fontColorPopover.style.top = (rect.bottom + 6) + 'px';
        this.el.fontColorPopover.style.right = (window.innerWidth - rect.right) + 'px';
        this.el.fontColorPopover.style.left = 'auto';
        this.el.fontColorPopover.hidden = false;
        this._initFontColorGrid();
      } else {
        this.el.fontColorPopover.hidden = true;
      }
    });
    this.el.fontColorApply.addEventListener('click', (e) => {
      e.stopPropagation();
      const hex = this.el.fontColorHex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        this._applyFontColorToSelected(hex);
        this.el.fontColorPopover.hidden = true;
      }
    });
    this.el.fontColorClear.addEventListener('click', (e) => {
      e.stopPropagation();
      this._applyFontColorToSelected(null);
      this.el.fontColorPopover.hidden = true;
    });
    // 背景色(节点)
    this.el.mmColor.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleColorPopover(e, this.el.mmColor);
    });
    this.el.colorHexApply.addEventListener('click', (e) => {
      e.stopPropagation();
      const hex = this.el.colorHexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        // 自定义背景色:用 closest match 或直接应用
        this._applyCustomBgColor(hex);
        this.el.colorPopover.hidden = true;
      }
    });
    // 布局选择
    this.el.mmLayout.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.layoutPopover.hidden) {
        const rect = this.el.mmLayout.getBoundingClientRect();
        this.el.layoutPopover.style.position = 'fixed';
        this.el.layoutPopover.style.top = (rect.bottom + 6) + 'px';
        this.el.layoutPopover.style.right = (window.innerWidth - rect.right) + 'px';
        this.el.layoutPopover.style.left = 'auto';
        this.el.layoutPopover.hidden = false;
        this._syncLayoutActive();
      } else {
        this.el.layoutPopover.hidden = true;
      }
    });
    this.el.layoutPopover.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.layout-item');
      if (!item) return;
      if (item.hasAttribute('data-theme')) {
        const theme = item.dataset.theme || null;
        if (this.doc) {
          this.doc.theme = theme;
          this.mindmap?.render();
          this.mindmap?._applyTransform();
          this._onChange(this.doc, true);
          this._syncLayoutActive();
        }
      } else {
        const layout = item.dataset.layout;
        if (this.mindmap) this.mindmap.setLayout(layout);
        if (this.doc) { this.doc.layout = layout; this._onChange(this.doc, true); }
        this._syncLayoutActive();
      }
      this.el.layoutPopover.hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!this.el.fontSizePopover.hidden && !this.el.fontSizePopover.contains(e.target) && !this.el.mmFontSize.contains(e.target)) {
        this.el.fontSizePopover.hidden = true;
      }
      if (!this.el.fontColorPopover.hidden && !this.el.fontColorPopover.contains(e.target) && !this.el.mmFontColor.contains(e.target)) {
        this.el.fontColorPopover.hidden = true;
      }
      if (!this.el.layoutPopover.hidden && !this.el.layoutPopover.contains(e.target) && !this.el.mmLayout.contains(e.target)) {
        this.el.layoutPopover.hidden = true;
      }
      if (!this.el.colorPopover.hidden && !this.el.colorPopover.contains(e.target) && !this.el.mmColor.contains(e.target)) {
        this._hideColorPopover();
      }
    });
  }

  _updateMindmapStatus() {
    if (!this.el.mmStatus || !this.mindmap || !this.doc) return;
    const n = this.mindmap.countNodes();
    const s = countText(this.doc.root);
    this.el.mmStatus.textContent = `${n} 节点 · ${s.chars} 字符`;
  }

  _updateOutlineStatus() {
    if (!this.el.olStatus || !this.doc) return;
    const s = countText(this.doc.root);
    this.el.olStatus.textContent = `${s.nodes} 节点 · ${s.chars} 字符 · ${s.words} 词`;
  }

  _bindResize() {
    // 视图切换或窗口变化时重绘思维导图
    window.addEventListener('resize', debounce(() => {
      if (this.view === 'mindmap' && this.mindmap) {
        this.mindmap.render();
        this.mindmap._applyTransform();
      }
    }, 150));
  }

  // ---------- 移动端操作条 / 选择模式 ----------
  _bindMobileActions() {
    const act = (fn) => (e) => { e.stopPropagation(); fn(); };
    this.el.actUp.addEventListener('click', act(() => this.outliner?.moveNodeBy(-1)));
    this.el.actDown.addEventListener('click', act(() => this.outliner?.moveNodeBy(1)));
    this.el.actIndent.addEventListener('click', act(() => this.outliner?.indentSelectedMulti()));
    this.el.actOutdent.addEventListener('click', act(() => this.outliner?.outdentSelectedMulti()));
    this.el.actDelete.addEventListener('click', act(() => this.outliner?.deleteSelected()));
    this.el.actColor.addEventListener('click', act(() => this._toggleColorPopover({ stopPropagation: () => {} }, this.el.actColor)));
    this.el.actMulti.addEventListener('click', act(() => this._setSelectionMode(true)));
    this.el.actDone.addEventListener('click', act(() => this._setSelectionMode(false)));
    this.el.mmMulti.addEventListener('click', act(() => this._setSelectionMode(true)));
    this.el.mmMultiDone.addEventListener('click', act(() => this._setSelectionMode(false)));
  }

  /** 切换选择模式(移动端多选),同步大纲/导图与按钮状态 */
  _setSelectionMode(on) {
    this._selectionMode = !!on;
    this.outliner?.setSelectionMode(on);
    this.mindmap?.setSelectionMode(on);
    this.el.actMulti.classList.toggle('active', on);
    this.el.mmMulti.classList.toggle('active', on);
    this.el.actDone.hidden = !on;
    this.el.mmMultiDone.hidden = !on;
    if (on) this.toast('选择模式:点按节点进行多选');
  }

  // ---------- 富文本选区缓存 ----------
  _saveTextSelection() {
    this._savedTextSelection = null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const container = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement : range.startContainer;
    if (!container?.closest?.('.node-text')) return;
    this._savedTextSelection = {
      range: range.cloneRange(),
      textEl: container.closest('.node-text'),
      nodeId: container.closest('.node-text').dataset.id,
    };
  }

  // ---------- 选中集 / 排序 ----------
  _currentSelectedId() {
    if (this.view === 'mindmap' && this.mindmap?.selectedId) return this.mindmap.selectedId;
    return this.outliner?.selectedId || null;
  }

  _currentSelectedIds() {
    if (this.view === 'mindmap' && this.mindmap) return this.mindmap.getSelectedIds();
    return this.outliner?.getSelectedIds() || [];
  }

  _sortSelected(mode, dir) {
    if (!this.doc) return;
    const id = this._currentSelectedId();
    const f = id ? findNode(this.doc.root, id) : null;
    const parent = f ? (f.parent || this.doc.root) : this.doc.root;
    if (!sortSiblings(parent, mode, dir)) { this.toast('同级节点不足'); return; }
    if (this.outliner) { this.outliner._saveFocus(); this.outliner.render(); }
    if (this.mindmap) { this.mindmap.render(); this.mindmap._applyTransform(); }
    this._onChange(this.doc, true);
  }

  // ---------- 聚焦模式 ----------
  _setFocusNode(node) {
    if (!node) return;
    this.outliner?.setViewRoot(node);
    this.mindmap?.setViewRoot(node);
    this.el.focusBar.hidden = false;
    this.el.focusTitle.textContent = (node.text || '未命名').slice(0, 40) + (node.text && node.text.length > 40 ? '…' : '');
    this.switchView(this.view);
  }

  _clearFocus() {
    this.outliner?.setViewRoot(null);
    this.mindmap?.setViewRoot(null);
    this.el.focusBar.hidden = true;
  }

  // ---------- 放映 ----------
  _openPresent() {
    if (!this.doc) return;
    this._presentFlat = flattenVisible(this.doc.root);
    this._presentIndex = 0;
    this.el.presentModal.hidden = false;
    this._renderPresent();
    if (this._presentKeyHandler) document.removeEventListener('keydown', this._presentKeyHandler);
    this._presentKeyHandler = (e) => {
      if (this.el.presentModal.hidden) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') this._closePresent();
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._presentStep(1); }
      else if (e.key === 'ArrowLeft') this._presentStep(-1);
    };
    document.addEventListener('keydown', this._presentKeyHandler);
  }

  _presentStep(delta) {
    if (!this._presentFlat) return;
    this._presentIndex = Math.max(0, Math.min(this._presentFlat.length - 1, this._presentIndex + delta));
    this._renderPresent();
  }

  _renderPresent() {
    const flat = this._presentFlat;
    if (!flat || !flat.length) return;
    const cur = flat[this._presentIndex];
    const frag = document.createDocumentFragment();
    frag.append(el('div', { class: 'p-node lvl0 cur' }, cur.node.text || ' '));
    (cur.node.children || []).forEach((c) => {
      frag.append(el('div', { class: 'p-node lvl1' }, c.text || ' '));
    });
    if (cur.node.note) frag.append(el('div', { class: 'p-note' }, cur.node.note));
    this.el.presentContent.replaceChildren(frag);
  }

  _closePresent() {
    this.el.presentModal.hidden = true;
    this._presentFlat = null;
    if (this._presentKeyHandler) {
      document.removeEventListener('keydown', this._presentKeyHandler);
      this._presentKeyHandler = null;
    }
  }

  // ---------- 搜索 / 替换 ----------
  _openSearch() {
    this.el.searchBar.hidden = false;
    this.el.outlineTree.classList.add('search-open');
    this.el.searchInput.focus();
    this.el.searchInput.select();
    this._doSearch();
  }

  _closeSearch() {
    this.el.searchBar.hidden = true;
    this.el.outlineTree.classList.remove('search-open');
    this.el.searchInput.value = '';
    this.el.searchReplace.value = '';
    if (this.outliner) { this.outliner.setSearchQuery(''); this.outliner.setTagFilter(null); }
    this._renderTagBar();
  }

  _doSearch(keepIndex = false) {
    if (!this.outliner) return;
    const q = this.el.searchInput.value;
    const count = this.outliner.setSearchQuery(q);
    if (count && !keepIndex) this.outliner.goToMatch(0);
    const idx = this.outliner._searchIndex;
    this.el.searchCount.textContent = count ? `${Math.min(idx + 1, count)}/${count}` : (q ? '无匹配' : '');
    this._updateMindmapStatus();
  }

  _searchStep(delta) {
    if (!this.outliner) return;
    const id = delta > 0 ? this.outliner.nextMatch() : this.outliner.prevMatch();
    if (!id) return;
    const i = this.outliner._searchIndex;
    const total = this.outliner._searchMatchIds?.length || 0;
    this.el.searchCount.textContent = total ? `${i + 1}/${total}` : '';
    this._updateOutlineStatus();
  }

  // ---------- 标签过滤 ----------
  _renderTagBar() {
    if (!this.doc || !this.el.tagBar) return;
    const map = new Map();
    const rec = (n) => {
      (n.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1));
      (n.children || []).forEach(rec);
    };
    rec(this.doc.root);
    this.el.outlineTree.classList.toggle('tag-open', !this.el.tagBar.hidden);
    if (!map.size) { this.el.tagBar.hidden = true; this.el.outlineTree.classList.remove('tag-open'); return; }
    this.el.tagBar.hidden = false;
    const active = this._tagFilter;
    this.el.tagBar.replaceChildren(...[...map.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) =>
      el('button', {
        class: 'ol-tag-item' + (t === active ? ' active' : ''),
        dataset: { tag: t },
      }, `#${t} ${c}`)
    ));
    this.el.tagBar.onclick = (e) => {
      const b = e.target.closest('.ol-tag-item');
      if (!b) return;
      const tag = b.dataset.tag;
      this._tagFilter = (this._tagFilter === tag) ? null : tag;
      this.outliner?.setTagFilter(this._tagFilter);
      this._renderTagBar();
    };
  }

  // ---------- 目录 ----------
  _renderToc() {
    if (!this.doc || !this.el.tocList) return;
    const flat = flattenVisible(this.doc.root);
    const active = this._currentSelectedId();
    this.el.tocList.replaceChildren(...flat.map(({ node, depth }) =>
      el('div', {
        class: 'toc-item' + (node.id === active ? ' active' : ''),
        dataset: { id: node.id },
        style: { paddingLeft: (8 + depth * 16) + 'px' },
      }, (node.text || '空节点').slice(0, 40))
    ));
  }

  _revealNode(id) {
    if (this.view === 'mindmap') {
      this.mindmap?.revealNode(id);
    } else {
      this.outliner?.revealNode(id);
    }
  }

  // ---------- Popover 定位 ----------
  _positionPopover(pop, btn) {
    const rect = btn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.right = (window.innerWidth - rect.right) + 'px';
    pop.style.left = 'auto';
    pop.hidden = false;
  }

  _hideAllPopovers() {
    [this.el.fontSizePopover, this.el.fontColorPopover, this.el.layoutPopover, this.el.colorPopover, this.el.sortPopover]
      .forEach((p) => { if (p) p.hidden = true; });
  }

  _syncLayoutActive() {
    const cur = this.doc?.layout || 'right';
    const theme = this.doc?.theme || '';
    this.el.layoutPopover.querySelectorAll('.layout-item').forEach((b) => {
      if (b.hasAttribute('data-theme')) {
        b.classList.toggle('active', (b.dataset.theme || '') === theme);
      } else {
        b.classList.toggle('active', b.dataset.layout === cur);
      }
    });
  }

  // ---------- Toast ----------
  toast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.hidden = false;
    void this.el.toast.offsetWidth;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      this.el.toast.classList.remove('show');
      setTimeout(() => { this.el.toast.hidden = true; }, 200);
    }, 2200);
  }
}

// 启动
const app = new App();
window.__app = app; // 便于调试
