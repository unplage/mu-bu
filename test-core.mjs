// test-core.mjs — 核心纯逻辑测试(不依赖 DOM)
import * as Tree from './js/tree.js';
import * as Export from './js/export.js';
import * as Share from './js/share.js';
import * as Clipboard from './js/clipboard.js';

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
      id: 'r', text: '根', note: '', color: 'red', collapsed: false, fontSize: 'L',
      children: [
        { id: 'c1', text: '子1', note: '', color: null, collapsed: false, children: [], fontSize: 'S' },
        { id: 'c2', text: '子2\n第二行', note: '', color: 'blue', collapsed: true, children: [
          { id: 'c2a', text: '孙', note: '', color: null, collapsed: false, children: [], fontSize: 'M' },
        ], fontSize: 'M' },
      ],
    },
  };
  const hash = await Share.encodeShare(doc);
  assert(typeof hash === 'string' && hash.length > 0, 'hash generated, len=' + hash.length);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.title === '分享测试', 'title decoded');
  assert(decoded.root.text === '根', 'root text decoded');
  assert(decoded.root.color === 'red', 'root color decoded');
  assert(decoded.root.fontSize === 'L', 'root fontSize preserved');
  assert(decoded.root.children[0].fontSize === 'S', 'child1 fontSize preserved');
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

console.log('--- validateDoc 归一化 layout/side ---');
{
  const v = Export.validateDoc({ title: 'T', layout: 'radial', root: { text: 'x', side: 2 } });
  assert(v.layout === 'radial', 'validateDoc 保留 layout');
  assert(v.root.side === 2, 'validateDoc 保留 side');
  const v2 = Export.validateDoc({ title: 'T', layout: 'weird', root: { text: 'x', side: 9 } });
  assert(v2.layout === 'right', 'validateDoc layout 非法归 right');
  assert(v2.root.side === 0, 'validateDoc side 非法归 0');
  const v3 = Export.validateDoc({ title: 'T', root: { text: 'x' } });
  assert(v3.layout === 'right', 'validateDoc 缺 layout 归 right');
  assert(v3.root.side === 0, 'validateDoc 缺 side 归 0');
}

console.log('--- validateDoc 归一化 fontColor/spans/fontSize ---');
{
  // fontColor
  const v = Export.validateDoc({ title: 'T', root: { text: 'x', fontColor: '#ff0000' } });
  assert(v.root.fontColor === '#ff0000', '保留 fontColor');
  const v2 = Export.validateDoc({ title: 'T', root: { text: 'x', fontColor: 'invalid' } });
  assert(v2.root.fontColor === null, '非法 fontColor 归 null');
  // spans
  const v3 = Export.validateDoc({ title: 'T', root: { text: 'Hi', spans: [{ text: 'H', color: '#f00' }, { text: 'i', color: null }] } });
  assert(v3.root.spans.length === 2, '保留合法 spans');
  assert(v3.root.spans[0].color === '#f00', 'span color 保留');
  const v4 = Export.validateDoc({ title: 'T', root: { text: 'Hi', spans: [{ text: 'X', color: '#f00' }] } });
  assert(v4.root.spans === null, 'spans 不匹配 text 时丢弃');
  // fontSize 数字
  const v5 = Export.validateDoc({ title: 'T', root: { text: 'x', fontSize: 24 } });
  assert(v5.root.fontSize === 24, '数字 fontSize 保留');
  const v6 = Export.validateDoc({ title: 'T', root: { text: 'x', fontSize: 99 } });
  assert(v6.root.fontSize === 14, '超范围 fontSize 归 14');
  const v7 = Export.validateDoc({ title: 'T', root: { text: 'x', fontSize: 'S' } });
  assert(v7.root.fontSize === 12, 'S → 12');
  const v8 = Export.validateDoc({ title: 'T', root: { text: 'x', fontSize: 'L' } });
  assert(v8.root.fontSize === 18, 'L → 18');
}

console.log('--- share 往返保留 fontColor/spans ---');
{
  const doc = {
    id: 'doc_x', title: '颜色分享', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: 'Hi', note: '', color: null, fontColor: '#ff0000',
      spans: [{ text: 'H', color: '#0000ff' }, { text: 'i', color: null }],
      collapsed: false, fontSize: 'M', side: 0, children: [],
    },
  };
  const hash = await Share.encodeShare(doc);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.root.fontColor === '#ff0000', 'fontColor 往返');
  assert(decoded.root.spans.length === 2, 'spans 往返');
  assert(decoded.root.spans[0].color === '#0000ff', 'span color 往返');
}

