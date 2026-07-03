// test-core.mjs — 核心纯逻辑测试(不依赖 DOM)
import * as Tree from './js/tree.js';
import * as Export from './js/export.js';
import * as Share from './js/share.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg); }
}

function makeTree() {
  return {
    id: 'root', text: 'Root', note: '', color: null, collapsed: false,
    children: [
      { id: 'a', text: 'A', note: '', color: null, collapsed: false, children: [
        { id: 'a1', text: 'A1', note: '', color: null, collapsed: false, children: [] },
        { id: 'a2', text: 'A2', note: '', color: null, collapsed: false, children: [] },
      ]},
      { id: 'b', text: 'B', note: '', color: null, collapsed: false, children: [] },
    ],
  };
}

console.log('--- tree.findNode ---');
{
  const t = makeTree();
  assert(Tree.findNode(t, 'root') !== null, 'find root');
  assert(Tree.findNode(t, 'a1')?.node.id === 'a1', 'find a1');
  assert(Tree.findNode(t, 'a1')?.parent.id === 'a', 'a1 parent is a');
  assert(Tree.findNode(t, 'a1')?.index === 0, 'a1 index 0');
  assert(Tree.findNode(t, 'nope') === null, 'missing returns null');
}

console.log('--- tree.flattenVisible ---');
{
  const t = makeTree();
  const flat = Tree.flattenVisible(t);
  assert(flat.length === 5, '5 visible nodes, got ' + flat.length);
  assert(flat[0].node.id === 'root' && flat[0].depth === 0, 'root depth 0');
  assert(flat[1].node.id === 'a' && flat[1].depth === 1, 'a depth 1');
  assert(flat[2].node.id === 'a1' && flat[2].depth === 2, 'a1 depth 2');
  // 折叠 a 后只剩 root, a, b
  t.children[0].collapsed = true;
  const flat2 = Tree.flattenVisible(t);
  assert(flat2.length === 3, '3 visible after collapse, got ' + flat2.length);
}

console.log('--- tree.insertAfter / removeNode ---');
{
  const t = makeTree();
  const a = Tree.findNode(t, 'a');
  Tree.insertAfter(a.parent, a.index, { id: 'new', text: 'N', children: [] });
  assert(t.children.length === 3, 'insert sibling, len 3 got ' + t.children.length);
  assert(t.children[1].id === 'new', 'new at index 1');
  Tree.removeNode(t, 1);
  assert(t.children.length === 2, 'remove, len 2 got ' + t.children.length);
}

console.log('--- tree.indent / outdent ---');
{
  const t = makeTree();
  // indent b (index 1) -> becomes child of a
  const b = Tree.findNode(t, 'b');
  const ok = Tree.indent(b.parent, b.index);
  assert(ok, 'indent ok');
  assert(t.children.length === 1, 'top-level now 1, got ' + t.children.length);
  assert(t.children[0].id === 'a', 'a is top');
  assert(t.children[0].children.length === 3, 'a has 3 children, got ' + t.children[0].children.length);
  assert(t.children[0].children[2].id === 'b', 'b is now child of a');

  // outdent b back: b is now a.children[2]
  const b2 = Tree.findNode(t, 'b');
  const gp = Tree.findNode(t, 'a'); // a is parent of b; grandparent should be root
  // 我们的 outdent 需要 grandparent。outliner 里用 findGrandparent 查找;这里直接传 root
  const ok2 = Tree.outdent(b2.parent, b2.index, t);
  assert(ok2, 'outdent ok');
  assert(t.children.length === 2, 'top-level back to 2, got ' + t.children.length);
  assert(t.children[1].id === 'b', 'b back at top');
}

console.log('--- tree.moveNode (reorder) ---');
{
  const t = makeTree();
  // move a (index 0) to final index 1 -> [b, a]
  Tree.moveNode(t, 0, t, 1);
  assert(t.children[0].id === 'b', 'b now first');
  assert(t.children[1].id === 'a', 'a now second');
  // move b (now index 0) to final index 1 -> [a, b]
  Tree.moveNode(t, 0, t, 1);
  assert(t.children[0].id === 'a', 'a back first');
  assert(t.children[1].id === 'b', 'b back second');
}

