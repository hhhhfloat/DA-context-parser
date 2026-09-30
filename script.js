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

// @anchor: state_init_end

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

// @anchor: dom_refs_end

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
// 解析成功后的入口：更新状态、初始化失败类别筛选并重绘所有区域
function onData(data, name) {
  state.data = data;
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

// 重绘汇总与迭代明细
function refresh() {
  renderSummary();
  renderIterations();
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

// @anchor: export_builders
// 构造各导出格式的文本内容（完整 JSON / 精简 JSON / CSV / Markdown / 纯工具行）
// 附加选项由「含工具参数 / 含工具结果」两个复选框控制：开启后把调用参数与返回结果原文写入导出内容
// 状态与失败信息（状态 / 失败类别 / 失败原因）恒定输出，便于定位失败的调用
function readExportOptions() {
  return {
    args: !!(el.exportArgs && el.exportArgs.checked),
    result: !!(el.exportResult && el.exportResult.checked)
  };
}

// 组装导出数据：可选仅取当前筛选视图，并带上参数/结果附加选项与失败汇总
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
  let toolIters = 0;
  let failedCalls = 0;
  let emptyCalls = 0;
  let noneCalls = 0;
  for (const it of view) {
    if (it.calls.length) toolIters++;
    for (const c of it.calls) {
      calls++;
      chars += c.charLength;
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

function failReasonText(c) {
  if (c.status !== 'fail') return '';
  return c.failReason || normalizeText(c.resultText).split('\n')[0] || '';
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
  const opts = data.opts || { args: false, result: false };
  const payload = {
    generatedAt: new Date().toISOString(),
    file: data.file,
    summary: data.summary,
    include: { toolArgs: !!opts.args, toolResult: !!opts.result }
  };
  const failures = data.failures || (data.summary && data.summary.failures);
  if (failures) payload.failures = failures;
  if (compact) {
    payload.iterations = data.iterations.map((it) => ({
      index: it.index,
      kind: it.kind,
      charLength: it.charLength,
      calls: it.calls.map((c) => {
        const item = {
          name: c.name,
          kind: c.kind,
          status: c.status || 'ok',
          failed: !!c.failed,
          failKind: c.failKind || '',
          failLabel: c.failLabel || '',
          failReason: failReasonText(c),
          charLength: c.charLength,
          argsLength: c.argsLength != null ? c.argsLength : 0,
          resultLength: c.resultLength != null ? c.resultLength : 0,
          mergedCount: c.mergedCount || 1
        };
        if (opts.args) {
          item.args = c.args != null ? c.args : null;
          item.argsText = normalizeText(c.argsText);
        }
        if (opts.result) item.resultText = normalizeText(c.resultText);
        return item;
      })
    }));
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
        failReasonText(c),
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
  let md = '# 上下文工具调用报告\n\n';
  md += '- 文件：' + (data.file.name || '') + '\n';
  md += '- 迭代数：' + s.iterations + '（工具轮次 ' + s.toolIterations + '）\n';
  md += '- 工具调用数：' + s.toolCalls + '（失败 ' + (s.failedCalls || 0) + '，未找到 ' +
    (s.emptyCalls || 0) + '，无记录 ' + (s.noneCalls || 0) + '）\n';
  md += '- 读入 / 写入 / 编译字符：' + s.totals.read.chars + ' / ' + s.totals.write.chars + ' / ' + s.totals.compile.chars + '\n';
  md += '- 涉及字符合计：' + s.totalChars + '\n';
  if (s.failures && s.failures.byKind && s.failures.byKind.length) {
    md += '- 失败类别：' + s.failures.byKind.map((fk) => (fk.label || fk.kind) + ' ' + fk.calls + ' 次').join('、') + '\n';
  }
  md += '- 附加内容：工具参数 ' + (opts.args ? '含' : '不含') + '、工具结果 ' + (opts.result ? '含' : '不含') + '\n\n';
  let head = '| 迭代 | 工具 | 类型 | 状态 | 失败类别 | 失败原因 | 字符长度 |';
  let sep = '| --- | --- | --- | --- | --- | --- | --- |';
  if (opts.args) {
    head += ' 工具参数 |';
    sep += ' --- |';
  }
  if (opts.result) {
    head += ' 工具结果 |';
    sep += ' --- |';
  }
  md += head + '\n' + sep + '\n';
  for (const it of data.iterations) {
    for (const c of it.calls) {
      let row =
        '| #' + it.index + ' | ' + c.name + ' | ' + (KIND_LABEL[c.kind] || c.kind) +
        ' | ' + statusText(c) + ' | ' + mdCell(failKindText(c)) + ' | ' + mdCell(failReasonText(c)) +
        ' | ' + c.charLength + ' |';
      if (opts.args) row += ' ' + mdCell(c.argsText) + ' |';
      if (opts.result) row += ' ' + mdCell(c.resultText) + ' |';
      md += row + '\n';
    }
  }
  return md;
}

function toPlain(data) {
  const opts = data.opts || { args: false, result: false };
  let out = '# 上下文工具调用（含字符长度）\n';
  out += '# 状态列：成功 / 失败 / 未找到 / 无记录，失败行追加失败类别与原因\n';
  out += '# 附加内容：工具参数 ' + (opts.args ? '含' : '不含') + '、工具结果 ' + (opts.result ? '含' : '不含') + '\n';
  for (const it of data.iterations) {
    for (const c of it.calls) {
      out += '#' + it.index + '\t' + c.name + '\t' + (KIND_LABEL[c.kind] || c.kind) + '\t' +
        statusText(c) + '\t' + c.charLength + '\n';
      if (c.status === 'fail') {
        const kindText = failKindText(c);
        out += '  [失败' + (kindText ? '·' + kindText : '') + '] ' + failReasonText(c) + '\n';
      }
      const argsText = normalizeText(c.argsText);
      const resultText = normalizeText(c.resultText);
      if (opts.args && argsText) out += '  [参数]\n' + indentLines(argsText, '    ') + '\n';
      if (opts.result && resultText) out += '  [结果]\n' + indentLines(resultText, '    ') + '\n';
    }
  }
  return out;
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

// @anchor: handle_export
// 依据点击的导出按钮生成对应文件并下载
function handleExport(type) {
  const data = buildExportData();
  if (!data) {
    setStatus('请先加载文件后再导出', 'error');
    return;
  }
  const base = (state.data.file.name || 'context').replace(/\.jsonl(\.gz)?$/i, '').replace(/\.json$/i, '');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
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
  }
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

// @anchor: script_init
// 程序入口：绑定事件并加载示例列表
function init() {
  bindEvents();
  loadExamples();
}

init();

// @anchor: script_init_end
// @anchor: script_file_end
// 脚本文件末尾（无附加逻辑）


