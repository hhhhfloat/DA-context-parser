// @anchor: script_tot_desc
// 前端交互逻辑：上传/拖放上下文文件、调用解析接口、渲染汇总与迭代明细，
// 支持按类型/工具名/字符数筛选，并导出 JSON/CSV/Markdown 等格式。

// @anchor: state_init
// 全局状态：解析结果数据、当前筛选条件（含调用结果与失败类别）与预览截断长度
const state = {
  data: null,
  filters: {
    kinds: { read: true, write: true, compile: true, other: true },
    status: 'all',
    failKinds: {},
    toolName: '',
    minChars: 0,
    onlyToolIters: true,
    mergeSame: false
  }
};

const PREVIEW_LIMIT = 4000;
const KIND_LABEL = { read: '读入', write: '写入', compile: '编译运行', other: '其它' };
const STATUS_LABEL = { ok: '成功', fail: '失败', empty: '未找到', none: '无记录' };

// 选定导出状态：已勾选的轮次（轮次序号）与调用（轮次序号:调用序号）
state.selection = { rounds: new Set(), calls: new Set() };


// @anchor: state_init_end

// @anchor: state_view
// 视图模式：list 调用列表 / rounds 按轮次整理
state.view = 'list';

// @anchor: state_view_end


// @anchor: dom_refs
// 缓存页面关键 DOM 引用
const el = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  exampleList: document.getElementById('exampleList'),
  status: document.getElementById('status'),
  summary: document.getElementById('summary'),
  summaryCards: document.getElementById('summaryCards'),
  toolStats: document.getElementById('toolStats'),
  failStats: document.getElementById('failStats'),
  controls: document.getElementById('controls'),
  iterations: document.getElementById('iterations'),
  toolNameFilter: document.getElementById('toolNameFilter'),
  minChars: document.getElementById('minChars'),
  onlyToolIters: document.getElementById('onlyToolIters'),
  mergeSame: document.getElementById('mergeSame'),
  failKindGroup: document.getElementById('failKindGroup'),
  failKinds: document.getElementById('failKinds'),
  exportFiltered: document.getElementById('exportFiltered'),
  exportArgs: document.getElementById('exportArgs'),
  exportResult: document.getElementById('exportResult')
};

// 导出附加内容开关（推理内容）在原有引用之后补充
el.exportReasoning = document.getElementById('exportReasoning');

// 结果位置开关：勾选后工具结果原文集中到导出文件末尾的附录
el.exportResultAppendix = document.getElementById('exportResultAppendix');

// @anchor: dom_refs_end

// @anchor: dom_refs_rounds
// 轮次视图容器引用（在基础 DOM 引用之后补充）
el.rounds = document.getElementById('rounds');
// @anchor: dom_refs_rounds_end


// @anchor: util_format
// 通用格式化：字节、千分位数字与 HTML 转义
function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clip(s, limit) {
  const t = String(s == null ? '' : s);
  return t.length > limit ? t.slice(0, limit) + '\n…（已截断，共 ' + t.length + ' 字符）' : t;
}
// @anchor: util_format_end

// @anchor: util_base64
// 将 ArrayBuffer 分块转为 base64，避免超长文件触发调用栈溢出
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
// @anchor: util_base64_end

// @anchor: upload_file
// 读取本地文件为 base64 后提交解析接口
async function uploadFile(file) {
  if (!file) return;
  setStatus('读取中：' + file.name + ' …');
  try {
    const buf = await file.arrayBuffer();
    const data = arrayBufferToBase64(buf);
    setStatus('解析中：' + file.name + ' …');
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, data })
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error || '解析失败');
    }
    onData(json, file.name);
  } catch (err) {
    setStatus('错误：' + err.message, 'error');
  }
}
// @anchor: upload_file_end

// @anchor: load_examples
// 拉取示例文件列表并支持一键加载
async function loadExamples() {
  try {
    const res = await fetch('/api/examples');
    const json = await res.json();
    const files = json.files || [];
    if (!files.length) {
      el.exampleList.textContent = '无示例文件';
      return;
    }
    el.exampleList.innerHTML = '';
    files.forEach((name) => {
      const row = document.createElement('div');
      row.className = 'example-item';
      row.innerHTML = '<span>' + escapeHtml(name) + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '加载';
      btn.addEventListener('click', () => loadExample(name));
      row.appendChild(btn);
      el.exampleList.appendChild(row);
    });
  } catch (err) {
    el.exampleList.textContent = '示例加载失败';
  }
}

// 请求后端解析并发返回指定示例文件
async function loadExample(name) {
  setStatus('解析示例：' + name + ' …');
  try {
    const res = await fetch('/api/example?name=' + encodeURIComponent(name));
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || '解析失败');
    onData(json, name);
  } catch (err) {
    setStatus('错误：' + err.message, 'error');
  }
}
// @anchor: load_examples_end

// @anchor: render_entry
// 解析成功后的入口：更新状态、重置选定、初始化失败类别筛选并重绘所有区域
function onData(data, name) {
  state.data = data;
  clearSelection();
  const failText = data.summary.failedCalls
    ? '，失败 ' + fmtNum(data.summary.failedCalls) + ' 次'
    : '';
  setStatus(
    '已解析：' + name + '（' + fmtNum(data.summary.toolCalls) + ' 次工具调用 / ' +
    fmtNum(data.summary.toolIterations) + ' 个工具轮次' + failText + '）',
    'ok'
  );
  el.summary.hidden = false;
  el.controls.hidden = false;
  initFailKinds();
  refresh();
}

function setStatus(text, cls) {
  el.status.textContent = text;
  el.status.className = 'status' + (cls ? ' is-' + cls : '');
}


// @anchor: render_entry_end

// @anchor: fail_filter
// 失败类别筛选：依据解析结果动态生成类别复选项，并提供筛选判定与重绘入口
function initFailKinds() {
  const byKind = (state.data && state.data.failures && state.data.failures.byKind) || [];
  state.filters.failKinds = {};
  if (!el.failKinds) return;
  el.failKinds.innerHTML = '';
  if (!byKind.length) {
    if (el.failKindGroup) el.failKindGroup.hidden = true;
    return;
  }
  if (el.failKindGroup) el.failKindGroup.hidden = false;
  byKind.forEach((fk) => {
    state.filters.failKinds[fk.kind] = true;
    const label = document.createElement('label');
    label.className = 'chk chk--fail';
    label.title = '失败类别：' + (fk.label || fk.kind) + '（' + fmtNum(fk.calls) + ' 次）';
    label.innerHTML =
      '<input type="checkbox" data-failkind="' + escapeHtml(fk.kind) + '" checked /> ' +
      escapeHtml(fk.label || fk.kind) + ' ' + fmtNum(fk.calls);
    el.failKinds.appendChild(label);
  });
}

// 失败类别开关判定：非失败调用恒通过
function failKindAllowed(call) {
  if (call.status !== 'fail') return true;
  const map = state.filters.failKinds || {};
  return map[call.failKind] !== false;
}

// 是否存在会改变汇总口径的筛选条件（工具总类 / 调用结果 / 失败类别 / 工具名 / 最小字符）
function isFilterActive() {
  const f = state.filters;
  if (!(f.kinds.read && f.kinds.write && f.kinds.compile && f.kinds.other)) return true;
  if (f.status !== 'all') return true;
  if (f.toolName.trim()) return true;
  if (f.minChars > 0) return true;
  const map = f.failKinds || {};
  return Object.keys(map).some((k) => map[k] === false);
}

// 重绘汇总与当前视图（调用列表 / 按轮次整理）
function refresh() {
  renderSummary();
  renderView();
}

// @anchor: fail_filter_end