console.log('--- share 数字字号往返(8-72px) ---');
{
  const doc = {
    id: 'doc_x', title: '字号', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: '根', note: '', color: null, collapsed: false, children: [
        { id: 'c1', text: '24px', note: '', color: null, collapsed: false, children: [], fontSize: 24, side: 0 },
        { id: 'c2', text: '12px', note: '', color: null, collapsed: false, children: [], fontSize: 12, side: 0 },
        { id: 'c3', text: '14默认', note: '', color: null, collapsed: false, children: [], fontSize: 14, side: 0 },
        { id: 'c4', text: 'L', note: '', color: null, collapsed: false, children: [], fontSize: 'L', side: 0 },
      ],
    },
  };
  const hash = await Share.encodeShare(doc);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.root.children[0].fontSize === 24, '数字 24 往返, got ' + decoded.root.children[0].fontSize);
  assert(decoded.root.children[1].fontSize === 12, '数字 12 往返, got ' + decoded.root.children[1].fontSize);
  assert(decoded.root.children[2].fontSize === 'M', '默认 14 不编码回 M, got ' + decoded.root.children[2].fontSize);
  assert(decoded.root.children[3].fontSize === 'L', '字符串 L 往返, got ' + decoded.root.children[3].fontSize);
}

console.log('--- share 单 span 颜色往返 ---');
{
  const doc = {
    id: 'doc_x', title: '单色', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: 'Hi', note: '', color: null, fontColor: null,
      spans: [{ text: 'Hi', color: '#ff0000' }],
      collapsed: false, fontSize: 'M', side: 0, children: [],
    },
  };
  const hash = await Share.encodeShare(doc);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.root.spans !== null && decoded.root.spans.length === 1, '单 span 保留');
  assert(decoded.root.spans[0].color === '#ff0000', '单 span 颜色保留');
  assert(decoded.root.spans[0].text === 'Hi', '单 span 文本保留');
}

console.log('--- export Markdown 含 note ---');
{
  const doc = { title: 'Test', root: { id: 'r', text: 'Test', note: '', color: null, collapsed: false, children: [
    { id: 'a', text: 'A', note: '这是备注\n第二行', color: null, collapsed: false, children: [] },
  ] } };
  const md = Export.exportMarkdown(doc);
  assert(md.includes('- A'), 'md 有节点 A');
  assert(md.includes('  这是备注'), 'md 有备注第一行');
  assert(md.includes('  第二行'), 'md 有备注第二行');
}

console.log('--- share 往返保留 layout/side ---');
{
  const doc = {
    id: 'doc_x', title: '布局分享', layout: 'radial', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: '根', note: '', color: 'red', collapsed: false, fontSize: 'L', side: 0,
      children: [
        { id: 'c1', text: '左', note: '', color: null, collapsed: false, children: [], fontSize: 'M', side: 1 },
        { id: 'c2', text: '右', note: '', color: 'blue', collapsed: false, children: [], fontSize: 'M', side: 2 },
        { id: 'c3', text: '自动', note: '', color: null, collapsed: false, children: [], fontSize: 'M', side: 0 },
      ],
    },
  };
  const hash = await Share.encodeShare(doc);
  const decoded = await Share.decodeShare(hash);
  assert(decoded.layout === 'radial', 'layout 往返 radial');
  assert(decoded.root.children[0].side === 1, 'side=1 往返');
  assert(decoded.root.children[1].side === 2, 'side=2 往返');
  assert(decoded.root.children[2].side === 0, 'side=0 默认往返');
  // 默认 layout 不编码
  doc.layout = 'right';
  const hash2 = await Share.encodeShare(doc);
  const decoded2 = await Share.decodeShare(hash2);
  assert(decoded2.layout === 'right', '默认 layout 不编码');
}

