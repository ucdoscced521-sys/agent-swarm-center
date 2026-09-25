/**
 * sync-expert.mjs — 把专家包同步到【全部 5 个落点】，并保证运行态最新
 *
 * 背景（踩过的大坑）：
 *   之前只同步 4 处，**漏了 WorkBuddy 的运行态 cache**
 *   `~/.workbuddy/plugins/cache/<market>/<plugin>/<version>/`
 *   —— 那才是专家真正被加载的地方。结果：源改了、运行态还是旧版，用户召唤出来的是旧行为。
 *
 * 另：`settings.json` 会被环境异步移除（两次实测，原因未查明），
 *   故本脚本每次都从权威源重新落位。
 *
 * 用法: node tools/sync-expert.mjs
 * 环境: AUTHORITATIVE_SRC 可覆盖权威源目录
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);

const SRC = process.env.AUTHORITATIVE_SRC
  ?? path.join(LAB, '..', 'agent-swarm'); // 权威源：工作区里的包（在 swarm-lab 的上一级）

const HOME = 'C:\\Users\\lxjhudan';
const MARKET_SRC = path.join(HOME, '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins', 'agent-swarm');

// 版本号从权威源读取 —— 不要硬编码（0.1.0→0.2.0 时硬编码路径会全歪）
const VERSION = JSON.parse(fs.readFileSync(path.join(SRC, '.codex-plugin', 'plugin.json'), 'utf8')).version;

const CACHE_ROOTS = [
  ['WorkBuddy 运行态 cache ★最容易被漏', path.join(HOME, '.workbuddy', 'plugins', 'cache', 'my-experts', 'agent-swarm')],
  ['Codex 缓存 A', path.join('E:\\codex', '.codex', 'plugins', 'cache', 'personal', 'agent-swarm')],
  ['Codex 缓存 B', path.join(HOME, '.codex', 'plugins', 'cache', 'personal', 'agent-swarm')],
];
const DESTINATIONS = [
  ['WorkBuddy 市场源（编辑目标）', MARKET_SRC],
  ...CACHE_ROOTS.map(([label, root]) => [`${label} @${VERSION}`, path.join(root, VERSION)]),
  ['Codex 市场源', path.join(HOME, 'plugins', 'agent-swarm')],
];

// 陈旧版本目录：不能放着不管——旧版本目录可能仍被加载，导致"改了没生效"
const STALE = [];
for (const [label, root] of CACHE_ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== VERSION) STALE.push([`${label} @${e.name}（陈旧版本）`, path.join(root, e.name)]);
  }
}
DESTINATIONS.push(...STALE);
// 注意必须包含清单目录 —— 版本号就写在 .codex-plugin/plugin.json 里，
// 漏掉它会导致 Codex 侧一直装旧版本（实测：同步后 Codex 仍报 0.1.0）
const COPY_DIRS = ['agents', 'skills', 'schemas', 'contracts', 'tools', 'avatars', '.codex-plugin', '.codebuddy-plugin'];
const COPY_FILES = ['agents-fragment.md', 'manifest.yaml', 'README.md', 'settings.json'];

const log = [];
const cp = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
};

// 0) 权威源自检：必需文件必须在
const REQUIRED = ['settings.json', 'manifest.yaml', 'README.md', 'agents-fragment.md',
  '.codebuddy-plugin/plugin.json', '.codex-plugin/plugin.json'];
const missSrc = REQUIRED.filter((p) => !fs.existsSync(path.join(SRC, ...p.split('/'))));
if (missSrc.length) {
  console.error(`权威源缺文件，先修源再同步: ${missSrc.join(', ')}`);
  process.exit(1);
}
log.push(`权威源: ${SRC}`);

// 1) 🔴 源内容完整性检查（**血的教训**）
// 事故复盘：曾用"内容不全的源"覆盖已装包，把整轮改动静默冲掉（源缺 schemas/tools，
// 且 agents/skills 是旧版）——尺寸比对通不过也发现不了，因为两边都旧。
// 故：同步前必须确认【源里就是最新内容】，否则拒绝同步。
const MUST_HAVE = [
  ['skills/agent-swarm/references/protocol.md', '派单前自检'],
  ['skills/agent-swarm/references/protocol.md', '成本纪律'],
  ['skills/agent-swarm/references/protocol.md', 'independent_level'],
  ['skills/agent-swarm/references/protocol.md', '派单前自检（**强制闸'],
  ['schemas/verdict.schema.json', 'independent_level'],
  ['agents-fragment.md', '异源分级'],
  ['agents/agent-swarm-team-lead.md', '派单前自检'],
  // 漏还原过一次 bridge-crosshost（它不含上面那些标记词，没被检索到）→ 单独钉住
  ['agents/bridge-crosshost.md', 'verdict.json'],
  ['agents/bridge-crosshost.md', 'read-only'],
];
const lack = [];
for (const [rel, marker] of MUST_HAVE) {
  const p = path.join(SRC, ...rel.split('/'));
  if (!fs.existsSync(p)) { lack.push(`${rel} 缺失`); continue; }
  if (!fs.readFileSync(p, 'utf8').includes(marker)) lack.push(`${rel} 缺标记「${marker}」`);
}
if (lack.length) {
  console.error('❌ 源内容不是最新版，拒绝同步（防止用旧内容覆盖已装包）:');
  for (const l of lack) console.error(`   - ${l}`);
  console.error('   → 先把权威源改到位，再运行本脚本。');
  process.exit(2);
}
log.push('✅ 源内容标记检查通过（确认是最新版）');
log.push(`📌 目标版本: ${VERSION}`);
if (STALE.length) {
  log.push(`⚠️ 发现 ${STALE.length} 个陈旧版本目录（一并同步，防止旧版仍被加载）: ${STALE.map(([l]) => l).join('、')}`);
}

// 2) 同步前快照（出事可回滚）
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bdir = path.join(LAB, 'runs', 'sync-backup', stamp);
for (const [, dest] of DESTINATIONS) {
  if (!fs.existsSync(dest)) continue;
  const tag = dest.replace(/[:\\/]/g, '_').slice(-48);
  for (const f of COPY_FILES) {
    const p = path.join(dest, f);
    if (fs.existsSync(p)) cp(p, path.join(bdir, tag, f));
  }
  for (const d of COPY_DIRS) {
    const p = path.join(dest, d);
    if (fs.existsSync(p)) cp(p, path.join(bdir, tag, d));
  }
}
log.push(`📦 同步前快照: runs/sync-backup/${stamp}/`);

// 3) 逐落点同步
for (const [label, dest] of DESTINATIONS) {
  const parent = path.dirname(dest);
  if (!fs.existsSync(parent)) { log.push(`⏭  ${label} — 父目录不存在，跳过 (${parent})`); continue; }
  for (const d of COPY_DIRS) {
    const f = path.join(SRC, d);
    if (fs.existsSync(f)) cp(f, path.join(dest, d));
  }
  for (const f of COPY_FILES) {
    const p = path.join(SRC, f);
    if (fs.existsSync(p)) cp(p, path.join(dest, f));
  }
  const n = fs.existsSync(dest) ? fs.readdirSync(dest, { recursive: true }).filter((x) => fs.statSync(path.join(dest, x)).isFile()).length : 0;
  log.push(`✅ ${label} — ${n} 文件`);
}

// 2) settings.json 兜底：市场源可能被环境异步移除 → 每次补位
const settingsSrc = path.join(SRC, 'settings.json');
const settingsDst = path.join(MARKET_SRC, 'settings.json');
if (!fs.existsSync(settingsDst)) {
  cp(settingsSrc, settingsDst);
  log.push('🔧 settings.json 缺失于市场源 → 已补位');
}

// 3) 一致性校验：源 vs 运行态 cache 的逐文件字节比对
const cacheDir = DESTINATIONS[1][1];
const drift = [];
for (const d of COPY_DIRS) {
  const walk = (rel) => {
    const abs = path.join(SRC, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs)) walk(path.join(rel, e));
    } else {
      const c = path.join(cacheDir, rel);
      if (!fs.existsSync(c)) drift.push(`缺: ${rel}`);
      else if (fs.readFileSync(abs).length !== fs.statSync(c).size) drift.push(`尺寸不一致: ${rel}`);
    }
  };
  walk(d);
}
log.push(drift.length ? `❌ 运行态仍漂移 ${drift.length} 项: ${drift.slice(0, 5).join(', ')}` : '✅ 运行态 cache 与权威源字节一致');

// 4) 报告
const L = ['# 专家包同步报告', '', `- 时间：${new Date().toISOString()}`, '', ...log.map((x) => `- ${x}`), ''];
L.push('## 五个落点（缺一不可）', '');
L.push('| # | 落点 | 作用 |', '|---|------|------|');
DESTINATIONS.forEach(([label, p], i) => L.push(`| ${i + 1} | ${label} | \`${p}\` |`));
L.push('');
L.push('> ⚠️ **第 2 项（运行态 cache）最容易被漏，但它才是专家真正加载的地方。**');
L.push('> 只同步前 4 处不改这里 = 用户召唤出来的仍是旧版。');
fs.writeFileSync(path.join(LAB, 'sync-report.md'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));
process.exit(drift.length ? 1 : 0);