// @anchor: render_summary
// 渲染概览卡片、工具统计条与失败统计；筛选生效时汇总口径随筛选结果联动
function renderSummary() {
  const d = state.data;
  if (!d) return;
  const filtered = isFilterActive();
  const s = filtered ? summarizeView(buildFilteredView()) : d.summary;
  const failures = (filtered ? s.failures : d.failures) || { byKind: [], byTool: [] };
  const items = s.toolStats || d.toolStats || [];

  const cards = [
    { label: '文件大小', value: fmtBytes(d.file.bytes) },
    { label: '请求 / 响应', value: fmtNum(d.file.requests) + ' / ' + fmtNum(d.file.responses) },
    { label: '迭代数', value: fmtNum(d.iterations.length) },
    { label: '工具轮次', value: fmtNum(s.toolIterations) },
    { label: '工具调用数', value: fmtNum(s.toolCalls) },
    { label: '读入字符', value: fmtNum(s.totals.read.chars), cls: 'read' },
    { label: '写入字符', value: fmtNum(s.totals.write.chars), cls: 'write' },
    { label: '编译字符', value: fmtNum(s.totals.compile.chars), cls: 'compile' },
    { label: '失败调用', value: fmtNum(s.failedCalls || 0), cls: 'fail' },
    {
      label: '未找到 / 无记录',
      value: fmtNum(s.emptyCalls || 0) + ' / ' + fmtNum(s.noneCalls || 0),
      cls: 'empty'
    },
    { label: '涉及字符合计', value: fmtNum(s.totalChars) }
  ];
  el.summaryCards.innerHTML = cards
    .map(
      (c) =>
        '<div class="card' + (c.cls ? ' card--' + c.cls : '') + '">' +
        '<div class="card__label">' + escapeHtml(c.label) + '</div>' +
        '<div class="card__value">' + escapeHtml(c.value) + '</div></div>'
    )
    .join('');

  const colorVar = { read: 'var(--read)', write: 'var(--write)', compile: 'var(--compile)', other: 'var(--other)' };
  el.toolStats.innerHTML = items
    .map(
      (t) =>
        '<span class="tool-chip"><span class="dot" style="background:' +
        (colorVar[t.kind] || colorVar.other) + '"></span>' +
        '<b>' + escapeHtml(t.name) + '</b>' +
        ' <span>' + fmtNum(t.calls) + ' 次 · ' + fmtNum(t.chars) + ' 字符' +
        (t.failed ? ' · <span class="fail-inline">失败 ' + fmtNum(t.failed) + '</span>' : '') +
        '</span></span>'
    )
    .join('');

  if (!el.failStats) return;
  const parts = [
    '<span class="stat-note">汇总口径：' + (filtered ? '当前筛选结果' : '全部调用') + '</span>'
  ];
  if (failures.byKind && failures.byKind.length) {
    parts.push('<span class="stat-note">失败类别</span>');
    failures.byKind.forEach((fk) => {
      parts.push(
        '<span class="fail-chip" title="字符占用 ' + fmtNum(fk.chars) + '">' +
        escapeHtml(fk.label || fk.kind) + ' ' + fmtNum(fk.calls) + ' 次 · ' +
        fmtNum(fk.chars) + ' 字符</span>'
      );
    });
    if (failures.byTool && failures.byTool.length) {
      parts.push('<span class="stat-note">失败来源工具</span>');
      failures.byTool.forEach((ft) => {
        parts.push(
          '<span class="fail-chip fail-chip--tool">' + escapeHtml(ft.name) + ' ' +
          fmtNum(ft.calls) + ' 次</span>'
        );
      });
    }
  } else {
    parts.push('<span class="stat-note">未发现工具调用失败</span>');
  }
  el.failStats.innerHTML = parts.join('');
}


// @anchor: render_summary_end

// @anchor: apply_filters
// 依据筛选条件（工具总类 / 调用结果 / 失败类别 / 工具名 / 最小字符）生成展示与导出视图
// 可选合并同名连续调用
function buildFilteredView() {
  const d = state.data;
  if (!d) return [];
  const f = state.filters;
  const nameQuery = f.toolName.trim().toLowerCase();
  const view = [];

  for (const it of d.iterations) {
    const calls = [];
    for (const call of it.calls) {
      if (!f.kinds[call.kind]) continue;
      if (f.status !== 'all' && call.status !== f.status) continue;
      if (!failKindAllowed(call)) continue;
      if (nameQuery && call.name.toLowerCase().indexOf(nameQuery) === -1) continue;
      if (call.charLength < f.minChars) continue;
      calls.push(call);
    }

    let merged = calls;
    if (f.mergeSame) {
      merged = [];
      for (const call of calls) {
        const last = merged[merged.length - 1];
        if (last && last.name === call.name && last.kind === call.kind) {
          last.charLength += call.charLength;
          last.argsLength += call.argsLength || 0;
          last.resultLength += call.resultLength || 0;
          last.argsText = joinBlock(last.argsText, call.argsText);
          last.resultText = joinBlock(last.resultText, call.resultText);
          last.mergedCount = (last.mergedCount || 1) + 1;
          last.status = last.status === call.status ? last.status : 'mixed';
          if (call.status === 'fail') {
            last.failCount = (last.failCount || 0) + 1;
            last.failed = true;
            last.failKind = last.failCount === 1 ? call.failKind : '';
            last.failLabel = joinLabels(last.failLabel, call.failLabel);
            last.failReason = joinBlock(last.failReason, call.failReason);
          }
        } else {
          merged.push({
            id: call.id,
            name: call.name,
            kind: call.kind,
            argsText: call.argsText || '',
            args: call.args,
            argsLength: call.argsLength || 0,
            resultText: call.resultText || '',
            resultLength: call.resultLength || 0,
            charLength: call.charLength,
            status: call.status,
            failed: !!call.failed,
            failKind: call.failKind || '',
            failLabel: call.failLabel || '',
            failReason: call.failReason || '',
            failCount: call.status === 'fail' ? 1 : 0,
            mergedCount: 1
          });
        }
      }
    }

    if (it.calls.length > 0 && merged.length === 0 && f.onlyToolIters) continue;
    if (it.kind === 'answer' && f.onlyToolIters) continue;

    const charLength = merged.reduce((sum, c) => sum + c.charLength, 0);
    const failCalls = merged.filter((c) => c.status === 'fail').length;
    view.push({
      index: it.index,
      kind: it.kind,
      user: it.user,
      assistantText: it.assistantText,
      charLength,
      failCalls,
      calls: merged
    });
  }
  return view;
}

// 合并同名连续调用时拼接参数/结果原文，空值不产生空行
function joinBlock(head, tail) {
  const a = head ? String(head) : '';
  const b = tail ? String(tail) : '';
  if (!a) return b;
  if (!b) return a;
  return a + '\n' + b;
}

// 合并失败类别标签，去重后用顿号连接
function joinLabels(head, tail) {
  const parts = [];
  [head, tail].forEach((v) => {
    String(v || '')
      .split('、')
      .forEach((s) => {
        const t = s.trim();
        if (t && parts.indexOf(t) === -1) parts.push(t);
      });
  });
  return parts.join('、');
}


// @anchor: apply_filters_end

// @anchor: render_iterations
// 渲染迭代列表：每轮展示提示、工具调用条目、状态标记与其字符长度
function renderIterations() {
  if (!state.data) return;
  const view = buildFilteredView();
  if (!view.length) {
    el.iterations.innerHTML = '<div class="empty">没有符合筛选条件的记录</div>';
    return;
  }

  el.iterations.innerHTML = view.map((it) => renderIterCard(it)).join('');
}

// 生成单个迭代卡片的 HTML
function renderIterCard(it) {
  const kindTag = it.kind === 'answer' ? '回答轮' : '工具轮';
  const failTag = it.failCalls ? ' <span class="fail-badge">失败 ' + fmtNum(it.failCalls) + '</span>' : '';
  const head =
    '<div class="iter-card__head">' +
    '<span class="iter-card__no">迭代 #' + it.index + '</span>' +
    '<span class="iter-card__tag">' + kindTag + '</span>' + failTag +
    '<span class="iter-card__total">涉及 ' + fmtNum(it.charLength) + ' 字符 · ' + it.calls.length + ' 次调用</span>' +
    '</div>';

  let body = '';
  if (it.user) {
    body += '<div class="iter-prompt">用户：' + escapeHtml(clip(it.user, 600)) + '</div>';
  }
  if (it.assistantText) {
    body += '<details class="call__detail"><summary>助手文本</summary><div class="call__pre">' +
      escapeHtml(clip(it.assistantText, PREVIEW_LIMIT)) + '</div></details>';
  }
  body += it.calls.map((c) => renderCall(c)).join('');

  return '<div class="iter-card">' + head + '<div class="iter-card__body">' + body + '</div></div>';
}

