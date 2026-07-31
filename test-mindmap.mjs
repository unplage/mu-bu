// test-mindmap.mjs — 思维导图渲染测试
import { parseHTML } from '/tmp/node_modules/linkedom/cjs/index.js';
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.getSelection = () => ({ rangeCount: 0 });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { register: async () => {} } }, configurable: true });

const { Mindmap } = await import('./js/mindmap.js');
const { createDoc, createNode } = await import('./js/db.js');
const Tree = await import('./js/tree.js');

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } }

console.log('--- Mindmap 渲染 ---');
{
  const doc = createDoc('测试');
  doc.root.text = '根';
  doc.root.children.push(createNode('子A'));
  doc.root.children.push(createNode('子B'));
  doc.root.children[0].children.push(createNode('孙1'));
  doc.root.children[0].children.push(createNode('孙2'));

  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();

  const svg = container.querySelector('svg');
  assert(svg !== null, '生成 SVG 元素');
  const nodes = container.querySelectorAll('.mm-node');
  assert(nodes.length === 5, '渲染 5 个节点, got ' + nodes.length);
  const edges = container.querySelectorAll('.mm-edge');
  assert(edges.length === 4, '4 条连线(root→A, root→B, A→孙1, A→孙2), got ' + edges.length);
  // 验证 edge path 不含 NaN(之前的 bug:from.w 为 undefined)
  for (let i = 0; i < edges.length; i++) {
    const d = edges[i].getAttribute('d');
    assert(d && !d.includes('NaN'), `edge[${i}] d 属性无 NaN: ${d}`);
  }
  // 验证 edge stroke 颜色有效
  assert(edges[0].getAttribute('stroke'), 'edge[0] 有 stroke 属性');
}

console.log('--- Mindmap 折叠子节点 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].children.push(createNode('A1'));
  doc.root.children[0].children.push(createNode('A2'));
  doc.root.children[0].collapsed = true;

  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();

  const nodes = container.querySelectorAll('.mm-node');
  assert(nodes.length === 2, '折叠 A 后只渲染 root+A, got ' + nodes.length);
  // 折叠标记
  const badge = container.querySelectorAll('circle');
  // mm-node-rect 也是 circle? 不,rect。badge 是 circle。但节点没有 circle,只有折叠标记。
  // root 无折叠标记(没 collapsed),A 有折叠标记
  assert(badge.length >= 1, 'A 显示折叠标记(+号)');
}

console.log('--- Mindmap 节点颜色 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.color = 'red';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].color = 'blue';

  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = null; // 清空选中态,避免选中边框覆盖颜色边框
  mm.render();

  const rects = container.querySelectorAll('.mm-node-rect');
  assert(rects.length === 2, '2 个 rect');
  // root rect fill 应为 shade('red') = '#fbe7e6'
  assert(rects[0].getAttribute('fill') === '#fbe7e6', 'root rect 红色填充, got ' + rects[0].getAttribute('fill'));
  // A rect fill 应为 shade('blue') = '#e8f1fe'
  assert(rects[1].getAttribute('fill') === '#e8f1fe', 'A rect 蓝色填充, got ' + rects[1].getAttribute('fill'));
  // root stroke 应为 colorCss('red') = '#ef6f6c'
  assert(rects[0].getAttribute('stroke') === '#ef6f6c', 'root stroke 红色, got ' + rects[0].getAttribute('stroke'));
}

console.log('--- Mindmap 缩放/平移 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();

  mm.zoomBy(1.5);
  assert(mm.scale === 1.5, '缩放 1.5, got ' + mm.scale);
  mm.zoomBy(1 / 1.5);
  assert(Math.abs(mm.scale - 1) < 0.01, '缩放回 1');
  mm.resetZoom();
  assert(mm.scale === 1, 'reset');
}

