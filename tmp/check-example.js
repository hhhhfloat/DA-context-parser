// 真实日志回归：解析 example 目录下的转录，确认失败统计与既有字符统计不回归
'use strict';
const fs = require('fs');
const path = require('path');
const projectDir = path.dirname(__dirname);
const parser = require(path.join(projectDir, 'parse.js'));

const dir = path.join(projectDir, 'example');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
files.forEach((name) => {
  const buf = fs.readFileSync(path.join(dir, name));
  const r = parser.analyzeRaw(buf, name);
  console.log('== ' + name);
  console.log('  迭代 ' + r.summary.iterations + ' / 工具轮次 ' + r.summary.toolIterations +
    ' / 调用 ' + r.summary.toolCalls);
  console.log('  读 ' + r.summary.totals.read.chars + ' 写 ' + r.summary.totals.write.chars +
    ' 编译 ' + r.summary.totals.compile.chars + ' 合计 ' + r.summary.totalChars);
  console.log('  失败 ' + r.summary.failedCalls + ' 未找到 ' + r.summary.emptyCalls +
    ' 无记录 ' + r.summary.noneCalls);
  console.log('  失败类别: ' + (r.failures.byKind.map((k) => k.label + '×' + k.calls).join(', ') || '（无）'));
  const statuses = {};
  r.iterations.forEach((it) => it.calls.forEach((c) => {
    statuses[c.status] = (statuses[c.status] || 0) + 1;
  }));
  console.log('  状态分布: ' + JSON.stringify(statuses));
});

// 同时校验 gz 版本解码后统计一致
const gz = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz'));
if (gz.length && files.length) {
  const a = parser.analyzeRaw(fs.readFileSync(path.join(dir, files[0])), files[0]);
  const b = parser.analyzeRaw(fs.readFileSync(path.join(dir, gz[0])), gz[0]);
  console.log('gz 与明文统计一致: ' + (a.summary.toolCalls === b.summary.toolCalls && a.summary.totalChars === b.summary.totalChars));
}
