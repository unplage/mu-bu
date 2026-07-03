// app.js — 主控制器
import { Outliner } from './outliner.js';
import { Mindmap } from './mindmap.js';
import * as DB from './db.js';
import * as Export from './export.js';
import * as Share from './share.js';
import { el, COLORS, colorCss, formatDate, debounce, download } from './utils.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.doc = null;
    this.docs = [];
    this.view = 'outline';
    this.outliner = null;
    this.mindmap = null;
    this._saveDebounced = debounce((d) => DB.saveDoc(d), 400);
    this._init();
  }

  async _init() {
    this._cacheEls();
    this._bindToolbar();
    this._bindSidebar();
    this._bindModals();
    this._bindColorPopover();
    this._bindMindmapControls();
    this._bindResize();
    this._initColorGrid();

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
    this.el.colorBtn.addEventListener('click', (e) => this._toggleColorPopover(e));
    this.el.exportBtn.addEventListener('click', () => this._openModal(this.el.exportModal));
    this.el.shareBtn.addEventListener('click', () => this._share());
    this.el.deleteDoc.addEventListener('click', () => this._deleteDoc());
  }

  switchView(view) {
    this.view = view;
    this.el.viewOutline.classList.toggle('active', view === 'outline');
    this.el.viewMindmap.classList.toggle('active', view === 'mindmap');
    this.el.outlineView.hidden = view !== 'outline';
    this.el.mindmapView.hidden = view !== 'mindmap';
    if (view === 'mindmap' && this.mindmap) {
      this.mindmap.setDoc(this.doc);
    }
  }

  // ---------- 侧边栏 ----------
  _bindSidebar() {
    this.el.newDoc.addEventListener('click', () => this.newDoc());
    this.el.openSidebar.addEventListener('click', () => this.el.sidebar.classList.add('open'));
    this.el.closeSidebar.addEventListener('click', () => this.el.sidebar.classList.remove('open'));
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
  }

  async openDoc(id) {
    const doc = await DB.getDoc(id);
    if (!doc) return;
    this.doc = doc;
    this._afterDocLoad();
    this.el.sidebar.classList.remove('open');
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
        docs = Export.importJSON(text);
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

  _afterDocLoad(readonly = false) {
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
    this.switchView(this.view);
    this._renderDocList();
  }

  _onChange(doc, persist) {
    this.doc = doc;
    if (persist) {
      DB.saveDoc(doc).then(() => this.refreshDocs());
    } else {
      this._saveDebounced(doc);
    }
    // 思维导图同步(若当前在思维导图视图且非编辑触发)
    if (this.view === 'mindmap' && this.mindmap && !this.mindmap.editingId) {
      this.mindmap.setDoc(doc);
    }
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
    document.addEventListener('click', (e) => {
      if (!this.el.colorPopover.hidden && !this.el.colorPopover.contains(e.target) && e.target !== this.el.colorBtn) {
        this._hideColorPopover();
      }
    });
  }

  /** 统一配色:根据当前视图取选中节点 id,更新 model 并同步两个视图 */
  _applyColorToSelected(colorKey) {
    let id = null;
    if (this.view === 'mindmap' && this.mindmap?.lastClickedId) {
      id = this.mindmap.lastClickedId;
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
    DB.saveDoc(this.doc).then(() => this.refreshDocs());
  }

  _toggleColorPopover(e) {
    if (this.el.colorPopover.hidden) {
      const rect = this.el.colorBtn.getBoundingClientRect();
      this.el.colorPopover.style.top = (rect.bottom + 6) + 'px';
      this.el.colorPopover.style.left = (rect.left - 90) + 'px';
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
  _selectedColor() {
    let id = null;
    if (this.view === 'mindmap' && this.mindmap?.lastClickedId) {
      id = this.mindmap.lastClickedId;
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

  _openModal(modal) { modal.hidden = false; }

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
    // 确保思维导图已渲染
    const wasOutline = this.view === 'outline';
    if (wasOutline) this.switchView('mindmap');
    await new Promise((r) => requestAnimationFrame(r));
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
      this.el.shareLink.value = link;
      if (length > limit * 0.85) {
        this.el.shareNote.textContent = '⚠ 文档较大,接近链接长度上限。建议改用「下载 .mubu 文件分享」。';
      } else {
        this.el.shareNote.textContent = `链接已压缩(${length} 字符),接收者打开即可查看。`;
      }
    } catch (e) {
      this.el.shareLink.value = '';
      this.el.shareNote.textContent = '生成失败: ' + e.message;
    }
  }

  // ---------- 思维导图控制 ----------
  _bindMindmapControls() {
    this.el.mmZoomIn.addEventListener('click', () => this.mindmap?.zoomBy(1.2));
    this.el.mmZoomOut.addEventListener('click', () => this.mindmap?.zoomBy(1 / 1.2));
    this.el.mmZoomFit.addEventListener('click', () => this.mindmap?.fit());
    this.el.mmZoomReset.addEventListener('click', () => this.mindmap?.resetZoom());
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

  // ---------- Service Worker ----------
  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 注册失败', e));
    }
  }

  // ---------- Toast ----------
  toast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.hidden = false;
    requestAnimationFrame(() => this.el.toast.classList.add('show'));
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