console.log('--- Mindmap 添加/删除节点 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  assert(mm.countNodes() === 1, '初始 1 节点');

  // 选中 root,添加子节点
  mm.selectedId = doc.root.id;
  mm._addChild(doc.root);
  assert(doc.root.children.length === 1, '添加 1 个子节点');
  assert(mm.countNodes() === 2, '现在 2 节点');
  assert(mm.selectedId === doc.root.children[0].id, '新节点被选中');
  assert(doc.root.children[0].text === '新节点', '新节点文本正确');

  // 添加兄弟
  const firstChild = doc.root.children[0];
  mm._addSibling(doc.root, 0);
  assert(doc.root.children.length === 2, '添加兄弟后 2 个子节点');

  // 删除
  mm._delete(doc.root, 1);
  assert(doc.root.children.length === 1, '删除后剩 1 个子节点');
}

console.log('--- Mindmap 字号 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = doc.root.children[0].id;
  mm.applyFontSize('L');
  assert(doc.root.children[0].fontSize === 18, 'A 字号设为 18');
  const textsL = container.querySelectorAll('.mm-node-text');
  assert(textsL[1].getAttribute('font-size') === '18', 'applyFontSize 后立即重绘,A 字号 18px, got ' + textsL[1].getAttribute('font-size'));
  const rectsL = container.querySelectorAll('.mm-node-rect');
  assert(rectsL[1].getAttribute('stroke-width') === '3', '重绘后 A 仍保持选中态');
  mm.applyFontSize('S');
  assert(doc.root.children[0].fontSize === 12, 'A 字号设为 12');
  const textsS = container.querySelectorAll('.mm-node-text');
  assert(textsS[1].getAttribute('font-size') === '12', 'applyFontSize 后立即重绘,A 字号 12px, got ' + textsS[1].getAttribute('font-size'));
}

console.log('--- Mindmap 布局字段不污染文档模型 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].children.push(createNode('A1'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const check = (node, label) => {
    assert(node.x === undefined && node.y === undefined, label + ' 无 x/y');
    assert(node._w === undefined && node._h === undefined && node._lines === undefined && node._sh === undefined, label + ' 无测量字段');
  };
  check(doc.root, 'root');
  check(doc.root.children[0], 'A');
  check(doc.root.children[0].children[0], 'A1');
}

console.log('--- Mindmap 选中态边框 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = doc.root.children[0].id;
  mm.render();
  const rects = container.querySelectorAll('.mm-node-rect');
  // A 是第二个节点(index 1),被选中,stroke 应为 #4f8cf0 宽 3
  assert(rects[1].getAttribute('stroke') === '#4f8cf0', '选中节点蓝色边框');
  assert(rects[1].getAttribute('stroke-width') === '3', '选中节点边框宽 3');
  // root 未选中,边框宽 2
  assert(rects[0].getAttribute('stroke-width') === '2', '未选中 root 边框宽 2');
}

