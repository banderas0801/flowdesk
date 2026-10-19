const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
let clock=new Date("2026-10-13T16:59:59Z").getTime();
class ClockDate extends Date { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} }
const timers=new Map(),listeners=new Map();let timerId=0,state,cleanup;
const surface=prefix=>({visibilityState:"visible",addEventListener:(name,fn)=>listeners.set(prefix+name,fn),removeEventListener:(name)=>listeners.delete(prefix+name)});
const doc=surface("document:"),win=surface("window:");
function load(file,overrides={}){const mod={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(js,{exports:mod.exports,module:mod,require:n=>overrides[n]||require(n),Date:ClockDate,Intl,document:doc,window:win,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)});return mod.exports;}
const model=load("components/flowdesk/task-model.ts");
const extra=load("components/flowdesk/additional-quotes.ts");
const data=load("components/flowdesk/daily-quote-data.ts",{"./task-model":model,"./additional-quotes":extra});
assert.equal(data.quoteForDate(new Date("2026-10-12T17:00:00Z")).date,"2026-10-13");
assert.ok(data.dailyQuotes.length>=100);
const batch=Array.from({length:data.dailyQuotes.length},(_,i)=>data.quoteForDate(new Date(Date.parse("2026-10-12T17:00:00Z")+86400000*i)).quote.text);
assert.equal(new Set(batch).size,data.dailyQuotes.length);
for(let i=0;i<400;i++){const now=new Date(Date.parse("2026-10-12T17:00:00Z")+86400000*i);assert.notEqual(data.quoteForDate(now).index,data.quoteForDate(new Date(+now+86400000)).index);}
assert.equal(data.quoteForDate(new Date("2026-10-13T01:00:00Z")).index,data.quoteForDate(new Date("2026-10-13T16:59:59Z")).index);
assert.equal(data.nextQuoteRefreshDelay(),1050);
assert.ok(data.dailyQuotes.every(q=>q.author&&q.source&&q.url.startsWith("https://")));
const react={...require("react"),useState:fn=>{state=fn();return[state,fn=>{state=typeof fn==="function"?fn(state):fn;}];},useEffect:fn=>{cleanup=fn();}};
const component=load("components/flowdesk/daily-quote.tsx",{"react":react,"./daily-quote-data":data});
component.DisciplineQuote();
assert.equal(state.date,"2026-10-13");
clock=Date.parse("2026-10-13T17:00:00Z");
[...timers.values()][0].fn();assert.equal(state.date,"2026-10-14");
clock=Date.parse("2026-10-16T03:00:00Z");listeners.get("window:focus")();assert.equal(state.date,"2026-10-16");
clock=Date.parse("2026-10-17T03:00:00Z");listeners.get("document:visibilitychange")();assert.equal(state.date,"2026-10-17");
cleanup();assert.equal(timers.size,0);assert.equal(listeners.size,0);
console.log("PASS: "+data.dailyQuotes.length+" unique quotes, daily stability, 400 consecutive-day transitions, Vietnam midnight, wake/focus refresh and cleanup");
