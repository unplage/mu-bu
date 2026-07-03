# Mubu-Lite

幕布风格的 PWA 思维导图与大纲编辑器。纯前端、零依赖、可离线使用,数据存储在浏览器本地(IndexedDB)。适合个人记录笔记、整理思路、绘制思维导图。

## 功能特性

- **大纲视图**:层级列表编辑,支持快捷键(Tab 缩进、Enter 新建兄弟、方向键导航、Alt+方向键移动、Ctrl+Backspace 删除)
- **思维导图视图**:SVG 树形布局,支持缩放(滚轮/按钮)、平移(拖拽)、点击编辑、Shift+点击折叠
- **节点配色**:8 种颜色高亮,可在任一视图操作
- **本地存储**:基于 IndexedDB,支持多文档管理,自动保存
- **导入导出**:
  - 导出:JSON(完整备份)、Markdown、OPML、纯文本、PNG 图片、SVG 矢量图
  - 导入:JSON、OPML(兼容其它大纲工具如 WorkFlowy、Dynalist)
- **分享**:生成压缩只读链接(数据写入 URL hash,无需服务器),或下载 .mubu(JSON)文件分享
- **PWA**:可安装到桌面/手机主屏,支持离线访问
- **响应式**:适配桌面与移动端

## 本地开发

无需构建,纯静态文件。用任意静态服务器即可:

```bash
# Python
python3 -m http.server 8765

# 或 Node
npx serve .
```

浏览器访问 http://localhost:8765

> 注意:Service Worker 与 ES Modules 要求通过 HTTP(S) 访问,不能直接用 `file://` 打开。

## 测试

核心逻辑(树操作、导入导出、分享编解码)与 DOM 渲染测试:

```bash
node test-core.mjs        # 核心纯逻辑(50 项)
node test-dom.mjs         # 大纲视图 DOM 集成(29 项,需 linkedom)
node test-mindmap.mjs     # 思维导图渲染(12 项,需 linkedom)
```

DOM 测试依赖 `linkedom`,安装:

```bash
cd /tmp && npm install linkedom --no-save
```

## 部署到 GitHub Pages

1. 将仓库推送到 GitHub
2. 仓库 Settings → Pages → Source 选 `main` 分支 `/root`
3. 访问 `https://<用户名>.github.io/<仓库名>/`

由于使用相对路径(`./`),无需额外配置 base。

## 项目结构

```
mubu/
├── index.html              # 应用入口
├── manifest.json           # PWA 清单
├── sw.js                   # Service Worker(缓存优先)
├── css/style.css           # 全部样式
├── icons/
│   ├── icon.svg            # 矢量图标
│   ├── icon-192.png        # PWA 图标
│   └── icon-512.png
├── js/
│   ├── app.js              # 主控制器:串联各模块、工具栏、模态框
│   ├── utils.js            # 通用工具(id、防抖、DOM、base64、gzip、颜色调色板)
│   ├── db.js               # IndexedDB 封装(多文档 CRUD)
│   ├── tree.js             # 树结构纯函数(遍历、增删移、缩进)
│   ├── outliner.js         # 大纲视图:渲染、键盘交互、拖拽、配色
│   ├── mindmap.js          # 思维导图:SVG 布局、缩放平移、编辑
│   ├── export.js           # 导入导出(JSON/MD/OPML/TXT/PNG/SVG)
│   └── share.js            # 分享链接(gzip+base64url 压缩编码)
├── test-core.mjs           # 核心逻辑测试
├── test-dom.mjs            # DOM 集成测试
└── test-mindmap.mjs        # 思维导图测试
```

## 数据模型

文档结构:

```js
{
  id: 'doc_xxx',
  title: '文档标题',
  createdAt: 1690000000000,
  updatedAt: 1690000000000,
  root: {
    id: 'n_xxx',
    text: '节点文本',
    note: '',           // 预留:节点备注
    color: null,        // null | 'red'|'orange'|'yellow'|'green'|'cyan'|'blue'|'purple'|'pink'
    collapsed: false,
    children: [ /* 递归 */ ]
  }
}
```

## 快捷键

| 键 | 大纲视图行为 |
|---|---|
| `Enter` | 创建兄弟节点(光标处分割文本) |
| `Tab` / `Shift+Tab` | 缩进 / 减少缩进 |
| `Backspace`(空节点) | 删除节点,焦点回到上一节点 |
| `Ctrl/Cmd+Backspace` | 删除非空节点 |
| `Alt+↑` / `Alt+↓` | 上移 / 下移节点 |
| `↑` / `↓`(光标在端点) | 在可见节点间跳转 |
| `Ctrl/Cmd+/` | 折叠 / 展开当前节点 |
| 点击 bullet | 折叠 / 展开 |

思维导图:滚轮缩放、拖拽平移、点击节点编辑、Shift+点击折叠。

## 技术说明

- **零依赖**:不使用任何前端框架或构建工具,原生 ES Modules
- **存储**:IndexedDB(异步、容量大),非 localStorage
- **分享**:利用浏览器原生 `CompressionStream`(gzip)+ base64url 编码,将文档压缩写入 URL hash,接收者打开即可查看
- **思维导图**:SVG 渲染,导出 PNG 通过 `Image` + `canvas` 转换,导出 SVG 直接序列化