console.log('--- Mindmap 节点高度自适应 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  // 短文本节点
  doc.root.children.push(createNode('短'));
  // 长文本节点(应换行,高度增大)
  doc.root.children.push(createNode('这是一个非常非常长的节点文本内容应该会自动换行并增加节点高度'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const rects = container.querySelectorAll('.mm-node-rect');
  const shortH = parseFloat(rects[1].getAttribute('height'));
  const longH = parseFloat(rects[2].getAttribute('height'));
  assert(shortH > 0, '短节点高度 > 0: ' + shortH);
  assert(longH > shortH, '长节点高度 > 短节点高度 (' + longH + ' > ' + shortH + ')');
}

console.log('--- Mindmap 字号影响节点尺寸 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('同文本'));
  doc.root.children[0].fontSize = 'S';
  doc.root.children.push(createNode('同文本'));
  doc.root.children[1].fontSize = 'L';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = null;
  mm.render();
  const rects = container.querySelectorAll('.mm-node-rect');
  const smallH = parseFloat(rects[1].getAttribute('height'));
  const largeH = parseFloat(rects[2].getAttribute('height'));
  assert(largeH > smallH, '大字号节点更高 (' + largeH + ' > ' + smallH + ')');
  // 宽度也应不同
  const smallW = parseFloat(rects[1].getAttribute('width'));
  const largeW = parseFloat(rects[2].getAttribute('width'));
  assert(largeW >= smallW, '大字号节点宽度 >= 小字号 (' + largeW + ' >= ' + smallW + ')');
}

console.log('--- Mindmap 多布局 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  for (let i = 0; i < 3; i++) {
    const c = createNode('子' + i);
    c.children.push(createNode('孙'));
    doc.root.children.push(c);
  }
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  const pos = (id) => {
    const g = container.querySelector('.mm-node[data-id="' + id + '"]');
    const t = g.getAttribute('transform');
    const m = t.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  };
  const rectW = (id) => parseFloat(container.querySelector('.mm-node[data-id="' + id + '"] .mm-node-rect').getAttribute('width'));

  // 向右(默认)
  mm.render();
  const r0 = pos(doc.root.id);
  assert(r0.x === 0, '向右布局 root x=0');
  assert(pos(doc.root.children[0].id).x >= rectW(doc.root.id) + 49, '向右布局子节点在父右侧');
  const rightEdges = container.querySelectorAll('.mm-edge');
  assert(rightEdges[0].getAttribute('d').startsWith('M'), '向右布局连线有效');

  // 向下
  mm.setLayout('down');
  assert(doc.root.children.length === 3, '向下布局渲染 3 个子节点');
  const rY = pos(doc.root.id);
  const c0Y = pos(doc.root.children[0].id);
  const c1Y = pos(doc.root.children[1].id);
  assert(c0Y.y > rY.y, '向下布局子节点 y > 父 y (' + c0Y.y + ' > ' + rY.y + ')');
  assert(c0Y.x !== c1Y.x, '向下布局兄弟横向排开 (' + c0Y.x + ' != ' + c1Y.x + ')');
  // 连线应为垂直贝塞尔
  const downEdges = container.querySelectorAll('.mm-edge');
  assert(downEdges[0].getAttribute('d').includes('C'), '向下布局连线含贝塞尔');

  // 径向
  mm.setLayout('radial');
  const rR = pos(doc.root.id);
  // root 在原点附近(允许节点宽度/2的偏移)
  const rW = rectW(doc.root.id);
  assert(Math.abs(rR.x + rW / 2) < 5 && Math.abs(rR.y) < 30, '径向布局 root 中心在原点附近, got (' + rR.x + ',' + rR.y + ')');
  const c0R = pos(doc.root.children[0].id);
  assert(Math.hypot(c0R.x, c0R.y) > 40, '径向布局子节点离中心 > 40');
  // 连线应为斜向
  const radEdges = container.querySelectorAll('.mm-edge');
  assert(radEdges[0].getAttribute('d').includes('C'), '径向布局连线含贝塞尔');

  // 左右交错:子节点在父节点两侧(side=0自动分配)
  mm.setLayout('leftright');
  const rootX = pos(doc.root.id).x;
  const xs = doc.root.children.map((c) => pos(c.id).x);
  // desktop 行为:side=0 时同级子节点同侧(root右侧),孙节点交替
  assert(xs.every((x) => x !== rootX), '左右交错子节点不在父节点位置');

  // side 强制
  doc.root.children[0].side = 1;
  doc.root.children[2].side = 2;
  mm.render();
  assert(pos(doc.root.children[0].id).x < rootX, 'side=1 强制左侧');
  assert(pos(doc.root.children[2].id).x > rootX, 'side=2 强制右侧');
  // 左侧连线从父左边缘出发
  const leEdges = container.querySelectorAll('.mm-edge');
  const rootW = rectW(doc.root.id);
  assert(leEdges[0].getAttribute('d').startsWith('M' + rootX + ','), '左侧连线起点为父左边缘');
}

console.log('--- Mindmap 默认 layout 字段 ---');
{
  const doc = createDoc('T');
  assert(doc.layout === 'right', 'createDoc 默认 layout=right');
  doc.layout = 'down';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  assert(mm.layout === 'down', 'Mindmap 读取 doc.layout');
}

console.log('--- Mindmap 字体颜色 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = doc.root.children[0].id;

  // 默认无 fontColor,用自动对比色
  mm.render();
  const defaultFill = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-text').getAttribute('fill');
  assert(defaultFill === '#2b333b', '默认字体颜色自动, got ' + defaultFill);

  // 设置 fontColor
  mm.applyFontColor('#ff0000');
  const redFill = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-text').getAttribute('fill');
  assert(redFill === '#ff0000', 'fontColor 设为红色, got ' + redFill);
  assert(doc.root.children[0].fontColor === '#ff0000', '模型 fontColor 更新');

  // 清除 fontColor
  mm.applyFontColor(null);
  const autoFill = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-text').getAttribute('fill');
  assert(autoFill !== '#ff0000', '清除后恢复自动颜色');
}

console.log('--- Mindmap spans 渲染 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'Hello';
  doc.root.spans = [
    { text: 'Hel', color: '#ff0000' },
    { text: 'lo', color: '#0000ff' },
  ];
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const tspans = container.querySelector('.mm-node[data-id="' + doc.root.id + '"] .mm-node-text').querySelectorAll('tspan');
  assert(tspans.length === 2, 'spans 渲染为 2 个 tspan, got ' + tspans.length);
  assert(tspans[0].getAttribute('fill') === '#ff0000', '第一个 tspan 红色');
  assert(tspans[1].getAttribute('fill') === '#0000ff', '第二个 tspan 蓝色');
  assert(tspans[0].textContent === 'Hel', '第一个 tspan 文本');
  assert(tspans[1].textContent === 'lo', '第二个 tspan 文本');
}

console.log('--- Mindmap 连续字号 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].fontSize = 24;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const textEl = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-text');
  assert(textEl.getAttribute('font-size') === '24', '字号 24px 渲染, got ' + textEl.getAttribute('font-size'));

  // applyFontSize 数字
  mm.selectedId = doc.root.children[0].id;
  mm.applyFontSize(32);
  const textEl2 = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-text');
  assert(textEl2.getAttribute('font-size') === '32', 'applyFontSize(32) 渲染, got ' + textEl2.getAttribute('font-size'));
  assert(doc.root.children[0].fontSize === 32, '模型 fontSize=32');

  // applyFontSize 旧格式 S/M/L 兼容
  mm.applyFontSize('S');
  assert(doc.root.children[0].fontSize === 12, 'applyFontSize("S") → 12');
}

