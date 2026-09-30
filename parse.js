// @anchor: parse_tot_desc
// 上下文转录解析核心：解压、逐行解析 JSONL、合并请求与响应、识别迭代、
// 归类工具（读/写/编译）并统计每次调用涉及的字符长度。

'use strict';

const zlib = require('zlib');

// @anchor: parse_tool_kinds
// 工具分类表：读入(蓝)、写入(红)、编译运行(绿)，未收录者归为其它
const READ_TOOLS = new Set([
  'list_directory',
  'read_file',
  'read_between_anchors',
  'get_file_structure',
  'search_text',
  'find_references',
  'find_callers',
  'find_callees',
  'describe_anchors',
  'list_anchors'
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'insert_at_anchor',
  'delete_between_anchors',
  'delete_file',
  'build_anchor_index'
]);

const COMPILE_TOOLS = new Set(['compile_and_run']);

// 判断工具所属类别，用于前端着色与字符长度取值
function classifyTool(name) {
  if (COMPILE_TOOLS.has(name)) return 'compile';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (READ_TOOLS.has(name)) return 'read';
  return 'other';
}
// @anchor: parse_tool_kinds_end

// @anchor: parse_fail_kinds
// 工具失败判别表：按工具结果文本开头的特征归类（先具体后笼统），集中维护
// 特征来源：workflow-read-only 的 tools 包各工具返回值（❌ 参数/路径/权限/不存在/读写异常、
// 编译失败、运行失败与超时/阻塞、🔍 未找到匹配、📌 无索引等）
const FAIL_KIND_LABEL = {
  security: '安全拦截',
  access: '路径或工作区限制',
  arg: '参数缺失或非法',
  compile: '编译失败',
  run: '运行失败或超时',
  io: '读写或执行异常',
  notfound: '文件或锚点不存在',
  state: '锚点状态冲突',
  other: '其它失败'
};

const EMPTY_KIND_LABEL = { empty: '未找到匹配' };

const FAIL_RULES = [
  { kind: 'security', re: /^❌ 安全扫描拦截/ },
  {
    kind: 'access',
    re: /^(❌ (只能(修改|操作|写入)工作项目|路径中不允许出现|不允许访问以 \. 开头|UPDATE\.md)|⚠️ 不能删除目录)/
  },
  { kind: 'arg', re: /^(❌ (缺少参数|position 必须是|必须指定 file 参数)|未知工具)/ },
  {
    kind: 'compile',
    re: /^(编译失败|❌ (Maven 编译失败|Maven 编译被中断|执行 Maven 失败|在 [^\n]+ 下未找到 pom\.xml))|^⏱️ [^\n]*编译超时|^✅ [\s\S]*但未找到包含 main 方法的类/
  },
  {
    kind: 'run',
    re: /^(运行失败|⛔ |⚠️ [^\n]*启动后立即退出)|^⏱️ [^\n]*运行超时|^✅ [\s\S]*但运行失败/
  },
  {
    kind: 'io',
    re: /^(写入文件失败|读取文件失败|删除文件失败|列出目录失败|编译\/运行异常|单文件 Java 执行异常)|^❌ [^\n]*(插入|删除|读取|描述锚点|解析文件结构|重建锚点索引|刷新锚点位置|刷新项目索引|重建项目索引)失败/
  },
  {
    kind: 'notfound',
    re: /^(❌ (文件|项目目录|路径)不存在|❌ 锚点不存在|❌ 项目路径无效|❌ 无法推导项目|❌ 在文件 [^\n]* 中未找到唯一锚点|文件不存在|路径不存在或不是目录|HTML 文件不存在)|^📌 [^\n]*(不存在|没有锚点记录|尚无项目索引)/
  },
  {
    kind: 'state',
    re: /^⚠️ 两个锚点之间没有内容可(删除|读取)|^❌ (两个锚点不在同一|起始锚点必须在结束锚点之前)/
  },
  { kind: 'other', re: /^(❌|⛔|⏱️|⚠️)/ }
];

const EMPTY_RULES = [{ kind: 'empty', re: /^🔍 未找到/ }];

// @anchor: parse_fail_kinds_end

// @anchor: parse_fail_detect
// 判定单次工具结果状态：ok 成功 / fail 失败 / empty 未找到 / none 无结果记录，并给出失败类别与首行原因
function firstLineOf(text, limit) {
  const line = String(text).split('\n')[0].trim();
  return line.length > limit ? line.slice(0, limit) + '…' : line;
}

function detectResultState(text) {
  const raw = text == null ? '' : String(text);
  const body = raw.trim();
  if (!body) {
    return { status: 'none', kind: '', label: '无结果记录', reason: '' };
  }
  const reason = firstLineOf(body, 200);
  for (const rule of FAIL_RULES) {
    if (rule.re.test(body)) {
      return { status: 'fail', kind: rule.kind, label: FAIL_KIND_LABEL[rule.kind] || rule.kind, reason: reason };
    }
  }
  for (const rule of EMPTY_RULES) {
    if (rule.re.test(body)) {
      return { status: 'empty', kind: rule.kind, label: EMPTY_KIND_LABEL[rule.kind] || rule.kind, reason: reason };
    }
  }
  return { status: 'ok', kind: '', label: '', reason: '' };
}

