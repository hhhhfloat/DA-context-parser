// 静态自检：CSS 花括号配平、HTML 引用齐全、关键选择器与 id 是否都有落脚点
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.dirname(__dirname);

const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');

let open = 0;
let bad = 0;
for (const ch of css) {
  if (ch === '{') open++;
  else if (ch === '}') {
    open--;
    if (open < 0) bad++;
  }
}
console.log('CSS 花括号：剩余 ' + open + '，异常 ' + bad);

const ids = ['dropZone', 'fileInput', 'exampleList', 'status', 'summary', 'summaryCards',
  'toolStats', 'failStats', 'controls', 'iterations', 'toolNameFilter', 'minChars',
  'onlyToolIters', 'mergeSame', 'failKindGroup', 'failKinds', 'exportFiltered',
  'exportReasoning', 'exportArgs', 'exportResult', 'rounds'];
const missingHtml = ids.filter((id) => html.indexOf('id="' + id + '"') < 0);
const missingJs = ids.filter((id) => js.indexOf("getElementById('" + id + "')") < 0);
console.log('HTML 缺失 id：' + (missingHtml.join(',') || '无'));
console.log('JS 缺失 getElementById：' + (missingJs.join(',') || '无'));

const classes = ['rounds-bar', 'round-card__head', 'round-toggle', 'sel-box', 'pair-block',
  'pair-call', 'pair-result', 'result-box', 'result-head__peek', 'btn--mini'];
console.log('CSS 缺失类：' + (classes.filter((c) => css.indexOf('.' + c) < 0).join(',') || '无'));
console.log('JS 缺失类：' + (classes.filter((c) => js.indexOf(c) < 0).join(',') || '无'));

const needExport = ['sel-md', 'sel-json'];
console.log('导出按钮缺失：' + (needExport.filter((t) => html.indexOf('data-export="' + t + '"') < 0).join(',') || '无'));
console.log('脚本引用：style.css=' + (html.indexOf('href="style.css"') >= 0) +
  ', script.js=' + (html.indexOf('src="script.js"') >= 0));
console.log('残留旧选择器 .pair-item-- 出现次数：' + ((css.match(/\.pair-item--/g) || []).length));
console.log('推理开关联动：readExportOptions 含 reasoning=' +
  (js.indexOf('reasoning: !!(el.exportReasoning') >= 0));