console.log('--- Mindmap 富文本 spans 渲染 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'Hello';
  doc.root.spans = [
    { text: 'He', b: true, color: null },
    { text: 'llo', i: true, u: true, hl: '#ffff00' },
  ];
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const ts = container.querySelectorAll('.mm-node[data-id="' + doc.root.id + '"] .mm-node-text tspan');
  assert(ts.length === 2, '2 个 tspan, got ' + ts.length);
  assert(ts[0].getAttribute('font-weight') === 'bold', '第一段加粗');
  assert(ts[1].getAttribute('font-style') === 'italic', '第二段斜体');
  assert(ts[1].getAttribute('text-decoration') === 'underline', '第二段下划线');
  const hl = container.querySelector('.mm-node[data-id="' + doc.root.id + '"] rect[fill="#ffff00"]');
  assert(hl !== null, '高亮背景 rect');
}

console.log('--- Mindmap 多选 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children.push(createNode('B'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  mm._select(aId, true);
  mm._select(bId, true);
  const ids = mm.getSelectedIds();
  assert(ids.length === 3 && ids.includes(aId) && ids.includes(bId), 'Ctrl 多选含 A,B');
  mm._select(bId, true);
  assert(!mm.getSelectedIds().includes(bId), '再点取消 B');
}

console.log('--- Mindmap 节点拖拽重排 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children.push(createNode('B'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  mm._dragCandidate = { id: aId };
  mm._enterNodeDrag();
  const bG = container.querySelector('.mm-node[data-id="' + bId + '"]');
  const orig = document.elementFromPoint;
  document.elementFromPoint = () => bG;
  bG.getBoundingClientRect = () => ({ top: 0, left: 0, height: 100, width: 100 });
  mm._updateNodeDrag({ clientX: 10, clientY: 80 }); // 80% → after
  assert(mm._dropTarget && mm._dropTarget.place === 'after', '拖拽判定 after');
  mm._finishNodeDrag();
  document.elementFromPoint = orig;
  assert(doc.root.children[0].id === bId && doc.root.children[1].id === aId, 'A 移到 B 之后');
}

