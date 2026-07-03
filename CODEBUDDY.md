# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## 项目概述

Mubu-Lite 是一款幕布风格的 PWA 思维导图与大纲编辑器,纯前端零依赖(无框架、无构建),数据存于浏览器 IndexedDB,可离线使用,最终部署到 GitHub Pages。

## 常用命令

```bash
# 启动本地静态服务器(开发用,SW 与 ES Modules 要求 HTTP(S))
python3 -m http.server 8765

# 语法检查所有 JS
for f in js/*.js sw.js; do node --check "$f"; done

# 运行测试(三个测试文件相互独立)
node test-core.mjs        # 核心纯逻辑:树操作、导入导出、分享编解码
node test-dom.mjs         # 大纲视图 DOM 集成(依赖 linkedom)
node test-mindmap.mjs     # 思维导图渲染(依赖 linkedom)

# 安装 DOM 测试依赖(linkedom)
cd /tmp && npm install linkedom --no-save
```

测试文件中 `test-dom.mjs` 和 `test-mindmap.mjs` 通过 `import` 从 `/tmp/node_modules/linkedom/cjs/index.js` 加载 DOM polyfill,路径硬编码,如需改环境请注意。

## 架构

### 模块划分(全部 ES Modules,无打包)

- `js/app.js` — 主控制器。实例化 Outliner 与 Mindmap,绑定工具栏/侧边栏/模态框/配色浮层,处理文档列表、视图切换、导入导出触发、分享生成。所有 DOM 事件入口在此。
- `js/tree.js` — **纯函数**模块,操作文档树结构(遍历、查找、增删移、缩进/减少缩进)。不依赖 DOM,可独立测试。节点结构:`{id, text, note, color, collapsed, children:[]}`。
- `js/outliner.js` — 大纲视图类 `Outliner`。渲染扁平可见节点列表,处理键盘交互(Enter/Tab/Backspace/方向键/Alt 移动)、拖拽排序、配色。维护 `selectedId` 与焦点恢复(`_focusId`/`_focusOffset`)。
- `js/mindmap.js` — 思维导图类 `Mindmap`。SVG 渲染:先 `measureNode` 估算宽度,`layoutHeight` 计算子树高度,`assignPos` 分配坐标。支持滚轮缩放(以鼠标为中心)、拖拽平移、点击编辑(foreignObject + input)、Shift+点击折叠。
- `js/db.js` — IndexedDB 封装。单 store `docs`,keyPath `id`。`createDoc`/`createNode` 为工厂函数。
- `js/export.js` — 导入导出。JSON/Markdown/OPML/TXT 文本类,PNG/SVG 基于 `mindmapCanvas` 内的 SVG 元素序列化。OPML 导入用 `DOMParser`。
- `js/share.js` — 分享链接。`encodeShare` 用 `CompressionStream('gzip')` 压缩精简 JSON,再 `base64urlEncode` 写入 URL hash;`decodeShare` 逆向。精简字段名(`t`/`r`/`x`/`c`/`k`/`h`)以缩短链接。
- `js/utils.js` — `uid`、`debounce`、`el`(DOM 工厂)、`download`、`escapeHtml`、`base64url` 编解码、`gzipCompress`/`Decompress`、`COLORS` 调色板(使用真实十六进制值,确保 SVG fill/stroke 属性可用)。

### 数据流

1. 用户编辑大纲 → Outliner 直接修改 `doc` 模型 → 调 `onChange(doc, persist)`
2. `app._onChange` 调 `DB.saveDoc`(persist=true 立即存,否则防抖 400ms)→ 同步思维导图(若可见)
3. 思维导图编辑提交 → `onChange` → `DB.saveDoc`

### 关键设计点

- **树操作契约**:`tree.moveNode(srcParent, srcIndex, targetParent, targetIndex)` 的 `targetIndex` 是节点在*最终*数组中的索引(已扣除 src 移除造成的位置偏移)。调用方需自行计算偏移(见 `outliner.js` 拖拽 `_onDrop` 的 `sameParent && src.index < idx` 处理)。
- **配色与 SVG**:SVG 的 presentation attribute(如 `<rect fill="...">`)不支持 CSS 变量 `var(--x)`,因此 `COLORS` 必须使用真实十六进制值,不能用 `var(--c-red)`。
- **焦点恢复**:Outliner 重渲染后会丢失 contenteditable 焦点,通过 `_saveFocus`(记录节点 id + caret offset)+ `_restoreFocus`(`setCaret` 遍历子节点定位)恢复。任何触发 `render()` 的操作前都应调用 `_saveFocus()`。
- **PWA**:`sw.js` 缓存优先 + 后台更新策略;`manifest.json` 用相对路径 `./`;导航请求失败回退 `index.html`。
- **多视图配色统一**:`app._applyColorToSelected` 根据当前视图取选中 id(大纲用 `outliner.selectedId`,思维导图用 `mindmap.lastClickedId`),统一修改 model 并同步两个视图。

## 部署

GitHub Pages:Settings → Pages → Source 选 `main` / `/root`。全相对路径,无需配置 base。

## 已知限制

- 分享链接受 URL 长度限制(~12000 字符),超长文档建议用文件分享。
- `CompressionStream` 需 Chrome 80+/Firefox 113+/Safari 16.4+,旧浏览器分享功能会报错(已 try/catch)。
- contenteditable 的换行行为因浏览器而异,本应用阻止 Enter 默认(用于创建兄弟),多行文本仅来自导入,渲染时 `\n` ↔ `<br>` 互转。
