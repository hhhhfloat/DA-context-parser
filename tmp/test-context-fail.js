// 自测：解析工具调用失败 + 按工具总类/失败类别筛选与导出
// 运行：node context-parser/tmp/test-context-fail.js
// 方式：DOM 打桩加载 script.js，通过事件回调驱动真实前端流程（无需改动业务代码）
'use strict';

const fs = require('fs');
const path = require('path');
const projectDir = path.dirname(__dirname);
const parser = require(path.join(projectDir, 'parse.js'));

let pass = 0;
let fail = 0;
function check(cond, label, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + label + (extra ? ' -> ' + extra : ''));
  }
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}

// ============ 1. 后端：失败判定（用例覆盖 tools 包各类返回文本） ============
const upDir = '..';
const CASES = [
  { name: 'read_file', args: { filename: 'a.js' }, result: '📄 文件 a.js 内容已阅读\nhello', status: 'ok', kind: '' },
  { name: 'read_file', args: { filename: 'miss.js' }, result: '❌ 文件不存在: miss.js', status: 'fail', kind: 'notfound' },
  { name: 'write_file', args: { filename: 'x.js', code: 'a' }, result: '❌ 只能写入工作项目 [game]，当前路径: other/x.js', status: 'fail', kind: 'access' },
  { name: 'build_anchor_index', args: { project_path: 'other' }, result: '❌ 只能操作工作项目 [game]，当前: other', status: 'fail', kind: 'access' },
  { name: 'read_file', args: { filename: '.anchors.json' }, result: '❌ 不允许访问以 . 开头的文件/目录：.anchors.json。如需项目结构信息，请使用 describe_anchors / get_file_structure。', status: 'fail', kind: 'access' },
  { name: 'read_file', args: { filename: 'a.js' }, result: '❌ 路径中不允许出现 ".."：' + upDir + '/a.js', status: 'fail', kind: 'access' },
  { name: 'read_file', args: { filename: 'UPDATE.md' }, result: '❌ UPDATE.md 不支持完整读取。请使用 read_between_anchors 按锚点读取。', status: 'fail', kind: 'access' },
  { name: 'delete_file', args: { filename: 'tmp' }, result: '⚠️ 不能删除目录，请仅删除单个文件（如需删除目录，可手动操作）。', status: 'fail', kind: 'access' },
  { name: 'insert_at_anchor', args: { content: 'x' }, result: '❌ 缺少参数 anchor_id', status: 'fail', kind: 'arg' },
  { name: 'mystery_tool', args: {}, result: '未知工具: mystery_tool', status: 'fail', kind: 'arg' },
  { name: 'compile_and_run', args: { filename: 'game' }, result: '❌ 安全扫描拦截:\n[ERROR] 命中规则: 系统命令', status: 'fail', kind: 'security' },
  { name: 'compile_and_run', args: { filename: 'A.java' }, result: '编译失败 (退出码 1):\nA.java:3: error: bad', status: 'fail', kind: 'compile' },
  { name: 'compile_and_run', args: { filename: 'B.java' }, result: '⏱️ Java 编译超时（60秒），已强制终止。\n输出:\n', status: 'fail', kind: 'compile' },
  { name: 'compile_and_run', args: { filename: 'pom.xml' }, result: '✅ Maven 编译成功！但未找到包含 main 方法的类，无法运行。\n输出:\n', status: 'fail', kind: 'compile' },
  { name: 'compile_and_run', args: { filename: 'C.java' }, result: '⏱️ 运行超时（超过30秒），已强制终止。\n输出:\n', status: 'fail', kind: 'run' },
  { name: 'compile_and_run', args: { filename: 'D.java' }, result: '⛔ 运行阻塞（疑似等待标准输入）: \n> ', status: 'fail', kind: 'run' },
  { name: 'compile_and_run', args: { filename: 'E.java' }, result: '✅ Maven 编译成功！但运行失败 (退出码 1):\nboom', status: 'fail', kind: 'run' },
  { name: 'compile_and_run', args: { filename: 'App.java' }, result: '⚠️ JavaFX 应用启动后立即退出，可能有错误。\n输出:\n', status: 'fail', kind: 'run' },
  { name: 'write_file', args: { filename: 'a.js', code: 'x' }, result: '写入文件失败: Access denied', status: 'fail', kind: 'io' },
  { name: 'get_file_structure', args: { filename: 'a.js' }, result: '❌ 解析文件结构失败: boom', status: 'fail', kind: 'io' },
  { name: 'build_anchor_index', args: { project_path: 'game' }, result: '❌ 重建锚点索引失败: boom', status: 'fail', kind: 'io' },
  { name: 'delete_between_anchors', args: {}, result: '⚠️ 两个锚点之间没有内容可删除', status: 'fail', kind: 'state' },
  { name: 'read_between_anchors', args: {}, result: '⚠️ 两个锚点之间没有内容可读取', status: 'fail', kind: 'state' },
  { name: 'list_directory', args: { path: 'nope' }, result: '路径不存在或不是目录: nope', status: 'fail', kind: 'notfound' },
  { name: 'describe_anchors', args: { project_path: 'demo', file: '.' }, result: '📌 demo 不存在，或没有锚点记录。\n\n', status: 'fail', kind: 'notfound' },
  { name: 'describe_anchors', args: { project_path: 'demo', file: '.' }, result: '📌 项目 demo 尚无项目索引。请先运行 build_anchor_index。', status: 'fail', kind: 'notfound' },
  { name: 'read_between_anchors', args: {}, result: '❌ 在文件 a.md 中未找到唯一锚点: intro', status: 'fail', kind: 'notfound' },
  { name: 'search_text', args: { keyword: 'foo' }, result: '🔍 未找到匹配 "foo" 的内容。', status: 'empty', kind: 'empty' },
  { name: 'find_callers', args: { functionName: 'bar' }, result: '🔍 未找到函数 "bar" 的调用点。', status: 'empty', kind: 'empty' },
  { name: 'read_file', args: { filename: 'parse.js' }, result: "📄 文件 parse.js 内容已阅读\nconst msg = '❌ 文件不存在: fake';", status: 'ok', kind: '' },
  { name: 'read_file', args: { filename: 'noresult.js' }, result: null, status: 'none', kind: '' }
];

