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
  assert(doc.root.children[0].fontSize === 'L', 'A 字号设为 L');
  const textsL = container.querySelectorAll('.mm-node-text');
  assert(textsL[1].getAttribute('font-size') === '18', 'applyFontSize 后立即重绘,A 字号 18px, got ' + textsL[1].getAttribute('font-size'));
  const rectsL = container.querySelectorAll('.mm-node-rect');
  assert(rectsL[1].getAttribute('stroke-width') === '3', '重绘后 A 仍保持选中态');
  mm.applyFontSize('S');
  assert(doc.root.children[0].fontSize === 'S', 'A 字号设为 S');
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
  assert(Math.abs(rR.x) < 2 && Math.abs(rR.y) < 2, '径向布局 root 在原点, got (' + rR.x + ',' + rR.y + ')');
  const c0R = pos(doc.root.children[0].id);
  assert(Math.hypot(c0R.x, c0R.y) > 40, '径向布局子节点离中心 > 40');
  // 连线应为斜向
  const radEdges = container.querySelectorAll('.mm-edge');
  assert(radEdges[0].getAttribute('d').includes('C'), '径向布局连线含贝塞尔');

  // 左右交错:子节点分布两侧
  mm.setLayout('leftright');
  const rootX = pos(doc.root.id).x;
  const xs = doc.root.children.map((c) => pos(c.id).x);
  assert(xs.some((x) => x < rootX) && xs.some((x) => x > rootX), '左右交错子节点在两侧, xs=' + xs.join(','));

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

console.log(`\n=== Mindmap 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