// 生成单次工具调用条目的 HTML，失败调用附加类别徽标与失败原因
function renderCall(c) {
  const argsPreview = c.argsText ? clip(c.argsText, PREVIEW_LIMIT) : '（无参数）';
  const mergeTag = c.mergedCount > 1 ? ' <span class="kind-label">×' + c.mergedCount + ' 合并</span>' : '';
  const failTag = c.failed
    ? '<span class="fail-badge">失败' +
      (c.failLabel ? ' · ' + escapeHtml(c.failLabel) : '') +
      (c.failCount > 1 ? ' ×' + c.failCount : '') + '</span>'
    : '';
  const statusTag = !c.failed && c.status && c.status !== 'ok'
    ? '<span class="status-badge">' + escapeHtml(STATUS_LABEL[c.status] || c.status) + '</span>'
    : '';
  const failDetail = c.failed
    ? '<details class="call__detail"><summary>失败信息</summary><div class="call__pre call__pre--fail">' +
      escapeHtml(clip(c.resultText || c.failReason || '', PREVIEW_LIMIT)) + '</div></details>'
    : '';
  return (
    '<div class="call call--' + c.kind + (c.failed ? ' call--fail' : '') + '">' +
    '<div class="call__head">' +
    '<span class="tool-name tool-name--' + c.kind + '">' + escapeHtml(c.name) + '</span>' +
    '<span class="kind-label">' + (KIND_LABEL[c.kind] || c.kind) + '</span>' + mergeTag + failTag + statusTag +
    '<span class="char-badge">' + fmtNum(c.charLength) + ' 字符</span>' +
    '</div>' +
    '<div class="call__meta">' +
    '<span>参数 ' + fmtNum(c.argsLength) + ' 字符</span>' +
    '<span>结果 ' + fmtNum(c.resultLength) + ' 字符</span>' +
    '<span>状态 ' + escapeHtml(STATUS_LABEL[c.status] || c.status || '-') + '</span>' +
    '</div>' +
    '<details class="call__detail"><summary>参数</summary><div class="call__pre">' +
    escapeHtml(argsPreview) + '</div></details>' +
    failDetail +
    '</div>'
  );
}

// @anchor: render_iterations_end

// @anchor: rounds_view
// 按轮次整理视图：自上而下按轮次顺序排列；每轮内容为 ① 推理内容 ② 工具调用与结果，
// 每个工具调用下方紧跟其对应结果（结果默认压缩，可展开原文），并支持勾选轮次与调用用于选定导出

// 切换当前视图容器：调用列表或按轮次整理
function renderView() {
  const roundsMode = state.view === 'rounds';
  if (el.iterations) el.iterations.hidden = roundsMode;
  if (el.rounds) el.rounds.hidden = !roundsMode;
  if (roundsMode) renderRounds();
  else renderIterations();
}

// 构建轮次视图：不合并同名调用以保持调用与结果一一对应，并补齐推理内容
function buildRoundView() {
  const f = state.filters;
  const prevMerge = f.mergeSame;
  f.mergeSame = false;
  let view = [];
  try {
    view = buildFilteredView();
  } finally {
    f.mergeSame = prevMerge;
  }
  const source = new Map();
  ((state.data && state.data.iterations) || []).forEach((it) => source.set(it.index, it));
  view.forEach((it) => {
    const src = source.get(it.index);
    it.reasoning = src ? src.reasoning || '' : '';
    it.assistantText = it.assistantText || (src ? src.assistantText || '' : '');
  });
  return view;
}

// 调用对象到「原始轮次内序号」的映射：视图经筛选后位置会变化，选定键以此为准
function buildCallNoMap() {
  const map = new Map();
  (((state.data && state.data.iterations) || [])).forEach((it) =>
    it.calls.forEach((call, i) => map.set(call, i + 1))
  );
  return map;
}

// 选定键：轮次序号 + 调用在原始轮次中的序号
function selKeyOf(index, no) {
  return index + ':' + no;
}

// 渲染轮次列表：顶部为选择/压缩工具条，下方按顺序渲染各轮卡片
function renderRounds() {
  if (!state.data || !el.rounds) return;
  const view = buildRoundView();
  if (!view.length) {
    el.rounds.innerHTML = '<div class="empty">没有符合筛选条件的记录</div>';
    return;
  }
  const noMap = buildCallNoMap();
  el.rounds.innerHTML =
    renderRoundsBar(view) + view.map((it) => renderRoundCard(it, noMap)).join('');
  syncSelection();
}

// 顶部工具条：选中计数、全选/清空、结果展开与压缩
function renderRoundsBar(view) {
  const calls = view.reduce((sum, it) => sum + it.calls.length, 0);
  return (
    '<div class="rounds-bar">' +
    '<span class="rounds-bar__count">已选 0 轮 · 0 次调用</span>' +
    '<span class="rounds-bar__hint">共 ' + view.length + ' 轮 · ' + calls +
    ' 次调用；勾选后可用「选定 Markdown / 选定 JSON」导出</span>' +
    '<span class="rounds-bar__acts">' +
    '<button type="button" class="btn btn--mini" data-rounds-act="all">全选</button>' +
    '<button type="button" class="btn btn--mini" data-rounds-act="none">清空</button>' +
    '<button type="button" class="btn btn--mini" data-rounds-act="expand">展开结果</button>' +
    '<button type="button" class="btn btn--mini" data-rounds-act="collapse">压缩结果</button>' +
    '</span></div>'
  );
}

// 生成单轮卡片：头部为选择框与摘要，内容为推理内容 + 调用与结果配对
function renderRoundCard(it, noMap) {
  const kindTag = it.kind === 'answer' ? '回答轮' : '工具轮';
  const failTag = it.failCalls
    ? '<span class="fail-badge">失败 ' + fmtNum(it.failCalls) + '</span>'
    : '';
  const reasoningChars = (it.reasoning || '').length;
  const resultCount = it.calls.filter((c) => c.resultLength > 0).length;
  const picked = state.selection.rounds.has(it.index);
  const head =
    '<div class="round-card__head">' +
    '<input type="checkbox" class="sel-box" data-role="sel-round" data-round="' + it.index + '"' +
    (picked ? ' checked' : '') + ' title="勾选本轮用于选定导出（连带本轮全部调用）" />' +
    '<button type="button" class="round-toggle" tabindex="-1" data-role="toggle">▸</button>' +
    '<span class="round-card__no">第 ' + it.index + ' 轮</span>' +
    '<span class="iter-card__tag">' + kindTag + '</span>' + failTag +
    '<span class="round-card__meta">推理 ' + fmtNum(reasoningChars) + ' 字符 · 调用 ' +
    it.calls.length + ' 次 · 结果 ' + resultCount + ' 条 · 涉及 ' + fmtNum(it.charLength) + ' 字符</span>' +
    '</div>';
  const body =
    '<div class="round-card__body" hidden>' +
    renderRoundPrompt(it) +
    renderRoundReason(it) +
    renderRoundPairs(it, noMap) +
    '</div>';
  return (
    '<div class="round-card' + (picked ? ' is-selected' : '') + '" data-round="' + it.index + '">' +
    head + body + '</div>'
  );
}

// 本轮用户输入：置于内容之前，便于定位输入来源
function renderRoundPrompt(it) {
  if (!it.user) return '';
  return '<div class="round-prompt">用户：' + escapeHtml(clip(it.user, 600)) + '</div>';
}

// 第一部分：推理内容；本日志无推理字段时给出提示，助手文本可另行展开
function renderRoundReason(it) {
  const reasoning = it.reasoning || '';
  const assistant = it.assistantText || '';
  let inner = '';
  if (reasoning) {
    inner += '<div class="call__pre">' + escapeHtml(clip(reasoning, PREVIEW_LIMIT)) + '</div>';
  }
  if (assistant) {
    inner +=
      '<details class="call__detail"><summary>助手文本 ' + fmtNum(assistant.length) +
      ' 字符</summary><div class="call__pre">' + escapeHtml(clip(assistant, PREVIEW_LIMIT)) +
      '</div></details>';
  }
  if (!inner) inner = '<div class="round-empty">（本轮无推理内容记录）</div>';
  return (
    '<div class="round-part round-part--reason">' +
    '<div class="round-part__title">① 推理内容<span class="round-part__hint">' +
    fmtNum(reasoning.length) + ' 字符</span></div>' + inner + '</div>'
  );
}