// 将判定结果回填到调用对象
function applyResultState(call) {
  const verdict = detectResultState(call.resultText);
  call.status = verdict.status;
  call.failed = verdict.status === 'fail';
  call.failKind = verdict.kind;
  call.failLabel = verdict.label;
  call.failReason = verdict.reason;
}

// @anchor: parse_fail_detect_end


// @anchor: parse_decode
// 依据 gzip 魔数决定解压还是按 UTF-8 解码，并去除 BOM
function decodeBuffer(buffer) {
  let buf = buffer;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}
// @anchor: parse_decode_end

// @anchor: parse_jsonl
// 逐行解析 JSONL，记录空行与非法行信息
function parseJsonl(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      errors.push({ line: i + 1, message: e.message });
    }
  }
  return { records, errors, lineCount: lines.length };
}
// @anchor: parse_jsonl_end

// @anchor: parse_hash
// 轻量 djb2 散列，为无标识消息生成稳定去重键
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
// @anchor: parse_hash_end

// @anchor: parse_message_key
// 为消息生成去重键：工具结果用调用ID，助手轮用工具调用ID，其余用角色+内容散列
function messageKey(msg) {
  if (msg.role === 'tool' && msg.tool_call_id) {
    return 'tool|' + msg.tool_call_id;
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return (
      'asst|' +
      msg.tool_calls
        .map((t) => (t && t.id) || (t && t.function && t.function.name) || 'x')
        .join(',')
    );
  }
  const content =
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
  return 'msg|' + (msg.role || '') + '|' + content.length + '|' + hashString(content);
}
// @anchor: parse_message_key_end

// @anchor: parse_merge
// 合并请求累积上下文与响应增量，按键去重并保持顺序，重建完整消息序列
function buildConversation(records) {
  const ordered = [];
  const seen = new Set();
  const toolNames = new Set();
  const responses = [];
  let requestCount = 0;
  let responseCount = 0;

  const push = (msg) => {
    if (!msg || typeof msg !== 'object') return;
    const key = messageKey(msg);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(msg);
  };

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type === 'request') {
      requestCount++;
      const body = rec.body || {};
      if (Array.isArray(body.tools)) {
        for (const t of body.tools) {
          const n = t && t.function && t.function.name;
          if (n) toolNames.add(n);
        }
      }
      if (Array.isArray(body.messages)) {
        body.messages.forEach(push);
      }
    } else if (rec.type === 'response') {
      responseCount++;
      const body = rec.body || {};
      const choice = Array.isArray(body.choices) ? body.choices[0] : null;
      const msg = choice && choice.message ? choice.message : null;
      if (msg) {
        if (body.usage) msg._usage = body.usage;
        msg._source = 'response';
        push(msg);
      }
      responses.push({
        model: body.model || null,
        timestamp: rec.timestamp || null,
        usage: body.usage || null
      });
    }
  }

  return { messages: ordered, toolNames: [...toolNames], requestCount, responseCount, responses };
}
// @anchor: parse_merge_end

// @anchor: parse_char_count
// 计算单次调用字符长度：读入取结果长度，写入取写入内容长度，编译取输出长度
function computeCharLength(call) {
  if (call.kind === 'write') {
    const args = call.args;
    let sum = 0;
    let found = false;
    if (args && typeof args === 'object') {
      for (const key of ['code', 'content']) {
        if (typeof args[key] === 'string') {
          sum += args[key].length;
          found = true;
        }
      }
    }
    return found ? sum : call.argsLength;
  }
  return call.resultLength;
}
// @anchor: parse_char_count_end