const TOTAL = CASES.length;            // 31
const EXPECT_FAIL = 26;
const EXPECT_EMPTY = 2;
const EXPECT_NONE = 1;
const READ_CALLS = 15;
const COMPILE_CALLS = 8;
const ACCESS_FAILS = 6;

const toolCalls = CASES.map((c, i) => ({
  id: 'call_' + i,
  type: 'function',
  function: { name: c.name, arguments: JSON.stringify(c.args) }
}));
const messages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '跑一批工具' },
  { role: 'assistant', content: '', tool_calls: toolCalls }
];
CASES.forEach((c, i) => {
  if (c.result == null) return;
  messages.push({ role: 'tool', tool_call_id: 'call_' + i, content: c.result });
});

const jsonl = JSON.stringify({
  type: 'request',
  timestamp: '2026-01-01T00:00:00.000Z',
  body: { messages: messages, tools: [{ function: { name: 'read_file' } }] }
});
const parsed = parser.analyzeRaw(Buffer.from(jsonl, 'utf8'), 'synthetic.jsonl');

console.log('== 1. 后端失败判定 ==');
const calls = parsed.iterations[0].calls;
check(calls.length === TOTAL, '调用数一致', calls.length + ' vs ' + TOTAL);
CASES.forEach((c, i) => {
  const got = calls[i];
  check(got.status === c.status && got.failKind === c.kind, 'case#' + i + ' ' + c.name, got.status + '/' + got.failKind);
});
check(parsed.summary.failedCalls === EXPECT_FAIL, '失败数', String(parsed.summary.failedCalls));
check(parsed.summary.emptyCalls === EXPECT_EMPTY, '未找到数', String(parsed.summary.emptyCalls));
check(parsed.summary.noneCalls === EXPECT_NONE, '无记录数', String(parsed.summary.noneCalls));
check(parsed.iterations[0].failCalls === EXPECT_FAIL, '迭代失败计数', String(parsed.iterations[0].failCalls));
check(parsed.failures.byKind.reduce((s, k) => s + k.calls, 0) === EXPECT_FAIL, '类别次数合计');
check(parsed.failures.byTool.reduce((s, t) => s + t.calls, 0) === EXPECT_FAIL, '工具次数合计');
const accessStat = parsed.failures.byKind.filter((k) => k.kind === 'access')[0];
check(!!accessStat && accessStat.calls === ACCESS_FAILS, 'access 类别次数', accessStat && String(accessStat.calls));
check(parsed.toolStats.some((t) => t.failed > 0), '工具统计含失败数');
check(parsed.summary.totalChars > 0, '字符合计仍统计');
console.log('  byKind: ' + parsed.failures.byKind.map((k) => k.label + '×' + k.calls).join(', '));
console.log('  byTool: ' + parsed.failures.byTool.map((t) => t.name + '×' + t.calls).join(', '));

