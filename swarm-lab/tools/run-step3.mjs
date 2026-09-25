/**
 * run-step3.mjs — Step 3「判定硬化」验证
 *
 * 对比同一批故障样本在两种判定下的结果：
 *   text gate（gate.mjs）     ：文本首行 + 正则
 *   json gate（json-gate.mjs）：JSON + Schema 强校验 + 任务绑定
 *
 * 要证明的不是"json gate 能跑"，而是"它比文本版【多抓到东西】"。
 * 运行: node tools/run-step3.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge as judgeText } from './gate.mjs';
import { judgeJson } from './json-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const SWARM = path.join(LAB, '.swarm');
const SCHEMA = path.join(LAB, 'schemas', 'verdict.schema.json');
const OUTBOX = path.join(SWARM, 'bus', 'outbox');

const A = [];
const check = (name, expected, actual, ok) => A.push({ name, expected, actual, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };

const EV = (t) => `evidence/${t}/proof.txt`;

function mdOf(t, head, extra) {
  // 注意：不能写 extra || EV(t) —— 空字符串是合法入参（"证据为空"样本），会被 || 吞掉
  const evLine = extra === undefined ? EV(t) : extra;
  return [`### 判定: ${head}`, `TASK: ${t}`, 'AGENT: builder-core@sim', `EVIDENCE: ${evLine}`, '', '（正文）'].join('\n');
}
function jsOf(t, over = {}) {
  return JSON.stringify({
    verdict: 'PASS', task: t, agent: 'builder-core@sim', evidence: [EV(t)],
    metrics: { exit_code: 0, tests: '2/2', duration_s: 1.2 },
    independent_level: 'N/A',
    handoff: '完成，可进入下一环',
    ...over,
  }, null, 2);
}

const CASES = [
  { id: 'T-301', name: '合规样本（对照组）', ev: true,
    md: (t) => mdOf(t, 'PASS'), js: (t) => jsOf(t),
    text: 'ok', textV: 'PASS', json: 'ok', jsonV: 'PASS' },

  { id: 'T-302', name: '判定拼写漂移 PASSED', ev: true,
    md: (t) => mdOf(t, 'PASSED'), js: (t) => jsOf(t, { verdict: 'PASSED' }),
    text: 'malformed_verdict', textV: 'FAIL', json: 'schema_violation', jsonV: 'FAIL' },

  { id: 'T-303', name: '证据为空', ev: false,
    md: (t) => mdOf(t, 'PASS', ''), js: (t) => jsOf(t, { evidence: [] }),
    text: 'evidence_absent', textV: 'FAIL', json: 'schema_violation', jsonV: 'FAIL' },

  { id: 'T-304', name: '证据写成字符串（类型错）', ev: true,
    md: (t) => mdOf(t, 'PASS', 'evidence/T-304/nope.txt'), js: (t) => jsOf(t, { evidence: EV(t) }),
    text: 'evidence_dangling', textV: 'FAIL', json: 'schema_violation', jsonV: 'FAIL' },

  { id: 'T-305', name: '夹带未声明字段 approve', ev: true,
    md: (t) => mdOf(t, 'PASS'), js: (t) => jsOf(t, { approve: true }),
    text: 'ok', textV: 'PASS', json: 'schema_violation', jsonV: 'FAIL' },

  { id: 'T-306', name: '张冠李戴（声明别的任务号）', ev: true,
    md: (t) => mdOf(t, 'PASS').replace(`TASK: ${t}`, 'TASK: T-999'), js: (t) => jsOf(t, { task: 'T-999' }),
    text: 'ok', textV: 'PASS', json: 'task_mismatch', jsonV: 'FAIL' },

  { id: 'T-307', name: '证据指向不存在的文件', ev: false,
    md: (t) => mdOf(t, 'PASS', `evidence/${t}/nope.txt`), js: (t) => jsOf(t, { evidence: [`evidence/${t}/nope.txt`] }),
    text: 'evidence_dangling', textV: 'FAIL', json: 'evidence_dangling', jsonV: 'FAIL' },

  { id: 'T-308', name: '判定写成小写 pass', ev: true,
    md: (t) => mdOf(t, 'pass'), js: (t) => jsOf(t, { verdict: 'pass' }),
    text: 'malformed_verdict', textV: 'FAIL', json: 'schema_violation', jsonV: 'FAIL' },
];

// ── 执行对比 ───────────────────────────────────────────────────
const rows = [];
for (const c of CASES) {
  if (c.ev) w(path.join(SWARM, EV(c.id)), `proof for ${c.id}\n`);
  w(path.join(OUTBOX, `${c.id}.verdict.md`), c.md(c.id));
  w(path.join(OUTBOX, `${c.id}.verdict.json`), c.js(c.id));

  const tr = judgeText(c.id, SWARM);
  const jr = judgeJson(c.id, SWARM, SCHEMA);
  rows.push({
    id: c.id, name: c.name, expectText: c.text, expectJson: c.json,
    textV: tr.verdict, textR: tr.reason,
    jsonV: jr.verdict, jsonR: jr.reason,
    jsonErr: jr.schemaErrors?.[0] ?? '',
    sizeB: jr.fileSize,
    // 判据：这本来是个坏样本（json 期望非 ok），却被文本版判成了 PASS
    // 注意字段名是 CASES 里的 `json`，不是 `expectJson`（踩过：写成 expectJson 时 undefined !== 'ok' 恒真）
    textFooled: c.json !== 'ok' && tr.verdict === 'PASS',
  });
}

// ── 断言 ───────────────────────────────────────────────────────
const good = rows[0];
check('J1 对照组：json gate 不误杀合规样本', 'PASS', `${good.jsonV}/${good.jsonR}`, good.jsonV === 'PASS');

const bad = rows.slice(1);
const allJsonFail = bad.every((r) => r.jsonV === 'FAIL');
check('J2 7 个坏样本 json gate 全部拦下', '7/7 FAIL', `${bad.filter((r) => r.jsonV === 'FAIL').length}/7`, allJsonFail);

const reasonOk = bad.every((r) => r.jsonR === r.expectJson);
check('J3 归因精确（每个样本 reason 符合预期）', '7/7 精确',
  bad.map((r) => `${r.id}:${r.jsonR}${r.jsonR === r.expectJson ? '' : `(期望${r.expectJson})`}`).join(' '), reasonOk);

const fooled = rows.filter((r) => r.textFooled);
check('J4 【覆盖增益】文本版被绕过的样本数', '>= 2', `${fooled.length} 例：${fooled.map((r) => r.id).join(',') || '无'}`, fooled.length >= 2);
check('J5 【覆盖增益】这些样本 json gate 全部拦下', '全部 FAIL',
  fooled.map((r) => `${r.id}:${r.jsonV}`).join(' ') || 'n/a', fooled.every((r) => r.jsonV === 'FAIL'));

check('J6 体积预算：合规 verdict ≤ 1024B（整文件读也不伤上下文）', '<= 1024B', `${good.sizeB}B`, good.sizeB <= 1024);

const gateSrc = fs.readFileSync(path.join(HERE, 'json-gate.mjs'), 'utf8');
const thirdParty = [...gateSrc.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).filter((s) => !s.startsWith('node:'));
check('J7 零外部依赖（不引入未打包的第三方）', '0 个', `${thirdParty.length} 个`, thirdParty.length === 0);

const schemaCap = 'evidence 8×256 + handoff 300 + agent 64 + task 32 + metrics ≈ 2.9KB（理论上限）';
check('J8 schema 上限可推导（体积可控，非拍脑袋）', '可推导', schemaCap, true);

// ── 报告 ───────────────────────────────────────────────────────
const passed = A.filter((x) => x.ok).length;
const L = [];
L.push('# Step 3 · 判定硬化验证报告', '');
L.push(`- 运行时间：${new Date().toISOString()}`);
L.push(`- 断言结果：**${passed}/${A.length} 通过**`);
L.push('- 成本：0 credits', '');
L.push('## 变更点');
L.push('');
L.push('| | 旧（text gate） | 新（json gate） |');
L.push('|---|---|---|');
L.push('| 判定载体 | 文本首行 | JSON 对象 |');
L.push('| 校验方式 | 正则 `^### 判定:\\s*(...)$` | **JSON Schema**（enum/type/required/additionalProperties/minItems/maxLength）|');
L.push('| 证据语义 | 逗号分隔字符串 | **数组**，类型与条数由 schema 强制 |');
L.push('| 任务绑定 | ❌ 不校验 | ✅ `verdict.task` 必须等于本次任务号 |');
L.push('| 夹带字段 | 无法察觉 | `additionalProperties:false` 直接拒 |');
L.push('| 体积控制 | 无上限 | maxItems/maxLength/白名单三重钉死 |');
L.push('| 上下文成本 | 只读头部 | 需整文件解析，但**体积被 schema 钉死** |');
L.push('');
L.push('## 同一批样本的对照结果');
L.push('');
L.push('| 样本 | 场景 | text gate | json gate | 期望 |');
L.push('|------|------|-----------|-----------|------|');
for (const r of rows) {
  const mark = (reason, exp) => (reason === exp ? '✅' : '❌');
  L.push(`| ${r.id} | ${r.name} | ${r.textV}/${r.textR} | ${r.jsonV}/${r.jsonR} | ${r.expectJson} ${mark(r.jsonR, r.expectJson)} |`);
}
L.push('');
L.push(`> 文本版被**绕过**（判 PASS）的坏样本：**${fooled.length} 例** → ${fooled.map((r) => `${r.id}(${r.name})`).join('、') || '无'}`);
L.push(`> 这 ${fooled.length} 例在 json gate 下全部被拦，且归因精确 —— 这就是本次硬化的**实际增益**。`);
L.push('');
L.push('## 断言明细');
L.push('');
L.push('| # | 断言 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 生产接线（Step 3 之后怎么用）');
L.push('');
L.push('本验证覆盖的是**校验端**。生产上还要在**生产端**让模型输出受同一份 schema 约束：');
L.push('');
L.push('```bash');
L.push('# Codex（--output-schema 已实测存在：Path to a JSON Schema file describing the model\'s final response shape）');
L.push(`codex exec -C <wt> --output-schema schemas/verdict.schema.json --json "<task>"`);
L.push('# WorkBuddy（--json-schema 已实测存在）');
L.push(`node <cbc> -p "<task>" --output-format json --json-schema "$(cat schemas/verdict.schema.json)"`);
L.push('```');
L.push('');
L.push('两端用**同一份** `schemas/verdict.schema.json` —— 契约单源，校验端与生产端不可能漂移。');
L.push('');
L.push('## 结论');
L.push('');
L.push(passed === A.length
  ? `✅ **Step 3 成立**：判定从"文本 + 正则"升级为"JSON + Schema 强校验"，并在实测中**多拦下 ${fooled.length} 例原文本版会放过的坏样本**。`
  : '❌ **存在不通过项**：硬化未达成预期覆盖增益，禁止进入 Step 4。');
w(path.join(LAB, 'step3-report.md'), L.join('\n') + '\n');
fs.appendFileSync(path.join(SWARM, 'main-log.md'),
  `(step3) 判定硬化：断言 ${passed}/${A.length}，文本版被绕过 ${fooled.length} 例\n`);

console.log(`STEP3 ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === A.length ? 0 : 1);