console.log('--- validateDoc 新字段归一化 ---');
{
  const v = Export.validateDoc({
    title: 'T', theme: 'ocean',
    root: {
      text: 'x', checked: true, tags: ['#a', '', ' b ', 3],
      link: 'https://example.com', createdAt: 123, side: 0,
      spans: [{ text: 'x', color: '#f00', b: true, i: true, u: true, s: true, hl: '#ffff00' }],
      children: [{ text: 'y', files: [{ name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }] }],
    },
  });
  assert(v.theme === 'ocean', 'theme 保留');
  assert(v.root.checked === true, 'checked 归一化');
  assert(JSON.stringify(v.root.tags) === JSON.stringify(['a', 'b', '3']), 'tags 去 # 去空, got ' + JSON.stringify(v.root.tags));
  assert(v.root.link === 'https://example.com', 'link 保留');
  assert(v.root.createdAt === 123, 'createdAt 保留');
  assert(v.root.spans[0].b && v.root.spans[0].i && v.root.spans[0].u && v.root.spans[0].s, '富文本属性保留');
  assert(v.root.spans[0].hl === '#ffff00', '高亮色保留');
  assert(v.root.children[0].files[0].dataUrl.startsWith('data:'), 'files 保留');
  const v2 = Export.validateDoc({ title: 'T', root: { text: 'x', link: 'javascript:alert(1)' } });
  assert(v2.root.link === null, '非法 link 归 null');
}

console.log('--- share 往返新字段 ---');
{
  const doc = {
    id: 'doc_x', title: '新字段', layout: 'radial', theme: 'ocean', createdAt: 1, updatedAt: 2,
    root: {
      id: 'r', text: 'Hi', note: '', color: 'red', collapsed: false, fontSize: 20, side: 1,
      checked: true, tags: ['重要', '待办'], link: 'https://a.com', createdAt: 42,
      spans: [{ text: 'H', color: '#ff0000', b: true }, { text: 'i', hl: '#ffff00', u: true }],
      children: [],
    },
  };
  const hash = await Share.encodeShare(doc);
  const d = await Share.decodeShare(hash);
  assert(d.theme === 'ocean', 'theme 往返');
  assert(d.root.checked === true, 'checked 往返');
  assert(JSON.stringify(d.root.tags) === JSON.stringify(['重要', '待办']), 'tags 往返');
  assert(d.root.link === 'https://a.com', 'link 往返');
  assert(d.root.createdAt === 42, 'createdAt 往返');
  assert(d.root.spans[0].b === true, 'span bold 往返');
  assert(d.root.spans[1].hl === '#ffff00' && d.root.spans[1].u === true, 'span 高亮/下划线 往返');
  assert(d.root.files === null, 'files 不随分享(体积)');
}

console.log('--- tree collectTopmost / removeNodesByIds ---');
{
  const root = {
    id: 'root', text: 'R', children: [
      { id: 'a', text: 'A', children: [
        { id: 'a1', text: 'A1', children: [] },
        { id: 'a2', text: 'A2', children: [] },
      ] },
      { id: 'b', text: 'B', children: [{ id: 'b1', text: 'B1', children: [] }] },
    ],
  };
  // a 与 a1 同时选中:只取最顶层 a
  const top = Tree.collectTopmost(root, new Set(['a', 'a1', 'b']));
  assert(top.length === 2, '顶层选中 a+b, got ' + top.length);
  assert(top.some((t) => t.node.id === 'a'), '含 a');
  assert(top.some((t) => t.node.id === 'b'), '含 b');
  // 批量删除 a + b(索引安全)
  Tree.removeNodesByIds(root, new Set(['a', 'b']));
  assert(root.children.length === 0, '删除后顶层为空');
}

console.log('--- tree groupIndicesByParent / moveBlock ---');
{
  const root = {
    id: 'root', text: 'R', children: [
      { id: 'a', text: 'A', children: [] },
      { id: 'b', text: 'B', children: [] },
      { id: 'c', text: 'C', children: [] },
      { id: 'd', text: 'D', children: [] },
    ],
  };
  const g = Tree.groupIndicesByParent(root, new Set(['b', 'c']));
  assert(g.size === 1 && JSON.stringify(g.get(root)) === JSON.stringify([1, 2]), 'b,c 分到 root 组');
  assert(Tree.moveBlock(root, g.get(root), -1), '整块上移成功');
  assert(root.children[0].id === 'b' && root.children[1].id === 'c', '上移后 b,c 在最前');
  const g2 = Tree.groupIndicesByParent(root, new Set(['b', 'c']));
  assert(!Tree.moveBlock(root, g2.get(root), -1), '已在顶部不能再上移');
  const g3 = Tree.groupIndicesByParent(root, new Set(['b', 'c']));
  assert(Tree.moveBlock(root, g3.get(root), 1), '整块下移成功');
  assert(root.children[1].id === 'b' && root.children[2].id === 'c', '下移后 b,c 在 1,2');
}