// 第二部分：工具调用与结果，按调用顺序逐个成对展示
function renderRoundPairs(it, noMap) {
  const title =
    '<div class="round-part__title">② 工具调用与结果<span class="round-part__hint">' +
    it.calls.length + ' 次 · 每次调用下方紧跟其结果，可压缩或展开</span></div>';
  if (!it.calls.length) {
    return (
      '<div class="round-part round-part--pair">' + title +
      '<div class="round-empty">（本轮无工具调用）</div></div>'
    );
  }
  const items = it.calls.map((c, i) => renderPairBlock(it, c, i, noMap)).join('');
  return (
    '<div class="round-part round-part--pair">' + title +
    '<div class="pair-list">' + items + '</div></div>'
  );
}

// 单次调用的成对区块：上方为调用（含参数），下方为其结果（默认压缩）
function renderPairBlock(it, c, i, noMap) {
  const no = noMap.get(c) || i + 1;
  const key = selKeyOf(it.index, no);
  const picked = state.selection.calls.has(key);
  const argsText = normalizeText(c.argsText);
  const resultText = normalizeText(c.resultText);
  const argsBlock = argsText
    ? '<details class="call__detail"><summary>参数 ' + fmtNum(c.argsLength) +
      ' 字符</summary><div class="call__pre">' + escapeHtml(clip(argsText, PREVIEW_LIMIT)) +
      '</div></details>'
    : '<div class="round-empty">（无参数）</div>';
  const failTag = c.failed
    ? '<span class="fail-badge">失败' + (c.failLabel ? ' · ' + escapeHtml(c.failLabel) : '') + '</span>'
    : '';
  const statusTag =
    !c.failed && c.status && c.status !== 'ok'
      ? '<span class="status-badge">' + escapeHtml(STATUS_LABEL[c.status] || c.status) + '</span>'
      : '';
  const peek = resultText ? escapeHtml(peekLine(resultText, 80)) : '（无结果记录）';
  const summary =
    '<summary class="result-head">' +
    '<span class="result-head__label">结果 #' + no + '</span>' +
    '<span class="kind-label">' + escapeHtml(statusText(c)) + '</span>' + failTag + statusTag +
    '<span class="result-head__peek">' + peek + '</span>' +
    '<span class="pair-item__link">' + fmtNum(c.resultLength) + ' 字符 · 计入 ' +
    fmtNum(c.charLength) + ' 字符</span></summary>';
  const body =
    '<div class="call__pre' + (c.failed ? ' call__pre--fail' : '') + '">' +
    (resultText ? escapeHtml(clip(resultText, PREVIEW_LIMIT)) : '（无结果记录）') + '</div>';
  return (
    '<div class="pair-block pair-block--' + c.kind + (c.failed ? ' pair-block--fail' : '') + '">' +
    '<div class="pair-call">' +
    '<div class="pair-item__head">' +
    '<input type="checkbox" class="sel-box" data-role="sel-call" data-round="' + it.index +
    '" data-no="' + no + '"' + (picked ? ' checked' : '') +
    ' title="勾选本次调用及其结果用于选定导出" />' +
    '<span class="pair-no">#' + no + '</span>' +
    '<span class="tool-name tool-name--' + c.kind + '">' + escapeHtml(c.name) + '</span>' +
    '<span class="kind-label">' + (KIND_LABEL[c.kind] || c.kind) + '</span>' +
    '<span class="pair-item__link">参数 ' + fmtNum(c.argsLength) + ' 字符</span>' +
    '</div>' + argsBlock + '</div>' +
    '<div class="pair-result">' +
    '<details class="result-box' + (c.failed ? ' result-box--fail' : '') + '">' +
    summary + body + '</details></div>' +
    '</div>'
  );
}

// 压缩显示时取结果首行作为预览
function peekLine(text, limit) {
  const line = normalizeText(text).split('\n')[0].trim();
  return line.length > limit ? line.slice(0, limit) + '…' : line;
}

// @anchor: rounds_select
// 轮次勾选：轮次 / 调用两级选择、工具条动作与展开收起，供选定导出使用

// 清空选定（加载新文件时重置）
function clearSelection() {
  state.selection.rounds.clear();
  state.selection.calls.clear();
}

// 刷新选中计数与勾选框状态，不重绘卡片以保留展开状态
function syncSelection() {
  if (!el.rounds) return;
  el.rounds.querySelectorAll('input[data-role="sel-round"]').forEach((box) => {
    const idx = Number(box.dataset.round);
    box.checked = state.selection.rounds.has(idx);
    const card = box.closest ? box.closest('.round-card') : null;
    if (card) card.classList.toggle('is-selected', box.checked);
  });
  el.rounds.querySelectorAll('input[data-role="sel-call"]').forEach((box) => {
    box.checked = state.selection.calls.has(selKeyOf(Number(box.dataset.round), box.dataset.no));
  });
  const counter = el.rounds.querySelector('.rounds-bar__count');
  if (counter) {
    counter.textContent =
      '已选 ' + state.selection.rounds.size + ' 轮 · ' + state.selection.calls.size + ' 次调用';
  }
}

// 勾选/取消整轮：连带本轮在视图中的全部调用
function toggleRoundSelect(card, checked) {
  if (!card) return;
  const idx = Number(card.dataset.round);
  const nos = [];
  card.querySelectorAll('input[data-role="sel-call"]').forEach((box) => nos.push(box.dataset.no));
  if (checked) {
    state.selection.rounds.add(idx);
    nos.forEach((no) => state.selection.calls.add(selKeyOf(idx, no)));
  } else {
    state.selection.rounds.delete(idx);
    nos.forEach((no) => state.selection.calls.delete(selKeyOf(idx, no)));
  }
}

// 勾选/取消单次调用：勾选时自动带上所属轮次
function toggleCallSelect(box, checked) {
  if (!box) return;
  const idx = Number(box.dataset.round);
  const key = selKeyOf(idx, box.dataset.no);
  if (checked) {
    state.selection.calls.add(key);
    state.selection.rounds.add(idx);
  } else {
    state.selection.calls.delete(key);
  }
}

// 工具条动作：全选 / 清空 / 展开结果 / 压缩结果
function handleRoundsAction(act) {
  if (!el.rounds) return;
  if (act === 'expand' || act === 'collapse') {
    const open = act === 'expand';
    el.rounds.querySelectorAll('details.result-box').forEach((d) => {
      d.open = open;
    });
    return;
  }
  if (act === 'all') {
    el.rounds.querySelectorAll('.round-card').forEach((card) => toggleRoundSelect(card, true));
    syncSelection();
    return;
  }
  if (act === 'none') {
    clearSelection();
    syncSelection();
  }
}

// 展开或收起单轮内容
function toggleRoundBody(card) {
  if (!card) return;
  const body = card.querySelector('.round-card__body');
  if (!body) return;
  body.hidden = !body.hidden;
  card.classList.toggle('is-open', !body.hidden);
  const toggle = card.querySelector('.round-toggle');
  if (toggle) toggle.textContent = body.hidden ? '▸' : '▾';
}

// 事件委托：工具条动作、勾选切换与单轮展开
function bindRoundsEvents() {
  if (!el.rounds) return;
  el.rounds.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const act = t.closest('[data-rounds-act]');
    if (act) {
      handleRoundsAction(act.dataset.roundsAct);
      return;
    }
    const box = t.closest('input[data-role]');
    if (box) {
      const card = box.closest('.round-card');
      if (box.dataset.role === 'sel-round') toggleRoundSelect(card, box.checked);
      else toggleCallSelect(box, box.checked);
      syncSelection();
      return;
    }
    const head = t.closest('.round-card__head');
    if (head) toggleRoundBody(head.closest('.round-card'));
  });
}

// @anchor: rounds_select_end

// @anchor: rounds_view_end


// @anchor: export_builders
// 构造各导出格式的文本内容（完整 JSON / 精简 JSON / CSV / Markdown / 纯工具行）
// 「含工具参数」与「含工具结果」是两个互不影响的独立开关：关掉结果后导出文件里不会残留任何结果原文
// 「结果移到文末附录」开启时长结果集中到文末，正文只留引用编号，避免长结果稀释参数与调用结构

// 失败原因首行的截断长度，避免个别超长错误行把表格撑变形
const FAIL_REASON_LIMIT = 200;

