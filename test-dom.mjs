// test-dom.mjs — DOM 集成测试(基于 linkedom 模拟浏览器环境)
import { parseHTML } from '/tmp/node_modules/linkedom/cjs/index.js';

// polyfill globals
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;

// 完整的 Selection / Range mock(linkedom 实现不完整,且我们不需要验证 caret 精度)
const mockRange = {
  setStart: () => {}, setEnd: () => {}, collapse: () => {},
  selectNodeContents: () => {}, selectNode: () => {}, cloneContents: () => ({ childNodes: [] }),
  cloneRange: () => mockRange,
};
const mockSelection = { rangeCount: 0, anchorNode: null, getRangeAt: () => mockRange, removeAllRanges: () => {}, addRange: () => {}, setBaseAndExtent: () => {} };
globalThis.getSelection = () => mockSelection;
Object.defineProperty(document, 'createRange', { value: () => mockRange, configurable: true });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { register: async () => {} } }, configurable: true });
globalThis.location = { origin: 'http://x', pathname: '/', hash: '' };
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const { Outliner } = await import('./js/outliner.js');
const { createDoc, createNode } = await import('./js/db.js');

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } }

function fakeKeyEvent(key, target, opts = {}) {
  return {
    key, target, preventDefault: () => {},
    shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, altKey: !!opts.alt,
  };
}

console.log('--- Outliner 渲染 ---');
{
  const doc = createDoc('测试');
  doc.root.text = '根节点';
  doc.root.children.push(createNode('子1'));
  doc.root.children.push(createNode('子2'));
  doc.root.children[0].children.push(createNode('孙1'));

  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  const rows = container.querySelectorAll('.outline-row');
  assert(rows.length === 4, '渲染 4 个节点, got ' + rows.length);
  assert(container.querySelector('.node-text[data-id="' + doc.root.id + '"]') !== null, '根节点文本存在');
  assert(container.querySelector('.bullet.has-children') !== null, '有子节点的 bullet 标记');
}

console.log('--- Outliner Tab 缩进 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  let changed = false;
  const outliner = new Outliner(container, doc, () => { changed = true; });
  outliner.render();

  outliner.selectedId = bId;
  const bText = container.querySelector('.node-text[data-id="' + bId + '"]');
  outliner._onKey(fakeKeyEvent('Tab', bText));

  assert(doc.root.children.length === 1, 'Tab 后顶层只剩 1 个, got ' + doc.root.children.length);
  assert(doc.root.children[0].id === aId, 'a 仍在顶层');
  assert(doc.root.children[0].children.length === 1, 'a 有 1 个子节点');
  assert(doc.root.children[0].children[0].id === bId, 'b 现在是 a 的子节点');
  assert(changed, '触发了 onChange');
}

console.log('--- Outliner Shift+Tab 减少缩进 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].children.push(createNode('b'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[0].children[0].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  outliner.selectedId = bId;
  const bText = container.querySelector('.node-text[data-id="' + bId + '"]');
  outliner._onKey(fakeKeyEvent('Tab', bText, { shift: true }));

  assert(doc.root.children.length === 2, 'outdent 后顶层 2 个, got ' + doc.root.children.length);
  assert(doc.root.children[1].id === bId, 'b 回到顶层');
  assert(doc.root.children[0].id === aId, 'a 仍在顶层第一个');
}

console.log('--- Outliner Backspace 删除空节点 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode(''));
  const aId = doc.root.children[0].id;
  const emptyId = doc.root.children[1].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  outliner.selectedId = emptyId;
  const emptyText = container.querySelector('.node-text[data-id="' + emptyId + '"]');
  outliner._onKey(fakeKeyEvent('Backspace', emptyText));

  assert(doc.root.children.length === 1, '删除后剩 1 个, got ' + doc.root.children.length);
  assert(doc.root.children[0].id === aId, 'a 保留');
  assert(outliner.selectedId === aId, '焦点回到 a');
}

console.log('--- Outliner Alt+ArrowDown 下移 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  doc.root.children.push(createNode('c'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  outliner.selectedId = aId;
  const aText = container.querySelector('.node-text[data-id="' + aId + '"]');
  outliner._onKey(fakeKeyEvent('ArrowDown', aText, { alt: true }));

  assert(doc.root.children[0].id === bId, 'b 现在第一');
  assert(doc.root.children[1].id === aId, 'a 现在第二');
}

console.log('--- Outliner Alt+ArrowUp 上移 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  outliner.selectedId = bId;
  const bText = container.querySelector('.node-text[data-id="' + bId + '"]');
  outliner._onKey(fakeKeyEvent('ArrowUp', bText, { alt: true }));

  assert(doc.root.children[0].id === bId, 'b 现在第一');
  assert(doc.root.children[1].id === aId, 'a 现在第二');
}

console.log('--- Outliner 配色 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  const aId = doc.root.children[0].id;
  outliner.selectedId = aId;
  outliner.applyColor('red');
  assert(doc.root.children[0].color === 'red', 'a 颜色设为 red');
  // 验证 bullet 上有 data-color
  const bullet = container.querySelector('.bullet[data-id="' + aId + '"]');
  assert(bullet && bullet.dataset.color === 'red', 'bullet 标记了 data-color');

  outliner.applyColor(null);
  assert(doc.root.children[0].color === null, '清除颜色');
}

console.log('--- Outliner 折叠/展开 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].children.push(createNode('a1'));
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  assert(container.querySelectorAll('.outline-row').length === 3, '初始 3 节点可见, got ' + container.querySelectorAll('.outline-row').length);

  outliner._toggleCollapse(doc.root.children[0].id);
  assert(container.querySelectorAll('.outline-row').length === 2, '折叠 a 后 2 可见, got ' + container.querySelectorAll('.outline-row').length);
  assert(doc.root.children[0].collapsed === true, 'a.collapsed=true');

  outliner._toggleCollapse(doc.root.children[0].id);
  assert(container.querySelectorAll('.outline-row').length === 3, '展开后 3 可见');
}

console.log('--- Outliner Ctrl+Backspace 删除非空节点 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();

  outliner.selectedId = bId;
  const bText = container.querySelector('.node-text[data-id="' + bId + '"]');
  outliner._onKey(fakeKeyEvent('Backspace', bText, { ctrl: true }));

  assert(doc.root.children.length === 1, '删除 b 后剩 1 个, got ' + doc.root.children.length);
  assert(doc.root.children[0].id === aId, 'a 保留');
}

console.log('--- Outliner collapseAll / expandAll ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].children.push(createNode('a1'));
  doc.root.children.push(createNode('b'));
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  outliner.collapseAll();
  assert(container.querySelectorAll('.outline-row').length === 3, 'collapseAll: 顶层3可见(含root), got ' + container.querySelectorAll('.outline-row').length);
  outliner.expandAll();
  assert(container.querySelectorAll('.outline-row').length === 4, 'expandAll: 全部4可见');
}

console.log(`\n=== DOM 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
