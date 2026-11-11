#!/usr/bin/env node
/**
 * Builds the list of files that ship in the store package and verifies it.
 *
 *   node .github/scripts/package-extension.mjs [--list <out.txt>] [--root <dir>]
 *
 * What it does
 *   1. Walks the repository and drops everything that is not part of the running
 *      extension (docs, store screenshots, promo art, presentations, scripts ...).
 *      Repo-specific extras go into an optional `.storeignore` file (one glob per line).
 *   2. Verifies that every file referenced by manifest.json, by the shipped HTML pages
 *      and by the shipped CSS is part of the package - a missing file would only show
 *      up after the store review, as a broken extension for every user.
 *   3. Fails if shipped code mentions a file that was left out on purpose.
 *
 * Needs nothing but Node 18+. Runs identically on a laptop and in GitHub Actions.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const ROOT = path.resolve(opt('--root', process.cwd()));
const LIST_OUT = opt('--list');
const IN_CI = process.env.GITHUB_ACTIONS === 'true';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(IN_CI ? `::error::${msg}` : `ERROR: ${msg}`);
};
const warn = (msg) => console.warn(IN_CI ? `::warning::${msg}` : `WARN:  ${msg}`);

// ---- what never ships ------------------------------------------------------
const EXCLUDE_DIRS = new Set([
  '.git', '.github', '.claude', '.vscode', '.idea', 'node_modules', '__pycache__',
  'docs', 'images', 'pictures', 'screenshots', 'store-assets', 'store_assets',
  'webstore', 'scratch', 'backup', 'test', 'tests',
]);
const EXCLUDE_FILES = [
  /^\./,                                                   // dotfiles
  /\.(md|markdown|pdf|pptx?|zip|psd|ai|sketch|fig|map|log|ps1|sh|bat)$/i,
  /^license(\.|$)/i,
  /^package(-lock)?\.json$/i,
  /^store[_-]screenshot/i,
  /^promo[_-]/i,
  /^test[_-].*\.js$/i,
  /^check\.js$/i,
];

const posix = (p) => p.split(path.sep).join('/');
const globToRegExp = (glob) => {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const src = esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${src}$`, 'i');
};

const storeIgnore = [];
const ignoreFile = path.join(ROOT, '.storeignore');
if (fs.existsSync(ignoreFile)) {
  for (const raw of fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    storeIgnore.push(globToRegExp(line.endsWith('/') ? `${line}**` : line));
  }
}

const included = [];
const excluded = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = posix(path.relative(ROOT, abs));
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (EXCLUDE_DIRS.has(entry.name.toLowerCase())) { collect(abs); continue; }
      walk(abs);
    } else if (entry.isFile()) {
      const skip = EXCLUDE_FILES.some((re) => re.test(entry.name)) || storeIgnore.some((re) => re.test(rel));
      (skip ? excluded : included).push(rel);
    }
  }
  function collect(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const a = path.join(d, e.name);
      if (e.isDirectory()) collect(a); else excluded.push(posix(path.relative(ROOT, a)));
    }
  }
})(ROOT);
included.sort();
const shipped = new Set(included);

// ---- manifest ----------------------------------------------------------------
if (!shipped.has('manifest.json')) { fail('manifest.json is not part of the package.'); process.exit(1); }
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { fail(`manifest.json is not valid JSON: ${e.message}`); process.exit(1); }
if (manifest.manifest_version !== 3) warn(`manifest_version is ${manifest.manifest_version}, expected 3.`);
if (!manifest.version) fail('manifest.json has no "version".');

const messages = (() => {
  const loc = manifest.default_locale;
  if (!loc) return {};
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', loc, 'messages.json'), 'utf8')); } catch { return {}; }
})();
const resolveMsg = (s) => String(s ?? '').replace(/^__MSG_(.+)__$/, (_, k) => messages[k]?.message ?? messages[k.toLowerCase()]?.message ?? s);
const displayName = resolveMsg(manifest.name);

// ---- references --------------------------------------------------------------
const refs = []; // { from, file, optional }
const need = (from, file, optional = false) => { if (file && typeof file === 'string') refs.push({ from, file, optional }); };

const addIcons = (from, v) => {
  if (!v) return;
  if (typeof v === 'string') need(from, v);
  else Object.values(v).forEach((f) => need(from, f));
};
addIcons('manifest.icons', manifest.icons);
for (const key of ['action', 'browser_action', 'page_action']) {
  addIcons(`manifest.${key}.default_icon`, manifest[key]?.default_icon);
  need(`manifest.${key}.default_popup`, manifest[key]?.default_popup);
}
need('manifest.background.service_worker', manifest.background?.service_worker);
(manifest.background?.scripts || []).forEach((f) => need('manifest.background.scripts', f));
(manifest.content_scripts || []).forEach((cs, i) => {
  (cs.js || []).forEach((f) => need(`manifest.content_scripts[${i}].js`, f));
  (cs.css || []).forEach((f) => need(`manifest.content_scripts[${i}].css`, f));
});
need('manifest.options_page', manifest.options_page);
need('manifest.options_ui.page', manifest.options_ui?.page);
need('manifest.side_panel.default_path', manifest.side_panel?.default_path);
need('manifest.devtools_page', manifest.devtools_page);
need('manifest.storage.managed_schema', manifest.storage?.managed_schema);
Object.values(manifest.chrome_url_overrides || {}).forEach((f) => need('manifest.chrome_url_overrides', f));
(manifest.declarative_net_request?.rule_resources || []).forEach((r) => need('manifest.declarative_net_request', r.path));
(manifest.sandbox?.pages || []).forEach((f) => need('manifest.sandbox.pages', f));
if (manifest.default_locale) need('manifest.default_locale', `_locales/${manifest.default_locale}/messages.json`);
for (const group of manifest.web_accessible_resources || []) {
  // Declared-but-absent resources are harmless, so they only warn.
  for (const r of group.resources || []) need('manifest.web_accessible_resources', r, true);
}

const isLocal = (u) => u && !/^([a-z][a-z0-9+.-]*:|\/\/|#|data:|javascript:)/i.test(u);
const clean = (u) => decodeURIComponent(u.split('#')[0].split('?')[0]);
const resolveFrom = (fromFile, u) => posix(path.posix.normalize(u.startsWith('/') ? u.slice(1) : path.posix.join(path.posix.dirname(fromFile), u)));

for (const file of included) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of html.matchAll(/<(?:script|img|source|link|iframe)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (isLocal(m[1])) need(file, resolveFrom(file, clean(m[1])));
    }
    for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
      if (isLocal(m[1]) && /\.html?(?:[?#]|$)/i.test(m[1])) need(file, resolveFrom(file, clean(m[1])));
    }
  } else if (ext === '.css') {
    const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) {
      const u = m[1] || m[2];
      if (isLocal(u)) need(file, resolveFrom(file, clean(u)));
    }
  }
}

for (const { from, file, optional } of refs) {
  const target = clean(file).replace(/^\.?\//, '');
  if (/[*?]/.test(target)) {
    const re = globToRegExp(target);
    if (!included.some((f) => re.test(f))) warn(`${from}: pattern "${file}" matches no packaged file.`);
    continue;
  }
  if (!shipped.has(target)) {
    if (optional) warn(`${from}: "${file}" is not in the package.`);
    else fail(`${from} references "${file}", but it is not part of the package.`);
  }
}

// ---- guard: shipped code must not point at files we left out -----------------
const textExt = new Set(['.js', '.mjs', '.html', '.htm', '.css', '.json']);
const shippedText = included
  .filter((f) => textExt.has(path.extname(f).toLowerCase()))
  .map((f) => ({ f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
for (const ex of excluded) {
  if (/\.(md|markdown|log|map)$/i.test(ex)) continue;            // never loaded at runtime
  const base = path.posix.basename(ex);
  const pathRe = new RegExp(`(^|["'\`(/])${ex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const baseRe = new RegExp(`["'\`/(]${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`)?#]`);
  for (const { f, text } of shippedText) {
    if (pathRe.test(text) || baseRe.test(text)) {
      fail(`${f} mentions "${ex}", which was left out of the package. Remove the reference or allow the file.`);
      break;
    }
  }
}

// ---- report ----------------------------------------------------------------
const size = (f) => fs.statSync(path.join(ROOT, f)).size;
const total = included.reduce((n, f) => n + size(f), 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`Package: ${displayName} v${manifest.version}`);
console.log(`Files:   ${included.length} shipped, ${excluded.length} left out`);
console.log(`Size:    ${kb(total)} uncompressed`);
for (const f of [...included].sort((a, b) => size(b) - size(a)).slice(0, 5)) console.log(`  ${kb(size(f)).padStart(10)}  ${f}`);

if (LIST_OUT) fs.writeFileSync(LIST_OUT, included.join('\n') + '\n');
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `name=${displayName}\nversion=${manifest.version}\nfile_count=${included.length}\nsize_kb=${Math.round(total / 1024)}\n`);
}
process.exit(failed ? 1 : 0);
