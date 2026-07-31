// app.js — 主控制器
import { Outliner } from './outliner.js';
import { Mindmap } from './mindmap.js';
import * as DB from './db.js';
import * as Export from './export.js';
import * as Share from './share.js';
import { el, COLORS, formatDate, debounce, isMobile } from './utils.js';
import { findNode } from './tree.js';

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
    this._bindResize();
    this._initColorGrid();
    this.el.mmHint.textContent = isMobile
      ? '双击编辑 · 双指缩放 · 拖拽平移 · 单击选中'
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
      colorBtn: $('#colorBtn'),
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
    this.el.colorBtn.addEventListener('click', (e) => this._toggleColorPopover(e, this.el.colorBtn));
    this.el.exportBtn.addEventListener('click', () => this.el.exportModal.hidden = false);
    this.el.shareBtn.addEventListener('click', () => this._share());
    this.el.deleteDoc.addEventListener('click', () => this._deleteDoc());
    this.el.undoBtn.addEventListener('click', () => this._undo());
    this.el.redoBtn.addEventListener('click', () => this._redo());
    this.el.indentBtn.addEventListener('click', () => { if (this.outliner) this.outliner.indentSelected(); });
    this.el.outdentBtn.addEventListener('click', () => { if (this.outliner) this.outliner.outdentSelected(); });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this._redo(); else this._undo();
      }
    });
  }

  switchView(view) {
    this.view = view;
    this.el.viewOutline.classList.toggle('active', view === 'outline');
    this.el.viewMindmap.classList.toggle('active', view === 'mindmap');
    this.el.outlineView.hidden = view !== 'outline';
    this.el.mindmapView.hidden = view !== 'mindmap';
    // 切换到的视图同步最新 doc(双向同步)
    if (view === 'mindmap' && this.mindmap) {
      this.mindmap.setDoc(this.doc);
      this._updateMindmapStatus();
      requestAnimationFrame(() => this.el.mindmapCanvas.focus());
    } else if (view === 'outline' && this.outliner) {
      this.outliner.setDoc(this.doc);
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
    this.el.colorBtn.disabled = false;
    if (!this.outliner) {
      this.outliner = new Outliner(this.el.outlineTree, this.doc, (d, persist) => this._onChange(d, persist));
    } else {
      this.outliner.setDoc(this.doc);
    }
    if (!this.mindmap) {
      this.mindmap = new Mindmap(this.el.mindmapCanvas, this.doc, (d, persist) => this._onChange(d, persist));
    } else {
      this.mindmap.setDoc(this.doc);
    }
    if (!noPushHistory) {
      this.history = [JSON.stringify(this.doc.root)];
      this.redoStack = [];
    }
    this._updateUndoRedo();
    this.switchView(this.view);
    this._renderDocList();
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
    // 当前视图的非编辑组件同步模型(避免切回时丢失改动)
    if (this.view === 'mindmap' && this.mindmap && !this.mindmap.editingId) {
      this.mindmap.setDoc(doc);
    }
    if (this.view === 'outline' && this.outliner) {
      // 大纲正在编辑时不重渲染(避免光标跳),仅更新 doc 引用
      this.outliner.doc = doc;
    }
    this._updateMindmapStatus();
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

  /** 统一配色:根据当前视图取选中节点 id,更新 model 并同步两个视图 */
  _applyColorToSelected(colorKey) {
    let id = null;
    if (this.view === 'mindmap' && this.mindmap?.selectedId) {
      id = this.mindmap.selectedId;
    } else if (this.outliner?.selectedId) {
      id = this.outliner.selectedId;
    }
    if (!id) return;
    const node = this._findNode(this.doc.root, id);
    if (!node) return;
    node.color = colorKey || null;
    // 大纲重渲染(保持焦点)
    if (this.outliner) {
      this.outliner._saveFocus();
      this.outliner.render();
    }
    // 思维导图重绘
    if (this.view === 'mindmap' && this.mindmap) {
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
      // 若有文本选区,逐字着色;否则节点级
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        this.outliner.applySelectionColor(hex);
      } else {
        this.outliner.applyFontColor(hex);
      }
    }
  }

  /** 应用自定义背景色(直接设 hex,不走 COLORS 预设) */
  _applyCustomBgColor(hex) {
    let id = null;
    if (this.view === 'mindmap' && this.mindmap?.selectedId) id = this.mindmap.selectedId;
    else if (this.outliner?.selectedId) id = this.outliner.selectedId;
    if (!id) return;
    const node = this._findNode(this.doc.root, id);
    if (!node) return;
    // 直接用 hex 作为 color 值(不走 key 映射)
    node.color = hex;
    if (this.outliner) { this.outliner._saveFocus(); this.outliner.render(); }
    if (this.view === 'mindmap' && this.mindmap) { this.mindmap.render(); this.mindmap._applyTransform(); }
    this._onChange(this.doc, true);
  }
  _selectedColor() {
    let id = null;
    if (this.view === 'mindmap' && this.mindmap?.selectedId) {
      id = this.mindmap.selectedId;
    } else if (this.outliner?.selectedId) {
      id = this.outliner.selectedId;
    }
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
      navigator.clipboard.writeText(this.el.shareLink.value).then(() => this.toast('已复制链接'));
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
        const cur = this.doc?.layout || 'right';
        this.el.layoutPopover.querySelectorAll('.layout-item').forEach((b) => {
          b.classList.toggle('active', b.dataset.layout === cur);
        });
      } else {
        this.el.layoutPopover.hidden = true;
      }
    });
    this.el.layoutPopover.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.layout-item');
      if (!item) return;
      const layout = item.dataset.layout;
      if (this.mindmap) this.mindmap.setLayout(layout);
      if (this.doc) { this.doc.layout = layout; this._onChange(this.doc, true); }
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
      if (!this.el.colorPopover.hidden && !this.el.colorPopover.contains(e.target) && !this.el.colorBtn.contains(e.target) && !this.el.mmColor.contains(e.target)) {
        this._hideColorPopover();
      }
    });
  }

  _updateMindmapStatus() {
    if (this.el.mmStatus && this.mindmap) {
      const n = this.mindmap.countNodes();
      this.el.mmStatus.textContent = `${n} 节点`;
    }
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