function readExportOptions() {
  return {
    reasoning: !!(el.exportReasoning && el.exportReasoning.checked),
    args: !!(el.exportArgs && el.exportArgs.checked),
    result: !!(el.exportResult && el.exportResult.checked),
    resultAppendix: !!(el.exportResultAppendix && el.exportResultAppendix.checked)
  };
}

// 附加内容与结果位置的单行说明，写入各文本导出的文件头
function includeNote(opts) {
  const o = opts || {};
  return (
    '推理内容 ' + (o.reasoning ? '含' : '不含') +
    '、工具参数 ' + (o.args ? '含' : '不含') +
    '、工具结果 ' + (o.result ? (o.resultAppendix ? '含（文末附录）' : '含（正文内联）') : '不含')
  );
}

// @anchor: export_appendix
// 结果附录卷：正文用 R<n> 引用，原文统一收在文末，长度再大也不会穿插进参数之间
function addAppendix(appendix, c, text) {
  if (!appendix) return '';
  const ref = 'R' + (appendix.length + 1);
  appendix.push({
    ref: ref,
    name: c.name,
    kind: c.kind,
    status: statusText(c),
    statusTag: c.failed ? '失败' : '',
    length: normalizeText(text).length,
    text: normalizeText(text)
  });
  return ref;
}

// 正文引用：结果原文在附录中的编号与字符数
function appendixPointer(c, appendix) {
  const text = normalizeText(c.resultText);
  if (!text) return '（无结果记录）';
  return '→ 附录 ' + addAppendix(appendix, c, text) + '（' + fmtNum(text.length) + ' 字符）';
}

// Markdown 附录章节
function mdAppendix(appendix) {
  if (!appendix || !appendix.length) return '';
  let md = '\n---\n\n## 附录：工具结果\n\n';
  md += '> 结果原文集中于此，正文只保留引用编号，避免长结果稀释参数与调用结构\n\n';
  appendix.forEach((a) => {
    md += '### ' + a.ref + ' · ' + a.name + '（' + (KIND_LABEL[a.kind] || a.kind) + '）· ' +
      a.status + ' · ' + fmtNum(a.length) + ' 字符\n';
    md += mdBlock(a.text) + '\n';
  });
  return md;
}

// 纯文本附录章节
function txtAppendix(appendix) {
  if (!appendix || !appendix.length) return '';
  let out = '\n# 附录：工具结果\n';
  appendix.forEach((a) => {
    out += '\n[' + a.ref + '] ' + a.name + '\t' + (KIND_LABEL[a.kind] || a.kind) + '\t' +
      a.status + '\t' + a.length + ' 字符\n' + indentLines(a.text, '    ') + '\n';
  });
  return out;
}
// @anchor: export_appendix_end

// 组装导出数据：可选仅取当前筛选视图，并带上附加内容选项与失败汇总
function buildExportData() {
  const useFiltered = el.exportFiltered.checked;
  const d = state.data;
  if (!d) return null;
  const opts = readExportOptions();
  if (useFiltered) {
    const view = buildFilteredView();
    const summary = summarizeView(view);
    return {
      file: d.file,
      summary: summary,
      failures: summary.failures,
      iterations: view,
      opts: opts
    };
  }
  return {
    file: d.file,
    summary: d.summary,
    failures: d.failures,
    iterations: d.iterations,
    toolStats: d.toolStats,
    opts: opts
  };
}

// 依据当前视图重新汇总字符统计与失败统计
function summarizeView(view) {
  const totals = {
    read: { calls: 0, chars: 0 },
    write: { calls: 0, chars: 0 },
    compile: { calls: 0, chars: 0 },
    other: { calls: 0, chars: 0 }
  };
  const toolStats = {};
  const failKindMap = {};
  const failToolMap = {};
  let calls = 0;
  let chars = 0;
  let argsChars = 0;
  let resultChars = 0;
  let toolIters = 0;
  let failedCalls = 0;
  let emptyCalls = 0;
  let noneCalls = 0;
  for (const it of view) {
    if (it.calls.length) toolIters++;
    for (const c of it.calls) {
      calls++;
      chars += c.charLength;
      argsChars += c.argsLength || 0;
      resultChars += c.resultLength || 0;
      const b = totals[c.kind] || totals.other;
      b.calls++;
      b.chars += c.charLength;
      const st =
        toolStats[c.name] ||
        (toolStats[c.name] = {
          name: c.name,
          kind: c.kind,
          calls: 0,
          chars: 0,
          failed: 0,
          failedChars: 0
        });
      st.calls++;
      st.chars += c.charLength;
      if (c.status === 'fail') {
        failedCalls++;
        st.failed++;
        st.failedChars += c.charLength;
        const fk =
          failKindMap[c.failKind] ||
          (failKindMap[c.failKind] = {
            kind: c.failKind,
            label: c.failLabel || c.failKind,
            calls: 0,
            chars: 0
          });
        fk.calls++;
        fk.chars += c.charLength;
        const ft =
          failToolMap[c.name] ||
          (failToolMap[c.name] = { name: c.name, kind: c.kind, calls: 0, chars: 0 });
        ft.calls++;
        ft.chars += c.charLength;
      } else if (c.status === 'empty') {
        emptyCalls++;
      } else if (c.status === 'none') {
        noneCalls++;
      }
    }
  }
  const byKind = Object.values(failKindMap).sort((a, b) => b.calls - a.calls || b.chars - a.chars);
  return {
    iterations: view.length,
    toolIterations: toolIters,
    toolCalls: calls,
    failedCalls: failedCalls,
    emptyCalls: emptyCalls,
    noneCalls: noneCalls,
    totals: totals,
    totalChars: chars,
    argsChars: argsChars,
    resultChars: resultChars,
    failures: {
      calls: failedCalls,
      chars: byKind.reduce((sum, fk) => sum + fk.chars, 0),
      emptyCalls: emptyCalls,
      noneCalls: noneCalls,
      byKind: byKind,
      byTool: Object.values(failToolMap).sort((a, b) => b.calls - a.calls || b.chars - a.chars)
    },
    toolStats: Object.values(toolStats).sort((a, b) => b.chars - a.chars)
  };
}

// 归一化原文换行，避免 CRLF 混入导出文本
function normalizeText(value) {
  if (value == null) return '';
  return String(value).replace(/\r\n?/g, '\n');
}

// 状态与失败类别的中文标签（缺失时回退到状态码）
function statusText(c) {
  return STATUS_LABEL[c.status] || c.status || '';
}

function failKindText(c) {
  if (c.status !== 'fail') return '';
  return c.failLabel || c.failKind || '';
}

// 失败原因：截断首行；未导出工具结果时只给占位，保证结果原文不会从这一列渗漏出去
function failReasonText(c, opts) {
  if (c.status !== 'fail') return '';
  const withResult = !opts || opts.result !== false;
  if (!withResult) {
    return '（结果原文未导出，' + fmtNum(c.resultLength || 0) + ' 字符）';
  }
  const line = c.failReason || normalizeText(c.resultText).split('\n')[0] || '';
  return line.length > FAIL_REASON_LIMIT ? line.slice(0, FAIL_REASON_LIMIT) + '…' : line;
}

