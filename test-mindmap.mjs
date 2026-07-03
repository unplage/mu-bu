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

console.log(`\n=== Mindmap 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