console.log('--- tree sortSiblings ---');
{
  const root = {
    id: 'root', text: 'R', children: [
      { id: 'b', text: 'Banana', createdAt: 3, children: [] },
      { id: 'a', text: 'apple', createdAt: 1, children: [] },
      { id: 'c', text: 'Cherry long', createdAt: 2, children: [] },
    ],
  };
  Tree.sortSiblings(root, 'name', 1);
  assert(root.children[0].text === 'apple', '名称升序 apple 第一');
  Tree.sortSiblings(root, 'name', -1);
  assert(root.children[0].text === 'Cherry long', '名称降序 Cherry 第一');
  Tree.sortSiblings(root, 'time', 1);
  assert(root.children[0].text === 'apple', '时间升序 apple(createdAt=1) 第一');
  Tree.sortSiblings(root, 'length', 1);
  assert(root.children[0].text === 'apple', '字数升序 apple(5) 第一');
}

console.log('--- tree countText ---');
{
  const root = {
    id: 'root', text: '你好 world', note: '备注', children: [
      { id: 'a', text: 'ab', note: '', children: [] },
    ],
  };
  const s = Tree.countText(root);
  assert(s.nodes === 2, '2 节点');
  assert(s.chars === 13, '字符数(中文按字符计), got ' + s.chars);
  assert(s.words === 4, '词数, got ' + s.words);
}

console.log('--- clipboard 序列化/反序列化 ---');
{
  const nodes = [{
    id: 'x', text: '根', note: 'n', color: 'red', fontColor: '#f00', spans: [{ text: '根', color: '#f00', b: true }],
    collapsed: true, fontSize: 'L', side: 1, checked: true, tags: ['t'], link: 'https://a.com',
    files: [{ id: 'f', name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }],
    children: [{ id: 'y', text: '子', children: [], fontSize: 'M', side: 0 }],
  }];
  const json = Clipboard.serializeNodes(nodes);
  const out = Clipboard.deserializeNodes(json);
  assert(out.length === 1, '反序列化 1 节点');
  assert(out[0].id !== 'x' && out[0].children[0].id !== 'y', 'id 全部重新生成');
  assert(out[0].text === '根' && out[0].spans[0].b === true, '内容与富文本保留');
  assert(out[0].tags[0] === 't' && out[0].link === 'https://a.com', 'tags/link 保留');
  assert(out[0].files === null, 'files 不随剪贴板');
  assert(Clipboard.isNodeClipboard(json), 'isNodeClipboard 识别');
  assert(!Clipboard.isNodeClipboard('not json'), '非法剪贴板识别');
}

console.log('--- validateDoc 画布背景字段 ---');
{
  const d = Export.validateDoc({ title: 't', root: { text: 'x', children: [] }, bg: '#ffeeee', theme: 'ocean' });
  assert(d.bg === '#ffeeee' && d.theme === 'ocean', '合法 bg/theme 保留');
  const bad = Export.validateDoc({ title: 't', root: { text: 'x', children: [] }, bg: 'notacolor' });
  assert(bad.bg === null, '非法 bg 归一化为 null');
  const old = Export.validateDoc({ title: 't', root: { text: 'x', children: [] } });
  assert(old.bg === null, '旧文档无 bg 字段兜底为 null');
}

console.log('--- importMarkdown 基础 ---');
{
  const md = `# 测试文档

- 第一项
- 第二项
  - 子项A
  - 子项B
- 第三项`;
  const doc = Export.importMarkdown(md);
  assert(doc.title === '测试文档', 'title from h1');
  assert(doc.root.children.length === 3, '3 top children');
  assert(doc.root.children[0].text === '第一项', 'first item');
  assert(doc.root.children[1].text === '第二项', 'second item');
  assert(doc.root.children[1].children.length === 2, 'nested children');
  assert(doc.root.children[1].children[0].text === '子项A', 'child A');
}

console.log('--- importMarkdown 多级标题 ---');
{
  const md = `## 二级标题

    - 子1
    - 子2`;
  const doc = Export.importMarkdown(md);
  assert(doc.root.children[0].text === '二级标题', 'h2 as child');
  assert(doc.root.children[0].children.length === 2, 'h2 has 2 children');
}

console.log('--- importMarkdown 空输入 ---');
{
  const doc = Export.importMarkdown('');
  assert(doc.title === '导入文档', 'empty → default title');
  assert(doc.root.children.length === 0, 'no children');
}

console.log('--- importText 基础 ---');
{
  const txt = `我的文档
- 第一项
  - 子项A
- 第二项`;
  const doc = Export.importText(txt);
  assert(doc.title === '我的文档', 'title from first line');
  assert(doc.root.children.length === 2, '2 top children');
  assert(doc.root.children[0].text === '第一项', 'first item');
  assert(doc.root.children[0].children[0].text === '子项A', 'child A');
}