// Markdown 单元格转义：竖线与换行
function mdCell(value) {
  return normalizeText(value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

// 给多行原文逐行加前缀
function indentLines(value, prefix) {
  return normalizeText(value)
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

function toJson(data, compact) {
  const opts = data.opts || { reasoning: false, args: false, result: false };
  const payload = {
    generatedAt: new Date().toISOString(),
    file: data.file,
    summary: data.summary,
    include: {
      reasoning: !!opts.reasoning,
      toolArgs: !!opts.args,
      toolResult: !!opts.result,
      toolResultMode: opts.resultAppendix ? 'appendix' : 'inline'
    }
  };
  const failures = data.failures || (data.summary && data.summary.failures);
  if (failures) payload.failures = failures;
  if (compact) {
    payload.iterations = data.iterations.map((it) => {
      const item = {
        index: it.index,
        kind: it.kind,
        charLength: it.charLength,
        calls: it.calls.map((c) => {
          const call = {
            name: c.name,
            kind: c.kind,
            status: c.status || 'ok',
            failed: !!c.failed,
            failKind: c.failKind || '',
            failLabel: c.failLabel || '',
            failReason: failReasonText(c, opts),
            charLength: c.charLength,
            argsLength: c.argsLength != null ? c.argsLength : 0,
            resultLength: c.resultLength != null ? c.resultLength : 0,
            mergedCount: c.mergedCount || 1
          };
          if (opts.args) {
            call.args = c.args != null ? c.args : null;
            call.argsText = normalizeText(c.argsText);
          }
          if (opts.result) call.resultText = normalizeText(c.resultText);
          return call;
        })
      };
      if (opts.reasoning) {
        item.reasoning = normalizeText(it.reasoning);
        item.assistantText = normalizeText(it.assistantText);
      }
      return item;
    });
  } else {
    payload.iterations = data.iterations;
    if (data.toolStats) payload.toolStats = data.toolStats;
  }
  return JSON.stringify(payload, null, 2);
}

function toCsv(data) {
  const opts = data.opts || { args: false, result: false };
  const header = [
    '迭代', '工具名', '类型', '状态', '失败类别', '失败原因', '字符长度', '参数字符', '结果字符', '合并次数'
  ];
  if (opts.args) header.push('工具参数');
  if (opts.result) header.push('工具结果');
  const rows = [header];
  for (const it of data.iterations) {
    for (const c of it.calls) {
      const row = [
        it.index,
        c.name,
        c.kind,
        statusText(c),
        failKindText(c),
        failReasonText(c, opts),
        c.charLength,
        c.argsLength != null ? c.argsLength : '',
        c.resultLength != null ? c.resultLength : '',
        c.mergedCount || 1
      ];
      if (opts.args) row.push(normalizeText(c.argsText));
      if (opts.result) row.push(normalizeText(c.resultText));
      rows.push(row);
    }
  }
  return rows
    .map((r) => r.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
    .join('\r\n');
}

function toMarkdown(data) {
  const opts = data.opts || { args: false, result: false };
  const s = data.summary;
  const appendix = [];
  let md = '# 上下文工具调用报告\n\n';
  md += '- 文件：' + (data.file.name || '') + '\n';
  md += '- 迭代数：' + s.iterations + '（工具轮次 ' + s.toolIterations + '）\n';
  md += '- 工具调用数：' + s.toolCalls + '（失败 ' + (s.failedCalls || 0) + '，未找到 ' +
    (s.emptyCalls || 0) + '，无记录 ' + (s.noneCalls || 0) + '）\n';
  md += '- 读入 / 写入 / 编译字符：' + s.totals.read.chars + ' / ' + s.totals.write.chars + ' / ' + s.totals.compile.chars + '\n';
  md += '- 参数字符 / 结果字符：' + fmtNum(s.argsChars || 0) + ' / ' + fmtNum(s.resultChars || 0) + '\n';
  md += '- 涉及字符合计：' + s.totalChars + '\n';
  if (s.failures && s.failures.byKind && s.failures.byKind.length) {
    md += '- 失败类别：' + s.failures.byKind.map((fk) => (fk.label || fk.kind) + ' ' + fk.calls + ' 次').join('、') + '\n';
  }
  md += '- 附加内容：' + includeNote(opts) + '\n\n';
  let head = '| 迭代 | 工具 | 类型 | 状态 | 失败类别 | 失败原因 | 字符长度 |';
  let sep = '| --- | --- | --- | --- | --- | --- | --- |';
  if (opts.args) {
    head += ' 工具参数 |';
    sep += ' --- |';
  }
  if (opts.result) {
    head += opts.resultAppendix ? ' 工具结果（附录引用） |' : ' 工具结果 |';
    sep += ' --- |';
  }
  md += head + '\n' + sep + '\n';
  for (const it of data.iterations) {
    for (const c of it.calls) {
      let row =
        '| #' + it.index + ' | ' + c.name + ' | ' + (KIND_LABEL[c.kind] || c.kind) +
        ' | ' + statusText(c) + ' | ' + mdCell(failKindText(c)) + ' | ' + mdCell(failReasonText(c, opts)) +
        ' | ' + c.charLength + ' |';
      if (opts.args) row += ' ' + mdCell(c.argsText) + ' |';
      if (opts.result) {
        row += ' ' + mdCell(opts.resultAppendix ? appendixPointer(c, appendix) : c.resultText) + ' |';
      }
      md += row + '\n';
    }
  }
  return md + mdAppendix(appendix);
}

function toPlain(data) {
  const opts = data.opts || { args: false, result: false };
  const appendix = [];
  let out = '# 上下文工具调用（含字符长度）\n';
  out += '# 状态列：成功 / 失败 / 未找到 / 无记录，失败行追加失败类别与原因\n';
  out += '# 附加内容：' + includeNote(opts) + '\n';
  for (const it of data.iterations) {
    for (const c of it.calls) {
      out += '#' + it.index + '\t' + c.name + '\t' + (KIND_LABEL[c.kind] || c.kind) + '\t' +
        statusText(c) + '\t' + c.charLength + '\n';
      if (c.status === 'fail') {
        const kindText = failKindText(c);
        out += '  [失败' + (kindText ? '·' + kindText : '') + '] ' + failReasonText(c, opts) + '\n';
      }
      const argsText = normalizeText(c.argsText);
      const resultText = normalizeText(c.resultText);
      if (opts.args && argsText) out += '  [参数]\n' + indentLines(argsText, '    ') + '\n';
      if (opts.result && resultText) {
        if (opts.resultAppendix) {
          out += '  [结果 → 附录 ' + addAppendix(appendix, c, resultText) + ']\n';
        } else {
          out += '  [结果]\n' + indentLines(resultText, '    ') + '\n';
        }
      }
    }
  }
  return out + txtAppendix(appendix);
}

// 触发浏览器下载
function download(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// @anchor: export_builders_end

// @anchor: rounds_export
// 按轮次整理导出：每轮分 ① 推理内容 ② 工具调用与结果（调用下方紧跟其结果）
// 工具参数与工具结果各自受独立开关控制；结果可移到文末附录，正文只留引用编号

// 取轮次数据：filtered 为真时沿用当前筛选，否则取全部轮次
function collectRounds(filtered) {
  const d = state.data;
  if (!d) return [];
  if (filtered) return buildRoundView();
  return d.iterations.map((it) => ({
    index: it.index,
    kind: it.kind,
    user: it.user,
    assistantText: it.assistantText,
    reasoning: it.reasoning || '',
    charLength: it.charLength,
    failCalls: it.failCalls,
    calls: it.calls.map((c, i) => Object.assign({}, c, { no: i + 1 }))
  }));
}

// 组装轮次导出的数据与汇总
function buildRoundsExportData() {
  const d = state.data;
  if (!d) return null;
  const useFiltered = !el.exportFiltered || el.exportFiltered.checked;
  const view = collectRounds(useFiltered);
  const summary = useFiltered ? summarizeView(view) : d.summary;
  return { file: d.file, summary: summary, iterations: view, opts: readExportOptions() };
}

// 收集选定内容：按轮次顺序，仅保留勾选的调用
function collectSelectedRounds() {
  const rounds = state.selection.rounds;
  if (!rounds.size || !state.data) return [];
  const out = [];
  state.data.iterations.forEach((it) => {
    if (!rounds.has(it.index)) return;
    const calls = [];
    it.calls.forEach((call, i) => {
      const no = i + 1;
      if (!state.selection.calls.has(selKeyOf(it.index, no))) return;
      calls.push(Object.assign({}, call, { no: no }));
    });
    out.push({
      index: it.index,
      kind: it.kind,
      user: it.user,
      assistantText: it.assistantText || '',
      reasoning: it.reasoning || '',
      charLength: calls.reduce((sum, c) => sum + c.charLength, 0),
      failCalls: calls.filter((c) => c.status === 'fail').length,
      calls: calls
    });
  });
  return out;
}

// 组装选定导出数据：汇总口径为选定内容
function buildSelectionExportData() {
  if (!state.data) return null;
  const picked = collectSelectedRounds();
  if (!picked.length) return null;
  return {
    file: state.data.file,
    summary: summarizeView(picked),
    iterations: picked,
    opts: readExportOptions()
  };
}

// 四反引号围栏，避免原文中的三反引号提前闭合代码块
function mdBlock(text) {
  const body = normalizeText(text);
  if (!body) return '';
  return '\n````\n' + body + '\n````\n';
}

// 记录被省略的可选内容，便于下游确认导出范围
function omittedList(opts) {
  const out = [];
  if (!opts.reasoning) out.push('reasoning');
  if (!opts.args) out.push('toolArgs');
  if (!opts.result) out.push('toolResult');
  return out;
}

// 参数段落：开启时输出参数原文；关闭时标注省略并说明字符仍计入统计
function mdArgsSection(c, opts) {
  if (!opts.args) {
    return '\n（导出设置：不含工具参数；参数字符 ' + fmtNum(c.argsLength || 0) + ' 仍计入统计）\n';
  }
  const text = normalizeText(c.argsText);
  return text ? mdBlock(text) : '\n（无参数）\n';
}

// 结果段落：开启时输出结果原文（可移到附录）；关闭时标注省略并说明字符仍计入统计
function mdResultSection(c, opts, appendix) {
  if (!opts.result) {
    return '（导出设置：不含工具结果；结果字符 ' + fmtNum(c.resultLength || 0) + ' 仍计入统计）\n';
  }
  const text = normalizeText(c.resultText);
  if (opts.resultAppendix) {
    if (!text) return '（无结果记录）\n';
    const ref = addAppendix(appendix, c, text);
    return '（结果原文见文末附录 ' + ref + '；' + fmtNum(text.length) + ' 字符）\n';
  }
  return mdBlock(c.resultText ? c.resultText : '（无结果记录）');
}

// 生成按轮次整理的 Markdown：推理内容 + 调用与结果配对（结果可收进附录）
function toRoundsMarkdown(data) {
  const opts = data.opts || { reasoning: true, args: false, result: false };
  const s = data.summary || {};
  const appendix = [];
  let md = '# 上下文按轮次整理\n\n';
  md += '- 文件：' + (data.file.name || '') + '\n';
  md += '- 轮次：' + (s.iterations != null ? s.iterations : data.iterations.length) +
    '（工具轮次 ' + (s.toolIterations != null ? s.toolIterations : 0) + '）\n';
  md += '- 工具调用数：' + (s.toolCalls != null ? s.toolCalls : 0) +
    '（失败 ' + (s.failedCalls || 0) + '）\n';
  md += '- 参数字符 / 结果字符：' + fmtNum(s.argsChars || 0) + ' / ' + fmtNum(s.resultChars || 0) + '\n';
  md += '- 涉及字符合计：' + (s.totalChars != null ? s.totalChars : 0) + '\n';
  md += '- 附加内容：' + includeNote(opts) + '\n';
  md += '- 说明：自上而下按轮次顺序排列；每轮分 ① 推理内容 ② 工具调用与结果，调用下方紧跟其对应结果\n\n';

  for (const it of data.iterations) {
    md += '## 第 ' + it.index + ' 轮（' + (it.kind === 'answer' ? '回答轮' : '工具轮') + '）\n\n';
    md += '- 涉及字符：' + fmtNum(it.charLength) + '（调用 ' + it.calls.length + ' 次' +
      (it.failCalls ? '，失败 ' + it.failCalls + ' 次' : '') + '）\n';
    if (it.user) md += '- 用户输入：' + normalizeText(it.user).split('\n')[0].slice(0, 200) + '\n';

    md += '\n### ① 推理内容\n';
    if (!opts.reasoning) {
      md += '\n（导出设置：不含推理内容）\n';
    } else if (it.reasoning) {
      md += mdBlock(it.reasoning);
      if (it.assistantText) {
        md += '\n助手文本 ' + normalizeText(it.assistantText).length + ' 字符\n';
      }
    } else if (it.assistantText) {
      md += '\n（无推理内容记录，助手文本 ' + normalizeText(it.assistantText).length + ' 字符）\n';
    } else {
      md += '\n（本轮无推理内容记录）\n';
    }

    md += '\n### ② 工具调用与结果\n';
    if (!it.calls.length) {
      md += '\n（未包含工具调用）\n';
      continue;
    }
    md += '\n';
    it.calls.forEach((c, i) => {
      const no = c.no != null ? c.no : i + 1;
      md += '#### #' + no + ' ' + c.name + '（' + (KIND_LABEL[c.kind] || c.kind) +
        '）· 参数 ' + fmtNum(c.argsLength || 0) + ' 字符\n';
      md += mdArgsSection(c, opts);
      md += '\n结果：' + statusText(c) + (failKindText(c) ? '（' + failKindText(c) + '）' : '') +
        ' · 结果 ' + fmtNum(c.resultLength || 0) + ' 字符 · 计入 ' + fmtNum(c.charLength) + ' 字符\n';
      md += mdResultSection(c, opts, appendix);
      md += '\n';
    });
  }
  return md + mdAppendix(appendix);
}

// 生成选定内容的 JSON：仅含勾选的轮次与调用，附加内容（推理 / 参数 / 结果）受独立开关控制
function toSelectionJson(data) {
  const opts = data.opts || { reasoning: false, args: false, result: false };
  const payload = {
    generatedAt: new Date().toISOString(),
    file: data.file,
    summary: data.summary,
    include: {
      reasoning: !!opts.reasoning,
      toolArgs: !!opts.args,
      toolResult: !!opts.result,
      toolResultMode: opts.resultAppendix ? 'appendix' : 'inline',
      omitted: omittedList(opts)
    },
    rounds: data.iterations.map((it) => {
      const round = { index: it.index, kind: it.kind };
      if (it.user) round.user = normalizeText(it.user);
      if (opts.reasoning) {
        round.reasoning = normalizeText(it.reasoning);
        round.assistantText = normalizeText(it.assistantText);
      }
      round.calls = it.calls.map((c, i) => {
        const call = {
          no: c.no != null ? c.no : i + 1,
          name: c.name,
          kind: c.kind,
          status: c.status || 'ok',
          failed: !!c.failed,
          failKind: c.failKind || '',
          failLabel: c.failLabel || '',
          failReason: failReasonText(c, opts),
          charLength: c.charLength,
          argsLength: c.argsLength || 0,
          resultLength: c.resultLength || 0
        };
        if (opts.args) {
          call.args = c.args != null ? c.args : null;
          call.argsText = normalizeText(c.argsText);
        }
        if (opts.result) call.resultText = normalizeText(c.resultText);
        return call;
      });
      return round;
    })
  };
  return JSON.stringify(payload, null, 2);
}

// @anchor: export_volumes
// 单卷导出：参数卷只含参数原文，结果卷只含结果原文，两者互不掺杂，便于分别取用
function volumeHead(title, data, hint, totalLabel, total) {
  const s = data.summary || {};
  let md = '# ' + title + '\n\n';
  md += '- 文件：' + (data.file.name || '') + '\n';
  md += '- 轮次：' + data.iterations.length + '（工具轮次 ' + (s.toolIterations || 0) + '）\n';
  md += '- 调用数：' + (s.toolCalls || 0) + '（失败 ' + (s.failedCalls || 0) + '）\n';
  md += '- ' + totalLabel + '：' + fmtNum(total) + ' 字符\n';
  md += '- 参数合计 / 结果合计：' + fmtNum(s.argsChars || 0) + ' / ' + fmtNum(s.resultChars || 0) + ' 字符\n';
  md += '- 说明：' + hint + '\n\n';
  return md;
}

// 参数卷：逐次调用输出参数原文，绝不出现结果原文
function toArgsMarkdown(data) {
  let total = 0;
  data.iterations.forEach((it) => it.calls.forEach((c) => (total += c.argsLength || 0)));
  let md = volumeHead('工具参数卷', data,
    '本卷只含工具参数原文，不含任何工具结果原文；结果长度仅作统计', '参数合计', total);
  for (const it of data.iterations) {
    md += '## 第 ' + it.index + ' 轮（' + (it.kind === 'answer' ? '回答轮' : '工具轮') + '）\n\n';
    if (!it.calls.length) {
      md += '（未包含工具调用）\n\n';
      continue;
    }
    it.calls.forEach((c, i) => {
      const no = c.no != null ? c.no : i + 1;
      md += '### #' + no + ' ' + c.name + '（' + (KIND_LABEL[c.kind] || c.kind) + '）· 参数 ' +
        fmtNum(c.argsLength || 0) + ' 字符\n';
      const text = normalizeText(c.argsText);
      md += text ? mdBlock(text) : '\n（无参数）\n';
      md += '\n';
    });
  }
  return md;
}

// 结果卷：逐次调用输出结果原文，绝不出现参数原文
function toResultMarkdown(data) {
  let total = 0;
  data.iterations.forEach((it) => it.calls.forEach((c) => (total += c.resultLength || 0)));
  let md = volumeHead('工具结果卷', data,
    '本卷只含工具结果原文，不含任何工具参数原文；参数长度仅作统计', '结果合计', total);
  for (const it of data.iterations) {
    md += '## 第 ' + it.index + ' 轮（' + (it.kind === 'answer' ? '回答轮' : '工具轮') + '）\n\n';
    if (!it.calls.length) {
      md += '（未包含工具调用）\n\n';
      continue;
    }
    it.calls.forEach((c, i) => {
      const no = c.no != null ? c.no : i + 1;
      md += '### #' + no + ' ' + c.name + '（' + (KIND_LABEL[c.kind] || c.kind) + '）· ' +
        statusText(c) + (failKindText(c) ? '（' + failKindText(c) + '）' : '') +
        ' · 结果 ' + fmtNum(c.resultLength || 0) + ' 字符 · 计入 ' + fmtNum(c.charLength) + ' 字符\n';
      const text = normalizeText(c.resultText);
      md += text ? mdBlock(text) : '\n（无结果记录）\n';
      md += '\n';
    });
  }
  return md;
}
// @anchor: export_volumes_end


// @anchor: rounds_export_end


// @anchor: handle_export
// 依据点击的导出按钮生成对应文件并下载；选定 / 单卷 / 整份三类导出共用同一份数据管线
// 导出后回写状态提示，显示本次导出范围与「推理 / 参数 / 结果」开关状态

// 当前附加内容开关的中文摘要（含结果位置），用于导出后的状态提示
function optionsSummary() {
  const opts = readExportOptions();
  return '推理 ' + (opts.reasoning ? '含' : '不含') + '、参数 ' + (opts.args ? '含' : '不含') +
    '、结果 ' + (opts.result ? (opts.resultAppendix ? '含（文末附录）' : '含（正文内联）') : '不含');
}

// 导出文件名基名与时间戳
function exportBaseName() {
  return (state.data.file.name || 'context')
    .replace(/\.jsonl(\.gz)?$/i, '')
    .replace(/\.json$/i, '');
}

function exportStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// 单卷导出：只输出参数或只输出结果，彼此不掺杂，也不受附加内容开关影响
function exportVolume(kind, base, stamp) {
  const data = buildRoundsExportData();
  if (!data) {
    setStatus('请先加载文件后再导出', 'error');
    return true;
  }
  if (kind === 'args') {
    download(base + '_args_' + stamp + '.md', toArgsMarkdown(data), 'text/markdown');
    setStatus('已导出仅参数 Markdown（不含结果原文；参数 ' + fmtNum(data.summary.argsChars || 0) + ' 字符）', 'ok');
  } else {
    download(base + '_results_' + stamp + '.md', toResultMarkdown(data), 'text/markdown');
    setStatus('已导出仅结果 Markdown（不含参数原文；结果 ' + fmtNum(data.summary.resultChars || 0) + ' 字符）', 'ok');
  }
  return true;
}

// 依据点击的导出按钮生成对应文件并下载；选定导出只用勾选的轮次与调用
function handleExport(type) {
  if (!state.data) {
    setStatus('请先加载文件后再导出', 'error');
    return;
  }
  const base = exportBaseName();
  const stamp = exportStamp();
  if (type === 'args-md' || type === 'result-md') {
    exportVolume(type === 'args-md' ? 'args' : 'result', base, stamp);
    return;
  }
  if (type === 'rounds') {
    const roundsData = buildRoundsExportData();
    download(base + '_rounds_' + stamp + '.md', toRoundsMarkdown(roundsData), 'text/markdown');
    setStatus('已导出轮次 Markdown（' + optionsSummary() + '）', 'ok');
    return;
  }
  if (type === 'sel-md' || type === 'sel-json') {
    const sel = buildSelectionExportData();
    if (!sel) {
      setStatus('请先在「按轮次整理」视图勾选要导出的轮次或调用', 'error');
      return;
    }
    const info = '已导出选定内容：' + sel.iterations.length + ' 轮 / ' +
      fmtNum(sel.summary.toolCalls) + ' 次调用 / ' + fmtNum(sel.summary.totalChars) +
      ' 字符（' + optionsSummary() + '）';
    if (type === 'sel-md') {
      download(base + '_selected_' + stamp + '.md', toRoundsMarkdown(sel), 'text/markdown');
    } else {
      download(base + '_selected_' + stamp + '.json', toSelectionJson(sel), 'application/json');
    }
    setStatus(info, 'ok');
    return;
  }
  const data = buildExportData();
  if (!data) {
    setStatus('请先加载文件后再导出', 'error');
    return;
  }
  const names = { json: '完整 JSON', compact: '精简 JSON', csv: 'CSV', md: 'Markdown', txt: '纯工具 + 字符' };
  if (type === 'json') {
    download(base + '_' + stamp + '.json', toJson(data, false), 'application/json');
  } else if (type === 'compact') {
    download(base + '_compact_' + stamp + '.json', toJson(data, true), 'application/json');
  } else if (type === 'csv') {
    download(base + '_' + stamp + '.csv', toCsv(data), 'text/csv');
  } else if (type === 'md') {
    download(base + '_' + stamp + '.md', toMarkdown(data), 'text/markdown');
  } else if (type === 'txt') {
    download(base + '_tools_' + stamp + '.txt', toPlain(data), 'text/plain');
  } else {
    return;
  }
  setStatus(
    '已导出' + (names[type] || type) + '（' + (type === 'json' ? '完整 JSON 恒含全部原文' : optionsSummary()) + '）',
    'ok'
  );
}


// @anchor: handle_export_end

// @anchor: bind_events
// 绑定拖放、文件选择、筛选控件（含调用结果与失败类别）与导出按钮事件
function bindEvents() {
  el.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) uploadFile(e.target.files[0]);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove('dragover');
    })
  );
  el.dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  document.querySelectorAll('input[data-kind]').forEach((cb) =>
    cb.addEventListener('change', () => {
      state.filters.kinds[cb.dataset.kind] = cb.checked;
      refresh();
    })
  );
  document.querySelectorAll('input[name="statusFilter"]').forEach((rb) =>
    rb.addEventListener('change', () => {
      if (!rb.checked) return;
      state.filters.status = rb.value;
      refresh();
    })
  );
  // 失败类别复选项按解析结果动态生成，故用事件委托
  if (el.failKinds) {
    el.failKinds.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || !cb.dataset || !cb.dataset.failkind) return;
      state.filters.failKinds[cb.dataset.failkind] = cb.checked;
      refresh();
    });
  }
  el.toolNameFilter.addEventListener('input', (e) => {
    state.filters.toolName = e.target.value;
    refresh();
  });
  el.minChars.addEventListener('input', (e) => {
    state.filters.minChars = Math.max(0, parseInt(e.target.value, 10) || 0);
    refresh();
  });
  el.onlyToolIters.addEventListener('change', (e) => {
    state.filters.onlyToolIters = e.target.checked;
    refresh();
  });
  el.mergeSame.addEventListener('change', (e) => {
    state.filters.mergeSame = e.target.checked;
    refresh();
  });

  document.querySelectorAll('button[data-export]').forEach((btn) =>
    btn.addEventListener('click', () => handleExport(btn.dataset.export))
  );
}

// @anchor: bind_events_end

// @anchor: bind_view_events
// 绑定视图模式切换：调用列表 / 按轮次整理（切换后重绘明细，汇总不变）
function bindViewEvents() {
  document.querySelectorAll('input[name="viewMode"]').forEach((rb) =>
    rb.addEventListener('change', () => {
      if (!rb.checked) return;
      state.view = rb.value;
      if (state.data) renderView();
    })
  );
}
// @anchor: bind_view_events_end


// @anchor: script_init
// 程序入口：绑定事件、视图切换、轮次勾选并加载示例列表
function init() {
  bindEvents();
  bindViewEvents();
  bindRoundsEvents();
  loadExamples();
}

init();

// @anchor: script_init_end
// @anchor: script_file_end
// 脚本文件末尾（无附加逻辑）


