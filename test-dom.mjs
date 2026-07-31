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

console.log('--- Outliner 富文本 spans 渲染 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'Hello';
  doc.root.spans = [
    { text: 'He', color: null, b: true },
    { text: 'll', i: true },
    { text: 'o', u: true, s: true, hl: '#ffff00' },
  ];
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  const textEl = container.querySelector('.node-text[data-id="' + doc.root.id + '"]');
  const html = textEl.innerHTML;
  assert(html.includes('font-weight:bold'), '加粗渲染');
  assert(html.includes('font-style:italic'), '斜体渲染');
  assert(html.includes('underline') && html.includes('line-through'), '下划线+删除线渲染');
  assert(html.includes('background:#ffff00'), '高亮渲染');
}

console.log('--- Outliner 富文本 input 重建 spans ---');
{
  const doc = createDoc('T');
  doc.root.text = 'ab';
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  const textEl = container.querySelector('.node-text[data-id="' + doc.root.id + '"]');
  textEl.innerHTML = '<span style="font-weight:bold">a</span><span style="font-style:italic;text-decoration:underline line-through">b</span>';
  textEl.dispatchEvent(new window.Event('input'));
  const spans = doc.root.spans;
  assert(Array.isArray(spans) && spans.length === 2, 'spans 重建 2 段, got ' + (spans && spans.length));
  assert(spans[0].b === true, '第一段加粗');
  assert(spans[1].i === true && spans[1].u === true && spans[1].s === true, '第二段斜体+下划线+删除线');
  assert(doc.root.text === 'ab', 'text 保持 ab');
}

console.log('--- Outliner 待办复选框 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].checked = true;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  const aId = doc.root.children[0].id;
  const cb = container.querySelector('.node-check[data-id="' + aId + '"]');
  assert(cb !== null && cb.classList.contains('checked'), '勾选节点渲染选中复选框');
  // 点击取消勾选
  cb.dispatchEvent(new window.Event('click'));
  assert(doc.root.children[0].checked === null, '点击后 checked 置空(移除待办)');
  // 未勾选时复选框淡显(ghost),点击仍可重新勾选
  const cb2 = container.querySelector('.node-check[data-id="' + aId + '"]');
  assert(cb2 !== null && cb2.classList.contains('ghost') && !cb2.classList.contains('checked'), '取消勾选后复选框淡显');
  cb2.dispatchEvent(new window.Event('click'));
  assert(doc.root.children[0].checked === true, '再点恢复勾选');
}

console.log('--- Outliner 标签 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].tags = ['重要'];
  const aId = doc.root.children[0].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  assert(container.querySelector('.node-tag[data-tag="重要"]') !== null, '标签 chip 渲染');
  // 通过 blur 添加标签(精确到节点 a 的输入框)
  const input = container.querySelector('.node-tag-input[data-id="' + aId + '"]');
  input.value = '#新标签 重要';
  input.dispatchEvent(new window.Event('blur'));
  assert(doc.root.children[0].tags.includes('新标签'), 'blur 添加新标签');
  assert(doc.root.children[0].tags.filter((t) => t === '重要').length === 1, '重复标签去重');
  // 移除标签
  const x = container.querySelector('.node-tag-x[data-tag="重要"]');
  x.dispatchEvent(new window.Event('click'));
  assert(!doc.root.children[0].tags.includes('重要'), '点击 × 移除标签');
}

console.log('--- Outliner 复制/粘贴 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children[0].children.push(createNode('a1'));
  const aId = doc.root.children[0].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  outliner.selectedId = aId;
  assert(outliner.copySelected() === true, 'copySelected 成功');
  const n0 = doc.root.children.length;
  assert(outliner.pasteTo(aId) === true, 'pasteTo 成功');
  assert(doc.root.children.length === n0 + 1, '粘贴后多一个兄弟');
  const pasted = doc.root.children[doc.root.children.length - 1];
  assert(pasted.id !== aId && pasted.children[0].id !== doc.root.children[0].children[0].id, '粘贴生成全新 id');
  assert(pasted.text === 'a', '粘贴内容一致');
}

console.log('--- Outliner 多选与批量删除 ---');
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
  outliner.setSelection(aId, {});
  outliner.setSelection(bId, { additive: true });
  const ids = outliner.getSelectedIds();
  assert(ids.includes(aId) && ids.includes(bId), '多选包含 a,b');
  outliner.deleteSelected();
  assert(doc.root.children.length === 1, '批量删除后剩 1 个');
  assert(doc.root.children[0].id === 'root' || doc.root.children.length === 1, '删除正确');
}

console.log('--- Outliner 整块移动 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  doc.root.children.push(createNode('c'));
  const aId = doc.root.children[0].id;
  const bId = doc.root.children[1].id;
  const cId = doc.root.children[2].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  outliner.setSelection(aId, {});
  outliner.setSelection(bId, { additive: true });
  assert(outliner.moveSelectedBlock(1) === true, '整块下移成功');
  assert(doc.root.children[0].id === cId, 'c 移到最前');
  assert(doc.root.children[1].id === aId && doc.root.children[2].id === bId, 'a,b 下移');
}

console.log('--- Outliner 搜索与替换 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('你好世界'));
  doc.root.children.push(createNode('世界很大'));
  const c1 = doc.root.children[0].id;
  const c2 = doc.root.children[1].id;
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.render();
  const count = outliner.setSearchQuery('世界');
  assert(count === 2, '搜索到 2 处, got ' + count);
  outliner.goToMatch(1);
  assert(outliner.selectedId === c2, '定位到第二个匹配');
  outliner.goToMatch(0);
  assert(outliner.selectedId === c1, '定位到第一个匹配');
  // 搜索高亮 mark 已渲染(替换前)
  assert(container.querySelectorAll('mark.search-hit').length >= 1, '搜索高亮 mark 渲染');
  const replaced = outliner.replaceAll('WORLD');
  assert(replaced === 2, '全部替换 2 处, got ' + replaced);
  assert(doc.root.children[0].text === '你好WORLD' && doc.root.children[1].text === 'WORLD很大', '替换结果正确');
}

console.log('--- Outliner 备注行 ---');
{
  const doc = createDoc('T');
  doc.root.text = 'root';
  doc.root.children.push(createNode('a'));
  doc.root.children.push(createNode('b'));
  doc.root.children[0].note = '这是备注';
  const container = document.createElement('div');
  const outliner = new Outliner(container, doc, () => {});
  outliner.selectedId = doc.root.children[1].id; // b 选中(无 note)
  outliner.render();

  const aNote = container.querySelector('.node-note[data-id="' + doc.root.children[0].id + '"]');
  assert(aNote !== null, '有 note 的节点渲染备注行');
  assert(aNote.textContent === '这是备注', '备注内容正确');
  const rootNote = container.querySelector('.node-note[data-id="' + doc.root.id + '"]');
  assert(rootNote === null, '无 note 且未选中的节点不显示备注行');
  const bNote = container.querySelector('.node-note[data-id="' + doc.root.children[1].id + '"]');
  assert(bNote !== null, '选中无 note 节点显示可编辑备注行');
  assert(bNote.textContent === '', '空备注行无内容');

  bNote.textContent = '新备注';
  bNote.dispatchEvent(new window.Event('input'));
  assert(doc.root.children[1].note === '新备注', '备注输入更新模型, got ' + doc.root.children[1].note);
}

console.log(`\n=== DOM 测试: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
