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
  mm.applyFontSize('S');
  assert(doc.root.children[0].fontSize === 'S', 'A 字号设为 S');
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

console.log(`\n=== Mindmap 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