// 真实日志回归
const exampleDir = path.join(projectDir, 'example');
fs.readdirSync(exampleDir)
  .filter((f) => f.endsWith('.jsonl'))
  .forEach((name) => {
    const r = parser.analyzeRaw(fs.readFileSync(path.join(exampleDir, name)), name);
    console.log('  真实日志 ' + name + '：调用 ' + r.summary.toolCalls + '，失败 ' +
      r.summary.failedCalls + '，合计字符 ' + r.summary.totalChars);
    check(r.summary.toolCalls > 0, '真实日志可解析');
  });

// ============ 2. 前端：DOM 打桩端到端（上传 → 筛选 → 导出） ============
let lastBlob = null;
let downloaded = null;

function makeEl(id) {
  const node = {
    id: id,
    hidden: false,
    innerHTML: '',
    textContent: '',
    className: '',
    title: '',
    value: '',
    checked: false,
    href: '',
    download: '',
    style: {},
    children: [],
    listeners: {},
    dataset: {},
    classList: { add: function () {}, remove: function () {} },
    addEventListener: function (type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    appendChild: function (child) {
      this.children.push(child);
    },
    removeChild: function () {},
    click: function () {
      downloaded = { name: this.download, text: lastBlob ? lastBlob.parts[0] : '' };
    },
    fire: function (type, event) {
      const usable = event && (event.target || typeof event.preventDefault === 'function');
      const evt = usable ? event : { target: this };
      (this.listeners[type] || []).forEach((fn) => fn(evt));
    }
  };
  return node;
}

const els = {};
const kindBoxes = ['read', 'write', 'compile', 'other'].map((k) => {
  const n = makeEl('kind-' + k);
  n.dataset.kind = k;
  n.checked = true;
  return n;
});
const statusRadios = ['all', 'ok', 'fail', 'empty', 'none'].map((v) => {
  const n = makeEl('status-' + v);
  n.value = v;
  n.checked = v === 'all';
  const baseFire = n.fire;
  n.fire = function (type, event) {
    if (type === 'change') statusRadios.forEach((r) => { r.checked = r === n; });
    baseFire.call(n, type, event);
  };
  return n;
});
const exportBtns = ['json', 'compact', 'csv', 'md', 'txt'].map((v) => {
  const n = makeEl('export-' + v);
  n.dataset.export = v;
  return n;
});

global.document = {
  getElementById: function (id) {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  },
  querySelectorAll: function (sel) {
    if (sel === 'input[data-kind]') return kindBoxes;
    if (sel === 'input[name="statusFilter"]') return statusRadios;
    if (sel === 'button[data-export]') return exportBtns;
    return [];
  },
  createElement: function () {
    return makeEl('created');
  },
  body: makeEl('body')
};
global.btoa = function (binary) {
  return Buffer.from(binary, 'binary').toString('base64');
};
global.Blob = function (parts, opts) {
  this.parts = parts;
  this.type = opts && opts.type;
};
global.URL = {
  createObjectURL: function (blob) {
    lastBlob = blob;
    return 'blob:test';
  },
  revokeObjectURL: function () {}
};
global.fetch = async function (url) {
  if (String(url).indexOf('/api/parse') === 0) {
    return { ok: true, json: async function () { return parsed; } };
  }
  return { ok: true, json: async function () { return { files: [] }; } };
};

function fakeFile(name) {
  return {
    name: name,
    arrayBuffer: async function () {
      return Buffer.from(jsonl, 'utf8');
    }
  };
}
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

require(path.join(projectDir, 'script.js'));

(async function run() {
  console.log('== 2. 前端端到端（DOM 打桩） ==');
  els.dropZone.fire('drop', { preventDefault: function () {}, dataTransfer: { files: [fakeFile('synthetic.jsonl')] } });
  await tick();
  await tick();

  check(els.status.textContent.indexOf('已解析') === 0, '上传后状态提示', els.status.textContent);
  check(els.status.textContent.indexOf('失败 ' + EXPECT_FAIL) > 0, '状态提示含失败次数', els.status.textContent);
  check(count(els.summaryCards.innerHTML, 'card__label') === 11, '汇总卡片 11 张', String(count(els.summaryCards.innerHTML, 'card__label')));
  check(els.summaryCards.innerHTML.indexOf('失败调用') > 0, '汇总含失败调用卡片');
  check(els.failStats.innerHTML.indexOf('全部调用') > 0, '默认汇总口径为全部');
  check(els.failStats.innerHTML.indexOf('路径或工作区限制') > 0, '失败类别条含类别标签');
  check(els.failStats.innerHTML.indexOf('失败来源工具') > 0, '失败来源工具条');
  check(els.failKindGroup.hidden === false, '失败类别控件可见');
  check(els.failKinds.children.length === parsed.failures.byKind.length, '类别复选项数量', String(els.failKinds.children.length));
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL, '默认渲染全部调用', String(count(els.iterations.innerHTML, 'class="call call--')));
  check(els.iterations.innerHTML.indexOf('fail-badge') > 0, '失败调用徽标');
  check(els.iterations.innerHTML.indexOf('失败信息') > 0, '失败原因面板');

  // 2.1 调用结果筛选
  statusRadios.filter((r) => r.value === 'fail')[0].fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === EXPECT_FAIL, '仅失败渲染 ' + EXPECT_FAIL, String(count(els.iterations.innerHTML, 'class="call call--')));
  check(els.iterations.innerHTML.indexOf('status-badge') < 0, '失败模式无其它状态徽标');
  statusRadios.filter((r) => r.value === 'empty')[0].fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === EXPECT_EMPTY, '仅未找到渲染 ' + EXPECT_EMPTY);
  check(els.iterations.innerHTML.indexOf('未找到') > 0, '未找到徽标');
  statusRadios.filter((r) => r.value === 'none')[0].fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === EXPECT_NONE, '仅无记录渲染 ' + EXPECT_NONE);
  statusRadios.filter((r) => r.value === 'ok')[0].fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL - EXPECT_FAIL - EXPECT_EMPTY - EXPECT_NONE, '仅成功渲染 2');
  statusRadios.filter((r) => r.value === 'all')[0].fire('change', {});

  // 2.2 失败类别筛选（事件委托：容器 change）
  els.failKinds.fire('change', { target: { dataset: { failkind: 'access' }, checked: false } });
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL - ACCESS_FAILS, '排除 access 类别', String(count(els.iterations.innerHTML, 'class="call call--')));
  check(els.failStats.innerHTML.indexOf('当前筛选结果') > 0, '筛选后汇总口径联动');
  els.failKinds.fire('change', { target: { dataset: { failkind: 'access' }, checked: true } });
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL, '恢复 access 类别');

  // 2.3 工具总类筛选
  const readBox = kindBoxes.filter((k) => k.dataset.kind === 'read')[0];
  readBox.checked = false;
  readBox.fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL - READ_CALLS, '排除读入类调用', String(count(els.iterations.innerHTML, 'class="call call--')));
  readBox.checked = true;
  readBox.fire('change', {});
  const compileBox = kindBoxes.filter((k) => k.dataset.kind === 'compile')[0];
  compileBox.checked = false;
  compileBox.fire('change', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === TOTAL - COMPILE_CALLS, '排除编译类调用');
  compileBox.checked = true;
  compileBox.fire('change', {});

  // 2.4 工具名与最小字符
  els.toolNameFilter.value = 'compile_and_run';
  els.toolNameFilter.fire('input', {});
  check(count(els.iterations.innerHTML, 'class="call call--') === COMPILE_CALLS, '工具名筛选');
  els.toolNameFilter.value = '';
  els.toolNameFilter.fire('input', {});
  els.minChars.value = '30';
  els.minChars.fire('input', {});
  check(count(els.iterations.innerHTML, 'class="call call--') < TOTAL, '最小字符筛选生效');
  els.minChars.value = '0';
  els.minChars.fire('input', {});

  // 2.5 导出
  els.exportFiltered.checked = true;
  exportBtns.filter((b) => b.dataset.export === 'csv')[0].fire('click', {});
  const csv = String(downloaded.text).split('\r\n');
  check(csv[0].split('","').length === 10, 'CSV 10 列', csv[0]);
  check(csv[0].indexOf('"状态"') > 0 && csv[0].indexOf('"失败类别"') > 0 && csv[0].indexOf('"失败原因"') > 0, 'CSV 含状态/类别/原因列');
  check(csv.slice(1).filter((r) => r.length).length === TOTAL, 'CSV 数据行数', String(csv.slice(1).filter((r) => r.length).length));
  check(csv.some((r) => r.indexOf('"失败"') > 0 && r.indexOf('"参数缺失或非法"') > 0), 'CSV 输出失败记录');
  check(downloaded.name.indexOf('.csv') > 0, 'CSV 文件名', downloaded.name);

  exportBtns.filter((b) => b.dataset.export === 'md')[0].fire('click', {});
  check(String(downloaded.text).indexOf('| 状态 | 失败类别 | 失败原因 |') > 0, 'Markdown 状态列');
  check(String(downloaded.text).indexOf('- 失败类别：') > 0, 'Markdown 失败类别摘要');

  exportBtns.filter((b) => b.dataset.export === 'txt')[0].fire('click', {});
  check(String(downloaded.text).indexOf('[失败·') > 0, '纯文本失败行');

  exportBtns.filter((b) => b.dataset.export === 'compact')[0].fire('click', {});
  const compact = JSON.parse(downloaded.text);
  const flat = compact.iterations.reduce((acc, it) => acc.concat(it.calls), []);
  check(flat.length === TOTAL, '精简 JSON 调用数', String(flat.length));
  check(flat.filter((c) => c.failed).length === EXPECT_FAIL, '精简 JSON 失败标记');
  check(flat.filter((c) => c.failed).every((c) => c.failReason && c.failReason.length > 0), '失败原因非空');
  check(!!compact.failures && compact.failures.byKind.length > 0, '精简 JSON 含 failures 汇总');

  exportBtns.filter((b) => b.dataset.export === 'json')[0].fire('click', {});
  const full = JSON.parse(downloaded.text);
  check(!!full.failures && full.failures.calls === EXPECT_FAIL, '完整 JSON 含 failures 汇总');
  check(full.iterations[0].calls[1].status === 'fail' && full.iterations[0].calls[1].failKind === 'notfound', '完整 JSON 保留状态字段');

  // 2.6 合并同名连续调用
  els.mergeSame.checked = true;
  els.mergeSame.fire('change', {});
  check(els.iterations.innerHTML.indexOf('合并') > 0, '合并模式渲染');
  check(els.iterations.innerHTML.indexOf('失败') > 0, '合并后仍标记失败');
  els.mergeSame.checked = false;
  els.mergeSame.fire('change', {});

  // 2.7 index.html 与 script.js 的关键 id/控件对应
  const html = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  const ids = ['failStats', 'failKinds', 'failKindGroup', 'summaryCards', 'toolStats', 'iterations',
    'toolNameFilter', 'minChars', 'onlyToolIters', 'mergeSame', 'exportFiltered', 'exportArgs',
    'exportResult', 'dropZone', 'fileInput', 'exampleList', 'status', 'summary', 'controls'];
  ids.forEach((id) => {
    check(html.indexOf('id="' + id + '"') > 0, 'index.html 含 id=' + id);
  });
  check(html.indexOf('name="statusFilter"') > 0, 'index.html 含调用结果单选组');
  check(html.indexOf('data-kind="read"') > 0, 'index.html 含工具总类复选');

  console.log('\n结果：pass=' + pass + ' fail=' + fail);
  if (fail > 0) process.exitCode = 1;
})();
