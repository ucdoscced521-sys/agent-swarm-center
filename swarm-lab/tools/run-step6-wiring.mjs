/**
 * run-step6-wiring.mjs — Step 6：接线校验（验证成果是否真的落进专家包）
 *
 * 背景：swarm-lab 里的六个验证产物（schema / 契约 / 四个工具）**必须**落进专家包，
 * 否则用户召唤出来的还是"验证前那一版"。本步不信任"我改过了"，只信任断言。
 *
 * 运行: node tools/run-step6-wiring.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const PKG = process.env.SWARM_PKG
  ?? 'C:\\Users\\lxjhudan\\.workbuddy\\plugins\\marketplaces\\my-experts\\plugins\\agent-swarm';

const A = [];
const check = (n, e, a, ok) => A.push({ name: n, expected: e, actual: a, ok: !!ok });
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ── W1 六个验证产物都在包里 ───────────────────────────────────
const ARTIFACTS = [
  'schemas/verdict.schema.json',
  'schemas/builder-artifacts.schema.json',
  'contracts/master-capability.json',
  'tools/gate.mjs',
  'tools/json-gate.mjs',
  'tools/capability-guard.mjs',
  'tools/metrics.mjs',
];
const missing = ARTIFACTS.filter((p) => !fs.existsSync(path.join(PKG, ...p.split('/'))));
check('W1 七个验证产物全部落进专家包', '0 缺失', missing.length ? `缺失: ${missing.join(', ')}` : '全部在位', missing.length === 0);

// ── W2 单源契约：包内 schema 与 swarm-lab 的字节一致 ────────────
const pairs = [
  ['schemas/verdict.schema.json', 'schemas/verdict.schema.json'],
  ['schemas/builder-artifacts.schema.json', 'schemas/builder-artifacts.schema.json'],
  ['contracts/master-capability.json', 'contracts/master-capability.json'],
];
const drift = pairs.filter(([a, b]) => {
  const x = rd(path.join(LAB, ...a.split('/')));
  const y = rd(path.join(PKG, ...b.split('/')));
  return x === null || y === null || x !== y;
});
check('W2 单源契约：包内与实验台文件字节一致', '0 漂移', drift.length ? `漂移: ${drift.map((d) => d[0]).join(', ')}` : '三份全部一致', drift.length === 0);

// ── W3 旧协议必须退场：不得再以 `### 判定:` 作为判定形态 ────────
// 精确化：明示"废弃"的说明行不算"当作判定形态"（否则会把弃用公告一起误报）。
// 这类过严检查本身也是 bug 来源：第 7 个脚手架 bug 是 JS 正则 (?m)，这个是第 8 个（误报）。
const mdFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) mdFiles.push(p);
  }
})(PKG);
const DEPRECATED_HINT = /废弃|弃用|deprecated|不再使用/;
const oldProtocolHits = [];
const exempted = [];
for (const f of mdFiles) {
  const lines = (rd(f) ?? '').split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (!/(\n|^)?.{0,8}###\s*判定:/.test(ln) && !/`### 判定:/.test(ln) && !/^###\s*判定:/.test(ln)) return;
    const rel = path.relative(PKG, f);
    if (DEPRECATED_HINT.test(ln)) exempted.push(`${rel}:${i + 1}`);
    else oldProtocolHits.push(`${rel}:${i + 1}`);
  });
}
check('W3 无文件再把 `### 判定:` 当作判定形态', '0 个',
  oldProtocolHits.length ? oldProtocolHits.join(', ') : `0 个（另豁免 ${exempted.length} 处明示废弃的说明）`,
  oldProtocolHits.length === 0);

// ── W4 判定相关文件必须指向 .verdict.json ─────────────────────
const JUDGE_FILES = [
  'skills/agent-swarm/references/protocol.md',
  'skills/agent-swarm/SKILL.md',
  'agents/agent-swarm-team-lead.md',
  'agents/builder-core.md',
  'agents/tester-breaker.md',
  'agents/verifier-independent.md',
  'agents/bridge-crosshost.md',
  'agents-fragment.md',
];
const noJson = JUDGE_FILES.filter((f) => !(rd(path.join(PKG, ...f.split('/'))) ?? '').includes('verdict.json'));
check('W4 八个判定相关文件都指向 verdict.json', '8/8', `${JUDGE_FILES.length - noJson.length}/${JUDGE_FILES.length}` + (noJson.length ? ` 缺: ${noJson.join(', ')}` : ''), noJson.length === 0);

// ── W5 metrics 不得出现 schema 白名单外的字段 ──────────────────
const allowed = new Set(['exit_code', 'tests', 'duration_s']);
const badMetrics = [];
for (const f of mdFiles) {
  const c = rd(f) ?? '';
  const re = /"metrics"\s*:\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(c))) {
    const keys = [...m[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)].map((x) => x[1]);
    const illegal = keys.filter((k) => !allowed.has(k));
    if (illegal.length) badMetrics.push(`${path.relative(PKG, f)}: ${illegal.join('/')}`);
  }
}
check('W5 metrics 字段全部在白名单内', '0 违规', badMetrics.length ? badMetrics.join('; ') : '0 违规', badMetrics.length === 0);

// ── W6 agent frontmatter 仍合规 ───────────────────────────────
// ⚠️ JS 正则不支持 (?m) 内联标志（那是 .NET/PCRE 写法，PowerShell 里能用）
//    必须用 /.../m 或多行 flag 参数。这里踩过一次 SyntaxError。
const agentDir = path.join(PKG, 'agents');
const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.md'));
const FM_CHECKS = [
  ['description', /^description:[ \t]*\S/m],
  ['displayName', /^displayName:/m],
  ['profession', /^profession:/m],
  ['maxTurns', /^maxTurns:[ \t]*\d+/m],
];
const badFm = [];
for (const f of agentFiles) {
  const c = rd(path.join(agentDir, f)) ?? '';
  const name = f.replace(/\.md$/, '');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fail = [];
  if (!new RegExp(`^name:[ \t]*${esc}[ \t]*$`, 'm').test(c)) fail.push('name不匹配文件名');
  for (const [label, re] of FM_CHECKS) if (!re.test(c)) fail.push(`缺${label}`);
  if (/^tools:/m.test(c)) fail.push('出现了禁止的 tools 字段');
  if (fail.length) badFm.push(`${f}(${fail.join('/')})`);
}
check('W6 八个 agent 的 frontmatter 仍合规（含禁止 tools 字段）', '8/8',
  `${agentFiles.length - badFm.length}/${agentFiles.length}` + (badFm.length ? ` 违规: ${badFm.join(', ')}` : ''),
  badFm.length === 0 && agentFiles.length === 8);

// ── W7 主脑提示词必须含能力契约，且不得自相矛盾 ────────────────
const lead = rd(path.join(PKG, 'agents', 'agent-swarm-team-lead.md')) ?? '';
check('W7a 主脑提示词已含能力契约引用', 'contracts/master-capability.json', lead.includes('master-capability.json') ? '已含' : '未含', lead.includes('master-capability.json'));
const denyWrite = /禁止自己写代码|禁止自己写|不得自己写/.test(lead);
check('W7b 主脑提示词保留了"不干活"禁令', 'true', denyWrite ? 'true' : 'false', denyWrite);

// ── W8 必需顶层文件不得静默丢失 ────────────────────────────────
// 事故记录：settings.json 曾在某一步消失（导致 validate 报
// "Team type must have settings.json"），原因未查明。已做实验排除 package_expert.py。
// 教训：必需文件必须有断言守着，否则静默丢失无人发现。
const REQUIRED_TOP = [
  'settings.json', 'manifest.yaml', 'README.md',
  '.codebuddy-plugin/plugin.json', '.codex-plugin/plugin.json',
];
const gone = REQUIRED_TOP.filter((p) => !fs.existsSync(path.join(PKG, ...p.split('/'))));
check('W8 五个必需顶层文件在位', '0 缺失', gone.length ? `缺失: ${gone.join(', ')}` : '全部在位', gone.length === 0);

// ── 报告 ───────────────────────────────────────────────────────
const passed = A.filter((x) => x.ok).length;
const L = [];
L.push('# Step 6 · 接线校验报告', '');
L.push(`- 运行时间：${new Date().toISOString()}`);
L.push(`- 专家包：\`${PKG}\``);
L.push(`- 断言结果：**${passed}/${A.length} 通过**`, '');
L.push('## 检验目标');
L.push('');
L.push('swarm-lab 的验证产物**必须真的落进专家包**，否则用户召唤出来的是"验证前那一版"。');
L.push('本步不信任"我改过了"，只信任断言。', '');
L.push('## 断言明细');
L.push('');
L.push('| # | 断言 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 结论');
L.push('');
L.push(passed === A.length
  ? '✅ **接线成立**：验证成果已在包内，旧文本协议已退场，单源契约无漂移。'
  : '❌ **接线不完整**：存在未落位项，召唤出来的仍可能是旧版本。');
fs.mkdirSync(path.join(LAB, 'runs'), { recursive: true });
fs.writeFileSync(path.join(LAB, 'step6-report.md'), L.join('\n') + '\n', 'utf8');
fs.appendFileSync(path.join(LAB, '.swarm', 'main-log.md'), `(step6) 接线校验：断言 ${passed}/${A.length}\n`);

console.log(`STEP6 ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === A.length ? 0 : 1);