// @anchor: parse_extract_calls
// 以助手工具轮次为迭代，提取每轮工具调用，关联工具结果并判定成功/失败状态
function extractIterations(messages) {
  const iterations = [];
  const callIndex = new Map();
  let pendingUser = null;

  for (const msg of messages) {
    const role = msg.role;
    if (role === 'system') continue;

    if (role === 'user') {
      const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      pendingUser = c;
      continue;
    }

    if (role === 'assistant') {
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (calls.length) {
        const iter = {
          index: iterations.length + 1,
          kind: 'tools',
          user: pendingUser,
          assistantText: text,
          reasoning: msg.reasoning_content || '',
          usage: msg._usage || null,
          fromResponse: msg._source === 'response',
          calls: [],
          charLength: 0,
          failCalls: 0,
          emptyCalls: 0,
          totals: { read: 0, write: 0, compile: 0, other: 0 }
        };
        for (const tc of calls) {
          const fn = (tc && tc.function) || {};
          const name = fn.name || 'unknown';
          const argsText =
            typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {});
          let argsObj = null;
          try {
            argsObj = JSON.parse(argsText);
          } catch (e) {
            argsObj = null;
          }
          const call = {
            id: (tc && tc.id) || '',
            name,
            kind: classifyTool(name),
            argsText,
            args: argsObj,
            argsLength: argsText ? argsText.length : 0,
            resultText: '',
            resultLength: 0,
            charLength: 0,
            status: 'none',
            failed: false,
            failKind: '',
            failLabel: '',
            failReason: ''
          };
          iter.calls.push(call);
          if (call.id) callIndex.set(call.id, call);
        }
        iterations.push(iter);
        pendingUser = null;
      } else if (text) {
        iterations.push({
          index: iterations.length + 1,
          kind: 'answer',
          user: pendingUser,
          assistantText: text,
          reasoning: msg.reasoning_content || '',
          usage: msg._usage || null,
          fromResponse: msg._source === 'response',
          calls: [],
          charLength: 0,
          failCalls: 0,
          emptyCalls: 0,
          totals: { read: 0, write: 0, compile: 0, other: 0 }
        });
        pendingUser = null;
      }
      continue;
    }

    if (role === 'tool') {
      const call = msg.tool_call_id ? callIndex.get(msg.tool_call_id) : null;
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content == null
          ? ''
          : JSON.stringify(msg.content);
      if (call) {
        call.resultText = text;
        call.resultLength = text.length;
        applyResultState(call);
      }
    }
  }

  for (const it of iterations) {
    let total = 0;
    for (const call of it.calls) {
      const len = computeCharLength(call);
      call.charLength = len;
      total += len;
      const bucket = it.totals[call.kind] != null ? call.kind : 'other';
      it.totals[bucket] += len;
      if (call.status === 'fail') it.failCalls++;
      else if (call.status === 'empty') it.emptyCalls++;
    }
    it.charLength = total;
  }

  return iterations;
}

// @anchor: parse_extract_calls_end

// @anchor: parse_analyze
// 解析入口：从原始字节产出文件概览、分类统计、失败统计、工具明细与迭代列表
function analyzeRaw(buffer, fileName) {
  const text = decodeBuffer(buffer);
  const parsed = parseJsonl(text);
  const conv = buildConversation(parsed.records);
  const iterations = extractIterations(conv.messages);

  const summary = {
    iterations: iterations.length,
    toolIterations: iterations.filter((it) => it.kind === 'tools').length,
    toolCalls: 0,
    failedCalls: 0,
    emptyCalls: 0,
    noneCalls: 0,
    totals: {
      read: { calls: 0, chars: 0 },
      write: { calls: 0, chars: 0 },
      compile: { calls: 0, chars: 0 },
      other: { calls: 0, chars: 0 }
    },
    totalChars: 0
  };

  const toolStats = {};
  const failKindMap = {};
  const failToolMap = {};

  for (const it of iterations) {
    for (const call of it.calls) {
      summary.toolCalls++;
      const bucket = summary.totals[call.kind] || summary.totals.other;
      bucket.calls++;
      bucket.chars += call.charLength;
      summary.totalChars += call.charLength;
      const st =
        toolStats[call.name] ||
        (toolStats[call.name] = {
          name: call.name,
          kind: call.kind,
          calls: 0,
          chars: 0,
          failed: 0,
          failedChars: 0
        });
      st.calls++;
      st.chars += call.charLength;

      if (call.status === 'fail') {
        summary.failedCalls++;
        st.failed++;
        st.failedChars += call.charLength;
        const fk =
          failKindMap[call.failKind] ||
          (failKindMap[call.failKind] = {
            kind: call.failKind,
            label: call.failLabel || call.failKind,
            calls: 0,
            chars: 0
          });
        fk.calls++;
        fk.chars += call.charLength;
        const ft =
          failToolMap[call.name] ||
          (failToolMap[call.name] = { name: call.name, kind: call.kind, calls: 0, chars: 0 });
        ft.calls++;
        ft.chars += call.charLength;
      } else if (call.status === 'empty') {
        summary.emptyCalls++;
      } else if (call.status === 'none') {
        summary.noneCalls++;
      }
    }
  }

  const failures = {
    calls: summary.failedCalls,
    chars: Object.keys(failKindMap).reduce((sum, k) => sum + failKindMap[k].chars, 0),
    emptyCalls: summary.emptyCalls,
    noneCalls: summary.noneCalls,
    byKind: Object.values(failKindMap).sort((a, b) => b.calls - a.calls || b.chars - a.chars),
    byTool: Object.values(failToolMap).sort((a, b) => b.calls - a.calls || b.chars - a.chars)
  };

  return {
    file: {
      name: fileName || '',
      bytes: buffer.length,
      textLength: text.length,
      lines: parsed.lineCount,
      requests: conv.requestCount,
      responses: conv.responseCount,
      parseErrors: parsed.errors
    },
    tools: conv.toolNames,
    summary,
    failures,
    toolStats: Object.values(toolStats).sort((a, b) => b.chars - a.chars),
    iterations
  };
}

// @anchor: parse_analyze_end

module.exports = { analyzeRaw, decodeBuffer, classifyTool };