console.log('--- Mindmap 待办标记 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].checked = true;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const marker = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] rect[x="4"]');
  assert(marker !== null && marker.getAttribute('fill') === '#4f8cf0', '勾选标记渲染');
  mm._toggleTodo(doc.root.children[0]);
  assert(doc.root.children[0].checked === null, 'Ctrl+Enter 切换取消勾选');
  mm._toggleTodo(doc.root.children[0]);
  assert(doc.root.children[0].checked === true, '再切恢复勾选');
}

console.log('--- Mindmap 主题 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.theme = 'ocean';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.selectedId = null;
  mm.render();
  const rootRect = container.querySelector('.mm-node[data-id="' + doc.root.id + '"] .mm-node-rect');
  assert(rootRect.getAttribute('fill') === '#2c6ed5', '主题根节点填充 ocean');
  const childRect = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-rect');
  assert(childRect.getAttribute('stroke') === '#2c6ed5', '主题子节点描边 ocean');
  assert(container.style.background === '#eef4fb', '主题背景色应用');
}

console.log('--- Mindmap 备注渲染 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].note = '这是备注';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const noteText = [...container.querySelectorAll('.mm-node[data-id="' + doc.root.children[0].id + '"] text')]
    .find((t) => t.getAttribute('font-size') === '12' && t.textContent === '这是备注');
  assert(noteText !== null, '备注渲染为灰色小字');
}

console.log('--- Mindmap 图片渲染 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].files = [{ id: 'f', name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', isImage: true }];
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const img = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] image');
  assert(img !== null, '图片 <image> 渲染');
  assert(img.getAttribute('href') === 'data:image/png;base64,AAAA', 'href 正确');
  const h = parseFloat(container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-rect').getAttribute('height'));
  assert(h > 50, '图片使节点高度增大, got ' + h);
}

console.log('--- Mindmap Shift+点击折叠/展开 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].children.push(createNode('A1'));
  const aId = doc.root.children[0].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  assert(container.querySelectorAll('.mm-node').length === 3, '初始 3 节点');
  const ev = new window.Event('click');
  ev.shiftKey = true;
  container.querySelector('.mm-node[data-id="' + aId + '"]').dispatchEvent(ev);
  assert(container.querySelectorAll('.mm-node').length === 2, 'Shift+点击折叠后 2 节点');
  assert(doc.root.children[0].collapsed === true, 'collapsed=true');
  const ev2 = new window.Event('click');
  ev2.shiftKey = true;
  container.querySelector('.mm-node[data-id="' + aId + '"]').dispatchEvent(ev2);
  assert(container.querySelectorAll('.mm-node').length === 3, 'Shift+点击再展开恢复 3 节点');
  assert(doc.root.children[0].collapsed === false, 'collapsed=false');
}

console.log('--- Mindmap 点击 + 徽章展开 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].children.push(createNode('A1'));
  doc.root.children[0].collapsed = true;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  assert(container.querySelectorAll('.mm-node').length === 2, '折叠时 2 节点');
  const badge = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] circle');
  badge.dispatchEvent(new window.Event('click'));
  assert(doc.root.children[0].collapsed === false, '点击 + 徽章展开');
  assert(container.querySelectorAll('.mm-node').length === 3, '展开后 3 节点');
}

console.log('--- Mindmap 选择模式 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children.push(createNode('B'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  mm.setSelectionMode(true);
  mm._select(aId, true);
  mm._select(bId, true);
  const ids = mm.getSelectedIds();
  assert(ids.includes(aId) && ids.includes(bId), '导图选择模式多选');
  mm.setSelectionMode(false);
  assert(mm.getSelectedIds().length === 1, '退出选择模式清除附加选中');
}

