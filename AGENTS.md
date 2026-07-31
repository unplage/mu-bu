# AGENTS.md — mubu

幕布风格的大纲 + 思维导图工具，仓库内有两套并行实现：

- **Mubu-Lite（主项目）**：纯前端 PWA，零依赖、无框架、无构建，原生 ES Modules，数据存 IndexedDB。入口 `index.html`，代码在 `js/`。
- **PyQt5 桌面版（旁支）**：`mubu-pyqt5.py`（上游自带）与 `mubu.py`（本地副本，两者字节级一致）。改桌面版时需同步修改两份文件。

## 快速开始（Web 版）

```bash
python3 -m http.server 8765   # 访问 http://localhost:8765
```

不能用 `file://` 打开（Service Worker 与 ES Modules 要求 HTTP(S)）。无 package.json、无构建步骤。

## 测试

```bash
node test-core.mjs        # 核心纯逻辑（树操作/导入导出/分享编解码），无依赖，50 项
node test-dom.mjs         # 大纲视图 DOM 集成，29 项
node test-mindmap.mjs     # 思维导图渲染，33 项
```

- `test-dom.mjs` / `test-mindmap.mjs` **硬编码** `import '/tmp/node_modules/linkedom/cjs/index.js'`，需先 `cd /tmp && npm install linkedom --no-save`。
- DOM 测试中 Selection/Range/navigator 等全局是手动 mock 的（linkedom 不完整），改测试时保持该模式。
- 语法检查：`for f in js/*.js sw.js; do node --check "$f"; done`

## 架构（Web 版）

- `js/app.js` 主控制器：所有 DOM 事件入口，串联视图、工具栏、模态框、导入导出、分享。
- `js/tree.js` 是唯一纯函数模块（树遍历/增删移/缩进），不依赖 DOM，可独立测试；其余模块直接操作 DOM。
- `js/mindmap.js` 用 SVG 渲染（`measureNode`→`layoutHeight`→`assignPos`），PNG 导出经 canvas 转换。
- `js/share.js` 用 `CompressionStream('gzip')` + base64url 把文档压进 URL hash，约 12000 字符上限；旧浏览器会报错（已 try/catch）。
- 数据模型：`doc = {id, title, createdAt, updatedAt, root: {id, text, note, color, collapsed, children:[]}}`；IndexedDB 单 store `docs`，keyPath `id`。
- 数据流：视图直接改 doc → `onChange(doc, persist)` → `app._onChange` → `DB.saveDoc`（persist=true 立即存，否则防抖 400ms）→ 同步另一视图。
- 部署：GitHub Pages，全相对路径（`./`），无需配 base。

## 关键设计点

- `tree.moveNode(srcParent, srcIndex, targetParent, targetIndex)` 的 `targetIndex` 是节点在**最终数组**中的索引（已扣除 src 移除偏移），调用方需自行补偿（见 `outliner.js` 拖拽 `_onDrop`）。
- 大纲是**虚拟化渲染**：行数 >200 且容器有布局时只渲染视口窗口（`_heights` 缓存行高 + `vt-spacer` 占位），`_focusId` 行强制渲染并滚动入视口；输入处理只改模型不重渲染。改渲染逻辑时保持该结构。
- 中文输入法：所有结构快捷键（Enter/Tab/Backspace 等）必须带 `e.isComposing || e.keyCode === 229` 守卫，否则输入法选词会上屏误触。
- 防抖保存（`app._saveDebounced`）有 `flush()`；页面隐藏/关闭时 `app._init` 内注册的 pagehide/visibilitychange 会冲刷，保存失败走 `_persist` 的 toast 提示，勿静默。
- SVG presentation attribute（如 `<rect fill>`）不支持 CSS 变量，`COLORS` 必须用真实十六进制值，不能 `var(--c-red)`。
- Outliner 每次 `render()` 后 contenteditable 焦点丢失：操作前先 `_saveFocus()`（节点 id + caret offset），再用 `_restoreFocus()` 恢复。
- 配色统一走 `app._applyColorToSelected`：按当前视图取选中 id（大纲 `outliner.selectedId`，导图 `mindmap.lastClickedId`）。
- 导图选中是**增量更新**（`_select`/`_syncSelectionAttrs` 只改边框属性，不整图重绘）；结构变更才 `render()`。
- PWA：`sw.js` 缓存优先 + 后台更新，导航失败回退 `./index.html`；改 JS 必须同步 bump `VERSION`。
- `mubu.html` 与 `index.html` 仅标题不同（重复入口），`sw.js` 只引用后者。

## PyQt5 桌面版

- 依赖 PyQt5（`pip install -r requirements.txt`），启动 `python3 mubu.py`。
- 数据模型 `MubuNode` 双向树（parent + children），UUID 标识；布局在 `compute_layout(node, fm, layout_name)`（QFontMetrics 量尺寸），`LAYOUTS` 定义 4 种布局。
- 大纲 `OutlineWidget`（QTreeWidget）+ 导图 `MindmapView`（QGraphicsView），`QStackedWidget` 切换；`STYLESHEET` 是全局 QSS。
- 快捷键：Insert 加子、Enter 加同级、Delete 删除、Tab/Shift+Tab 缩进、Ctrl+1/2 切换视图。
- 无测试框架；验证用 offscreen 冒烟：

```bash
python3 -c "
import sys, os
os.environ['QT_QPA_PLATFORM'] = 'offscreen'
from PyQt5.QtWidgets import QApplication
app = QApplication(sys.argv)
from mubu import MubuNode, count_nodes, compute_layout, LAYOUTS
root = MubuNode('X'); root.add_child('A')
fm = app.fontMetrics()
for name in LAYOUTS:
    print(name, len(compute_layout(root, fm, name)), 'nodes')
"
```