console.log('--- tree.contains ---');
{
  const t = makeTree();
  assert(Tree.contains(t, 'root'), 'contains root');
  assert(Tree.contains(t, 'a1'), 'contains a1');
  assert(Tree.contains(t.children[0], 'a1'), 'a contains a1');
  assert(!Tree.contains(t.children[1], 'a1'), 'b does not contain a1');
  assert(!Tree.contains(t, 'nope'), 'not contains nope');
}

console.log('--- export Markdown ---');
{
  const doc = { title: 'Test', root: makeTree() };
  doc.root.text = 'Test';
  const md = Export.exportMarkdown(doc);
  assert(md.startsWith('# Test'), 'md starts with title');
  assert(md.includes('- A'), 'md has A');
  assert(md.includes('  - A1'), 'md has indented A1');
  assert(md.includes('- B'), 'md has B');
}

console.log('--- export OPML roundtrip ---');
{
  const doc = { title: 'Opml测试', root: makeTree() };
  doc.root.text = '根';
  const opml = Export.exportOPML(doc);
  assert(opml.includes('<opml'), 'has opml tag');
  assert(opml.includes('Opml测试'), 'has title');
  assert(opml.includes('text="A"'), 'has node A');
  assert(opml.includes('text="A1"'), 'has node A1');
  // OPML 导入依赖浏览器 DOMParser,Node 环境跳过往返测试
  if (typeof DOMParser !== 'undefined') {
    const imported = Export.importOPML(opml);
    assert(imported.title === 'Opml测试', 'title preserved');
    assert(imported.root.children.length === 2, 'children preserved');
    assert(imported.root.children[0].children.length === 2, 'A children preserved');
  } else {
    console.log('  (skip importOPML: DOMParser unavailable in Node)');
  }
}

console.log('--- export Text ---');
{
  // exportText 内部调用 download(依赖 DOM),Node 环境仅验证导出模块可加载
  assert(typeof Export.exportText === 'function', 'exportText is a function');
}

console.log('--- share encode/decode roundtrip ---');
{
  const doc = {
    id: 'doc_x', title: '分享测试', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: '根', note: '', color: 'red', collapsed: false,
      children: [
        { id: 'c1', text: '子1', note: '', color: null, collapsed: false, children: [] },
        { id: 'c2', text: '子2\n第二行', note: '', color: 'blue', collapsed: true, children: [
          { id: 'c2a', text: '孙', note: '', color: null, collapsed: false, children: [] },
        ]},
      ],
    },
  };
  const hash = await Share.encodeShare(doc);
  assert(typeof hash === 'string' && hash.length > 0, 'hash generated, len=' + hash.length);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.title === '分享测试', 'title decoded');
  assert(decoded.root.text === '根', 'root text decoded');
  assert(decoded.root.color === 'red', 'root color decoded');
  assert(decoded.root.children.length === 2, '2 children');
  assert(decoded.root.children[0].text === '子1', 'child1 text');
  assert(decoded.root.children[1].text === '子2\n第二行', 'multiline text preserved');
  assert(decoded.root.children[1].color === 'blue', 'child2 color');
  assert(decoded.root.children[1].collapsed === true, 'child2 collapsed');
  assert(decoded.root.children[1].children.length === 1, 'grandchild preserved');
}

console.log('--- share URL detection ---');
{
  // 模拟 location.hash
  const orig = globalThis.location;
  Object.defineProperty(globalThis, 'location', {
    value: { hash: '#share=abc123', origin: 'http://x', pathname: '/' },
    configurable: true,
  });
  const h = Share.getShareHashFromURL();
  assert(h === 'abc123', 'extracted share hash');
  Object.defineProperty(globalThis, 'location', { value: orig, configurable: true });
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