console.log('--- Mindmap 长按菜单含编辑项 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const aId = doc.root.children[0].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const f = Tree.findNode(doc.root, aId);
  mm._showContextMenu({ clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }, f.node, f.parent, f.index);
  const items = document.body.querySelectorAll('.mm-ctx-menu .mm-ctx-item');
  const texts = [...items].map((i) => i.textContent);
  assert(texts.includes('编辑'), '长按菜单含编辑项');
  assert(texts.includes('添加子节点') && texts.includes('删除节点'), '含增删项');
  mm._closeContextMenu();
}

console.log('--- Mindmap 复制/粘贴 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const aId = doc.root.children[0].id;
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  mm.selectedId = aId;
  assert(mm.copySelected() === true, 'copy 成功');
  const before = doc.root.children.length;
  assert(mm.pasteTo(aId) === true, 'paste 成功');
  assert(doc.root.children.length === before + 1, '多一个兄弟');
  const pasted = doc.root.children[doc.root.children.length - 1];
  assert(pasted.id !== aId && pasted.text === 'A', '新 id + 内容一致');
}

console.log('--- Mindmap 背景色 hex ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  doc.root.children[0].color = '#ff6600';
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  const rect = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"] .mm-node-rect');
  assert(rect.getAttribute('fill') !== '#ffffff', '自定义 hex 背景色非白色, got ' + rect.getAttribute('fill'));
  assert(rect.getAttribute('stroke') === '#ff6600', '自定义 hex 边框色, got ' + rect.getAttribute('stroke'));
}

console.log('--- Mindmap 点击节点后画布保持焦点 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  let focused = 0;
  container.focus = () => { focused++; };
  const nodeA = container.querySelector('.mm-node[data-id="' + doc.root.children[0].id + '"]');
  nodeA.dispatchEvent(new window.Event('click'));
  assert(focused === 1, '点击节点后容器 focus 被调用(键盘快捷键可用), got ' + focused);
  assert(mm.selectedId === doc.root.children[0].id, '点击节点被选中');
}

console.log('--- Mindmap syncDoc 保留视角/缩放 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  doc.root.children.push(createNode('A'));
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.render();
  mm.zoomBy(1.5);
  mm.tx = 123; mm.ty = 45;
  const before = { scale: mm.scale, tx: mm.tx, ty: mm.ty };
  doc.root.children[0].text = '改';
  mm.syncDoc(doc);
  assert(mm.scale === before.scale && mm.tx === before.tx && mm.ty === before.ty, 'syncDoc 不重置视角');
  assert(mm.doc === doc, 'syncDoc 更新 doc 引用');
  const doc2 = createDoc('T2');
  mm.syncDoc(doc2);
  assert(mm.selectedId === doc2.root.id, 'syncDoc 失效选中回退到新根');
  assert(mm.layout === 'right', 'syncDoc 读取新 doc 布局');
}

console.log('--- Mindmap 径向布局子树角度不重叠 ---');
{
  const doc = createDoc('T');
  doc.root.text = '根';
  for (let i = 0; i < 8; i++) {
    const c = createNode('子' + i);
    for (let j = 0; j < 3; j++) c.children.push(createNode('孙'));
    doc.root.children.push(c);
  }
  const container = document.createElement('div');
  const mm = new Mindmap(container, doc, () => {});
  mm.setLayout('radial');
  const angleOf = (id) => {
    const g = container.querySelector('.mm-node[data-id="' + id + '"]');
    const m = g.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const w = parseFloat(g.querySelector('.mm-node-rect').getAttribute('width'));
    const h = parseFloat(g.querySelector('.mm-node-rect').getAttribute('height'));
    return Math.atan2(y + h / 2, x + w / 2);
  };
  const intervals = [];
  for (const c of doc.root.children) {
    const angles = [angleOf(c.id)];
    for (const d of Tree.walkAll(c)) if (d.id !== c.id) angles.push(angleOf(d.id));
    intervals.push({ min: Math.min(...angles), max: Math.max(...angles) });
  }
  intervals.sort((a, b) => a.min - b.min);
  let overlap = false;
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].min < intervals[i - 1].max - 0.01) { overlap = true; break; }
  }
  assert(!overlap, '径向布局相邻子树角度扇区不重叠');
}

console.log(`\n=== Mindmap 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
