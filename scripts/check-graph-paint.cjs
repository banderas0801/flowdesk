const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const path = require('node:path'), { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
function load(file, overrides = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: mod.exports, module: mod, require: n => overrides[n] || require(n), Date, console });
  return mod.exports;
}
const model = load('components/flowdesk/graph-model.ts');
const paint = load('components/flowdesk/graph-paint.ts', { './graph-model': model });
const calls = [];
const ctx = new Proxy({ font: '11px sans-serif', measureText(text) { return { width: text.length * parseFloat(this.font.match(/[\d.]+px/)?.[0] || '11') * .55 }; }, createRadialGradient() { return { addColorStop() {} }; } }, { get(target, key) { if (key in target) return target[key]; return (...args) => calls.push([key, ...args]); } });
const node = { id: 'note:a', refId: 'a', kind: 'note', label: 'Một ghi chú có ý nghĩa', body: '', meta: '', group: 'g', groupLabel: 'Nhóm', color: '#8b6eb2', degree: 2, x: 0, y: 0 };
for (const theme of ['dark', 'light']) for (const scale of [.1, .5, 1, 2, 8]) for (const kind of ['project', 'task', 'note']) {
  const n = { ...node, kind };
  assert.ok(paint.nodeRadius(n, scale) * scale <= 7.001, 'node must not grow huge when zoomed');
  paint.paintNode(n, ctx, scale, theme, n.id, new Set([n.id]));
}
for (const theme of ['dark', 'light']) {
  const map = new Map([[node.id, node]]);
  const count = paint.paintLabels(ctx, 1, { theme, nodes: [node], groups: [], members: new Map(), activeId: null, neighbors: null, nodeMap: map });
  assert.equal(count, 1, 'sparse graph should name every non-overlapping node');
}
assert.ok(!calls.some(call => call[0] === 'fillRect'), 'labels should never cover graph with rectangular cards');
assert.ok(calls.some(call => call[0] === 'strokeText'), 'labels use glyph outlines');
const camera = paint.cameraFrame([node], 1200, 700);
assert.equal(camera.zoom, 1.65); assert.equal(camera.x, 0); assert.equal(camera.y, 0);
assert.equal(paint.cameraFrame([], 400, 600).zoom, 1);
function luminance(hex) { const c = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
for (const theme of ['dark', 'light']) {
  const style = paint.graphStyle[theme], l1 = luminance(style.text.slice(1)), l2 = luminance(style.background.slice(1));
  assert.ok((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05) >= 4.5, `${theme} labels need readable contrast`);
  assert.match(paint.nodeTone('#a85d73', theme), /^#[\da-f]{6}$/);
}
console.log('PASS: graph paint checks — capped screen size at 5 zooms, sparse labels, glyph outlines, camera limits, dark/light text contrast');

// Optional internal raster checks use the same renderer and physics as the app,
// without a browser or web preview. Fixtures are never saved to the workspace DB.
async function renderFixtures(directory) {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  // Native raster QA needs an explicit Unicode font; browsers use system UI.
  for (const file of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
    const fontPath = '/usr/share/fonts/truetype/dejavu/' + file;
    if (fs.existsSync(fontPath)) GlobalFonts.registerFromPath(fontPath, 'Arial');
  }
  const r = createRequire(require.resolve('react-force-graph-2d')), f = createRequire(r.resolve('force-graph'));
  const { forceSimulation, forceLink, forceManyBody } = await import(pathToFileURL(f.resolve('d3-force-3d')));
  fs.mkdirSync(directory, { recursive: true });
  for (const count of [12, 400]) {
    const projects = ['Sáng tạo nội dung', 'Nghiên cứu & học tập', 'Sản phẩm cá nhân', 'Kiến thức công việc'].map((name, i) => ({ id: 'p' + i, name, goal: '', area: '' }));
    const notes = Array.from({ length: count }, (_, i) => ({ id: 'n' + i, title: ['Thiết kế hệ thống', 'Ghi chép hằng ngày', 'Ý tưởng mới', 'Nguyên tắc thực hiện', 'Tài liệu tham khảo', 'Kế hoạch tuần'][i % 6] + ' ' + (i + 1), body: '', tag: '', project_id: 'p' + i % 4 }));
    const relations = notes.map((n, i) => ({ id: 'r' + i, source_type: 'project', source_id: n.project_id, target_type: 'note', target_id: n.id, relation_type: 'contains' }));
    for (let i = 0; i < count; i++) for (let j = 0; j < 2; j++) { const other = (i + 4 * (1 + model.hash('n' + i + j) % Math.max(1, Math.floor(count / 4) - 1))) % count; if (other !== i) relations.push({ id: `e${i}-${j}`, source_type: 'note', source_id: 'n' + i, target_type: 'note', target_id: 'n' + other, relation_type: 'relates_to' }); }
    const data = model.buildGraph({ projects, tasks: [], notes, relations });
    const cache = new Map(), nodes = model.reconcileNodes(cache, data.nodes, data.groups, {}), links = data.edges.map(e => ({ ...e }));
    const force = forceSimulation(nodes, 2).stop().force('charge', forceManyBody().strength(-90)).force('link', forceLink(links).id(n => n.id).distance(62).strength(.2)).force('cluster', model.clusterForce(data.groups, .006)).velocityDecay(.4).alphaDecay(.035);
    force.tick(150);
    const members = new Map(); for (const n of nodes) { if (!members.has(n.group)) members.set(n.group, []); members.get(n.group).push(n); }
    for (const theme of ['dark', 'light']) {
      const width = 1200, height = 760, canvas = createCanvas(width, height), context = canvas.getContext('2d'), style = paint.graphStyle[theme];
      context.fillStyle = style.background; context.fillRect(0, 0, width, height);
      const frame = paint.cameraFrame(nodes, width, height);
      context.translate(width / 2, height / 2); context.scale(frame.zoom, frame.zoom); context.translate(-frame.x, -frame.y);
      paint.paintClusters(context, theme, members, null);
      context.strokeStyle = style.edge; context.lineWidth = .65 / frame.zoom;
      for (const e of links) { context.beginPath(); context.moveTo(e.source.x, e.source.y); context.lineTo(e.target.x, e.target.y); context.stroke(); }
      for (const n of nodes) paint.paintNode(n, context, frame.zoom, theme, null, null);
      paint.paintLabels(context, frame.zoom, { theme, nodes, groups: data.groups, members, activeId: null, neighbors: null, nodeMap: cache });
      fs.writeFileSync(path.join(directory, `${theme}-${count}.png`), canvas.toBuffer('image/png'));
    }
  }
  console.log('Internal renderer fixtures written to ' + directory);
}
if (process.argv[2] === '--render-dir') renderFixtures(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
