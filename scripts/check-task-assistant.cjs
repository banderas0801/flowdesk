const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const fixedNow = new Date('2026-10-16T15:20:00Z');
let llmCalls = 0;
const env = { TELEGRAM_CHAT_ID: '123', FLOWDESK_OWNER_ID: 'owner-a', NODE_ENV: 'production' };
function load(file, overrides = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: mod.exports, module: mod, require: n => overrides[n] || require(n), Date, Intl, console, process: { env }, crypto: require('node:crypto').webcrypto, Request, Response, AbortSignal, fetch: async () => { llmCalls++; throw new Error('LLM forbidden in task reads'); } });
  return mod.exports;
}
const dates = load('components/flowdesk/task-model.ts');
const m = load('app/lib/task-assistant.ts', { '../../components/flowdesk/task-model': dates });
const task = (id, patch = {}) => ({ id, title: id, description: '', status: 'todo', priority: 'Vừa', project_id: null, project_name: null, due_at: null, planned_date: null, completed_at: null, checklist: '[]', ...patch });
const tasks = [
  task('overdue', { title: 'POV', due_at: '2026-09-13T16:00' }),
  task('today', { planned_date: '2026-10-16' }),
  task('late-tonight', { due_at: '2026-10-16T23:59' }),
  task('tomorrow', { due_at: '2026-10-17' }),
  task('offset-tomorrow', { due_at: '2026-10-16T18:00:00Z' }),
  task('doing', { status: 'doing' }), task('unscheduled'),
  task('done-today', { status: 'done', due_at: '2026-09-13', completed_at: '2026-10-16T10:00:00Z' }),
  task('legacy-done', { status: 'done' }),
  task('deleted', { deleted_at: '2026-10-01', due_at: '2026-09-13' }),
];
const ids = query => m.selectAssistantTasks(tasks, query, fixedNow).map(t => t.id);
for (const text of ['nay có việc nào chưa hoàn thành vậy', 'Hôm nay còn những việc gì?', 'hôm nay cần làm gì', '/today@doanflow_bot']) assert.equal(m.taskQueryIntent(text).kind, 'today', text);
for (const [text, kind] of [['việc nào quá hạn?', 'overdue'], ['Có bao nhiêu việc chưa hoàn thành?', 'open'], ['/tasks', 'open'], ['Mai có việc gì?', 'tomorrow'], ['/doing', 'doing'], ['Những việc đã hoàn thành hôm nay?', 'done'], ['Xem kế hoạch tuần này', 'week']]) assert.equal(m.taskQueryIntent(text).kind, kind, text);
for (const text of ['Mai gọi anh Nam', 'Tạo công việc kiểm tra ngày mai', 'Nhắc tôi xem việc nào quá hạn', 'Đã xong: POV', 'Ý tưởng cho việc viết sách', 'alo', 'Công việc là gì trong vật lý?']) {
  assert.equal(m.taskQueryIntent(text), null, text);
}
const inputBefore = JSON.stringify(tasks);
assert.ok(ids({ kind: 'today' }).includes('overdue'));
assert.ok(ids({ kind: 'today' }).includes('doing'));
assert.ok(!ids({ kind: 'today' }).includes('tomorrow'));
assert.ok(!ids({ kind: 'today' }).includes('done-today'));
assert.ok(!ids({ kind: 'today' }).includes('unscheduled'));
assert.deepEqual([...ids({ kind: 'overdue' })], ['overdue']);
assert.deepEqual([...ids({ kind: 'tomorrow' })].sort(), ['offset-tomorrow', 'tomorrow']);
assert.deepEqual([...ids({ kind: 'done', todayOnly: true })], ['done-today']);
assert.ok(ids({ kind: 'open' }).includes('unscheduled'));
assert.ok(!ids({ kind: 'open' }).includes('deleted'));
assert.equal(JSON.stringify(tasks), inputBefore);
assert.ok(m.taskQueryReply([], { kind: 'today' }, fixedNow).includes('/tasks'));
const exact = m.taskQueryReply(tasks.slice(0, 1), m.taskQueryIntent('nay có việc nào chưa hoàn thành vậy'), fixedNow);
assert.ok(exact.includes('POV')); assert.ok(exact.includes('1 quá hạn')); assert.ok(exact.includes('16:00')); assert.ok(exact.includes('13/09/2026'));
const many = Array.from({ length: 60 }, (_, i) => task('n' + i, { title: 'Dài'.repeat(1000), project_name: 'Tên'.repeat(1000) }));
const bounded = m.taskQueryReply(many, { kind: 'open' }, fixedNow);
assert.ok(bounded.length < 4000); assert.ok(bounded.includes('việc khác'));
// Vietnam midnight changes daily plan selection, regardless of runtime timezone.
const midnight = new Date('2026-10-16T17:01:00Z');
assert.ok(m.selectAssistantTasks(tasks, { kind: 'today' }, midnight).some(t => t.id === 'tomorrow'));

let sqlLog = [], failure = false;
const db = { prepare(sql) {
  assert.ok(/^\s*SELECT/.test(sql), 'read query must not create or update records');
  return { bind(owner) { sqlLog.push({ sql, owner }); return { async all() {
    if (failure) throw new Error('D1 unavailable');
    assert.equal(owner, 'owner-a'); assert.ok(sql.includes('t.owner_id = ?')); assert.ok(sql.includes('p.owner_id = t.owner_id'));
    return { results: tasks.filter(t => !t.deleted_at) };
  } }; } };
} };
const intents = load('app/lib/telegram-intents.ts');
const telegram = load('app/lib/telegram-inbox.ts', { './telegram-intents': intents, './task-assistant': m, './gemini': {}, './graphiti': {} });
let authenticated = true;
const web = load('app/api/chat/route.ts', { '../../../db': { getRawDb: () => db }, '../../chatgpt-auth': { getChatGPTUser: async () => authenticated ? { userId: 'owner-a' } : null }, '../../lib/knowledge': {}, '../../lib/gemini': {}, '../../lib/task-assistant': m });
(async () => {
  const reply = await telegram.processTelegramText(db, 123, 'nay có việc nào chưa hoàn thành vậy');
  assert.ok(reply.includes('POV')); assert.equal(llmCalls, 0);
  const reads = sqlLog.length;
  const ignored = await telegram.processTelegramText(db, 999, '/tasks');
  assert.ok(ignored.includes('chưa được cấp quyền')); assert.equal(sqlLog.length, reads);
  const response = await web.POST(new Request('https://flowdesk.test/api/chat', { method: 'POST', body: JSON.stringify({ provider: 'openrouter', message: 'nay có việc nào chưa hoàn thành vậy' }) }));
  assert.equal(response.status, 200); assert.ok((await response.json()).reply.includes('POV')); assert.equal(llmCalls, 0);
  authenticated = false;
  const denied = await web.POST(new Request('https://flowdesk.test/api/chat', { method: 'POST', body: JSON.stringify({ message: '/tasks' }) }));
  assert.equal(denied.status, 401);
  failure = true;
  const failedReply = await telegram.processTelegramText(db, 123, '/today'); assert.ok(failedReply.includes('Không đọc được'));
  assert.ok(!failedReply.includes('Không có công việc phù hợp'));
  assert.equal(llmCalls, 0);
  console.log('PASS: task intent routing, capture exclusions, real task replies, overdue/today/tomorrow/completed, VN midnight, bounded replies, Telegram + web handlers, owner/chat isolation, no writes, no LLM, database failure reporting');
})().catch(error => { console.error(error); process.exitCode = 1; });
