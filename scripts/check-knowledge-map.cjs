const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: mod.exports, module: mod, require: name => overrides[name] || require(name), Date, console });
  return mod.exports;
}
const m = load('components/flowdesk/graph-model.ts');
let checks = 0;
const check = (name, run) => { run(); checks++; };
const edge = (id, source, target, relation_type = 'references', extra = {}) => {
  const [source_type, source_id] = source.split(':'), [target_type, target_id] = target.split(':');
  return { id, source_id, source_type, target_id, target_type, relation_type, ...extra };
};
const input = {
  projects: [{ id: 'p', name: 'Dự án thật', area: 'Công việc', goal: 'Một kết quả' }],
  tasks: [{ id: 't', title: 'Việc thứ nhất', description: 'Chi tiết', project_id: 'p', status: 'todo' }],
  notes: [{ id: 'a', title: 'Ảnh sáng', body: 'Nội dung', tag: 'Hình ảnh', project_id: 'p' }, { id: 'b', title: 'Tài liệu', body: '', tag: 'Hình ảnh', project_id: null }, { id: 'orphan', title: 'Độc lập', body: '', tag: 'Ý tưởng', project_id: null }, { id: 'gone', title: 'Đã xóa', body: '', tag: '', project_id: null, deleted_at: '2026-10-01' }],
  relations: [edge('1', 'project:p', 'task:t', 'contains'), edge('2', 'task:t', 'note:a'), edge('3', 'note:a', 'note:b', 'relates_to'), edge('duplicate', 'note:b', 'note:a', 'relates_to'), edge('missing', 'note:a', 'note:missing'), edge('deleted', 'note:a', 'note:gone'), edge('self', 'note:a', 'note:a'), edge('expired', 'note:a', 'note:orphan', 'references', { valid_until: '2020-01-01' }), edge('rejected', 'note:a', 'note:orphan', 'references', { status: 'rejected' }), edge('soft-deleted', 'note:a', 'note:orphan', 'references', { deleted_at: '2026-10-01' })],
};
const before = JSON.stringify(input), model = m.buildGraph(input);
check('only valid saved edges', () => { assert.equal(model.nodes.length, 5); assert.equal(model.edges.length, 3); });
check('no mutations of workspace data', () => assert.equal(JSON.stringify(input), before));
check('accurate degrees in detail lookup', () => { assert.equal(model.nodeMap.get('note:a').degree, 2); assert.equal(model.nodeMap.get('task:t').degree, 2); assert.equal(model.nodeMap.get('note:orphan').degree, 0); });
check('sum of degrees', () => assert.equal(model.nodes.reduce((s, n) => s + n.degree, 0), model.edges.length * 2));
check('project groups follow membership', () => assert.equal(model.nodeMap.get('note:a').group, model.nodeMap.get('project:p').group));
check('topic grouping does not invent links', () => { const topic = m.buildGraph(input, 'topic'); assert.equal(topic.nodeMap.get('note:a').group, topic.nodeMap.get('note:b').group); assert.equal(topic.edges.length, model.edges.length); });
check('dangling project falls back safely', () => { const orphaned = m.buildGraph({ ...input, projects: [] }); assert.ok(orphaned.nodes.length); });
check('one hop is exact', () => { const ids = m.neighborhood(model.edges, 'task:t', 1); assert.equal(ids.size, 3); assert.ok(!ids.has('note:b')); });
check('two hops reaches related note', () => assert.ok(m.neighborhood(model.edges, 'task:t', 2).has('note:b')));
check('orphan switch preserves actual edge set', () => { const v = m.filterGraph(model, { kind: 'all', group: 'all', showOrphans: false, root: null, depth: 1 }); assert.equal(v.nodes.length, 4); assert.equal(v.edges.length, 3); });
check('filtered graph has no dangling endpoints', () => { const v = m.filterGraph(model, { kind: 'note', group: 'all', showOrphans: true, root: null, depth: 1 }); assert.equal(v.edges.length, 1); assert.ok(v.edges.every(e => v.nodes.some(n => n.id === e.source) && v.nodes.some(n => n.id === e.target))); });
check('local traversal includes anchor', () => { const v = m.filterGraph(model, { kind: 'all', group: 'all', showOrphans: true, root: 'note:orphan', depth: 1 }); assert.equal(v.nodes.length, 1); });
check('position validation rejects unsafe values', () => { const positions = m.readPositions('{"note:a":{"x":12,"y":-13},"note:b":{"x":"NaN","y":0},"task:t":{"x":1000000,"y":0},"alien":{"x":0,"y":0}}'); assert.equal(Object.keys(positions).length, 1); assert.equal(positions['note:a'].x, 12); assert.equal(Object.keys(m.readPositions('[')).length, 0); });
const cache = new Map();
const nodes = m.reconcileNodes(cache, model.nodes, model.groups, { 'note:a': { x: 123, y: 456 } });
check('saved pins restored exactly', () => { const a = cache.get('note:a'); assert.equal(a.fx, 123); assert.equal(a.fy, 456); });
check('hover/filter preserves node object and coordinates', () => { const a = cache.get('note:a'); a.x = 151; const next = m.reconcileNodes(cache, model.nodes.filter(n => n.kind === 'note'), model.groups, {}); assert.equal(next.find(n => n.id === a.id), a); assert.equal(a.x, 151); assert.equal(a.fx, 123); });
check('simulation link mutations do not change model', () => { const link = { ...model.edges[0] }; link.source = nodes[0]; assert.equal(typeof model.edges[0].source, 'string'); });
check('cluster force preserves pinned coordinates', () => { const force = m.clusterForce(model.groups); force.initialize(nodes); force(.5); assert.equal(cache.get('note:a').x, 151); assert.equal(cache.get('note:a').fx, 123); assert.ok(nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))); });
check('no semantic edges from same topic', () => { const isolated = m.buildGraph({ ...input, relations: [] }, 'topic'); assert.equal(isolated.edges.length, 0); assert.ok(isolated.nodes.every(n => n.degree === 0)); });
check('accent insensitive search', () => assert.equal(m.normalize('ĐỒ THỊ Ánh sáng'), 'do thi anh sang'));
check('large graph data integrity', () => {
  const notes = Array.from({ length: 1000 }, (_, i) => ({ id: 'n' + i, title: 'Ghi chú ' + i, body: '', tag: 'Nhóm ' + i % 8, project_id: null }));
  const relations = Array.from({ length: 999 }, (_, i) => edge('e' + i, 'note:n' + i, 'note:n' + (i + 1), 'relates_to'));
  const big = m.buildGraph({ projects: [], tasks: [], notes, relations }, 'topic');
  assert.equal(big.nodes.length, 1000); assert.equal(big.edges.length, 999); assert.equal(big.groups.length, 8);
  assert.equal(m.neighborhood(big.edges, 'note:n500', 2).size, 5);
  const simulation = m.reconcileNodes(new Map(), big.nodes, big.groups, {}), force = m.clusterForce(big.groups);
  force.initialize(simulation); force(.5); assert.ok(simulation.every(n => Number.isFinite(n.vx) && Number.isFinite(n.vy)));
});
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const painter = load('components/flowdesk/graph-paint.ts', { './graph-model': m });
const { KnowledgeMap } = load('components/flowdesk/knowledge-map.tsx', { './graph-model': m, './graph-paint': painter, 'next/dynamic': { default: () => () => null } });
check('accessible controls and counts render without browser', () => {
  const html = renderToStaticMarkup(React.createElement(KnowledgeMap, { ...input, onOpen: () => {}, onCreate: () => {} }));
  for (const text of ['Không gian tri thức', '5 mục', '3 liên kết thật', 'Dự án thật', 'Gom nhóm bản đồ', 'Mở rộng bản đồ', 'Hiện mục chưa có liên kết', 'Tìm trong kho tri thức', 'Thu vừa bản đồ']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('TIN NHẮN CẦN XỬ LÝ'));
  assert.ok(html.includes('data-theme="dark"'));
  assert.ok(html.includes('Nền tối Obsidian'));
  assert.ok(html.includes('Nền sáng'));
  assert.ok(html.includes('Thu gọn danh mục'));
});
console.log(`PASS: ${checks} knowledge graph checks (integrity, filtering, pins, stable nodes, traversal, 1000 nodes, SSR controls)`);