console.log('--- importText 无标记 ---');
{
  const txt = `项目计划
设计
  前端
  后端
测试`;
  const doc = Export.importText(txt);
  assert(doc.title === '项目计划', 'title');
  assert(doc.root.children.length === 2, '2 top children');
  assert(doc.root.children[0].children.length === 2, '设计 has 2 children');
}

console.log('--- importText 空输入 ---');
{
  const doc = Export.importText('');
  assert(doc.title === '导入文档', 'empty → default title');
  assert(doc.root.children.length === 0, 'no children');
}

console.log('--- importHTML 基础 ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body>
<h1>测试文档</h1>
<ul>
  <li>第一项</li>
  <li>第二项</li>
  <li>第三项</li>
</ul>
</body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.title === '测试文档', 'title from h1');
    assert(doc.root.children.length === 3, '3 children');
    assert(doc.root.children[0].text === '第一项', 'first li');
  } else {
    console.log('  (skip importHTML: DOMParser unavailable in Node)');
  }
}

console.log('--- importHTML 嵌套列表 ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body>
<h1>嵌套</h1>
<ul>
  <li>父项
    <ul>
      <li>子项A</li>
      <li>子项B</li>
    </ul>
  </li>
</ul>
</body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.root.children[0].text.includes('父项'), 'parent item');
    assert(doc.root.children[0].children.length === 2, 'nested children');
  } else {
    console.log('  (skip importHTML: DOMParser unavailable in Node)');
  }
}

console.log('--- importHTML 无 h1 ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body><ul><li>A</li></ul></body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.title === '导入文档', 'no h1 → default title');
    assert(doc.root.children[0].text === 'A', 'child preserved');
  } else {
    console.log('  (skip importHTML: DOMParser unavailable in Node)');
  }
}

console.log('--- importHTML 幕布格式 基础 ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body>
<div class="title">幕布测试</div>
<ul class="node-list">
  <li class="node">
    <div class="content"><span>节点A</span></div>
    <div class="children"><ul class="node-list">
      <li class="node">
        <div class="content"><span>子节点A1</span></div>
      </li>
      <li class="node">
        <div class="content"><span>子节点A2</span></div>
      </li>
    </ul></div>
  </li>
  <li class="node">
    <div class="content"><span>节点B</span></div>
  </li>
</ul>
</body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.title === '幕布测试', 'title from .title');
    assert(doc.root.children.length === 2, '2 top children');
    assert(doc.root.children[0].text === '节点A', 'first node');
    assert(doc.root.children[0].children.length === 2, 'A has 2 children');
    assert(doc.root.children[0].children[0].text === '子节点A1', 'child A1');
    assert(doc.root.children[1].text === '节点B', 'second node');
  } else {
    console.log('  (skip importHTML 幕布格式: DOMParser unavailable in Node)');
  }
}

console.log('--- importHTML 幕布格式 含 note ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body>
<div class="title">含备注</div>
<ul class="node-list">
  <li class="node">
    <div class="content"><span>有备注的节点</span></div>
    <div class="note"><span>这是备注内容</span></div>
  </li>
  <li class="node">
    <div class="content"><span>无备注的节点</span></div>
  </li>
</ul>
</body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.root.children[0].note === '这是备注内容', 'note extracted');
    assert(doc.root.children[1].note === '', 'no note is empty');
  } else {
    console.log('  (skip importHTML 幕布格式 note: DOMParser unavailable in Node)');
  }
}

console.log('--- importHTML 幕布格式 多层嵌套 ---');
{
  if (typeof DOMParser !== 'undefined') {
    const html = `<html><body>
<div class="title">多层</div>
<ul class="node-list">
  <li class="node">
    <div class="content"><span>L1</span></div>
    <div class="children"><ul class="node-list">
      <li class="node">
        <div class="content"><span>L2</span></div>
        <div class="children"><ul class="node-list">
          <li class="node">
            <div class="content"><span>L3</span></div>
          </li>
        </ul></div>
      </li>
    </ul></div>
  </li>
</ul>
</body></html>`;
    const doc = Export.importHTML(html);
    assert(doc.root.children[0].text === 'L1', 'L1');
    assert(doc.root.children[0].children[0].text === 'L2', 'L2');
    assert(doc.root.children[0].children[0].children[0].text === 'L3', 'L3');
  } else {
    console.log('  (skip importHTML 幕布格式 多层: DOMParser unavailable in Node)');
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
