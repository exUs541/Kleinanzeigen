#!/usr/bin/env node
/**
 * Store credential check.
 *
 * Answers, without changing anything in a store: do the Chrome Web Store and Microsoft
 * Edge Add-ons credentials of this repository still work, and what is live right now?
 *
 *   Chrome: refreshes the OAuth token (this also keeps an idle token alive), then reads
 *           the item status (Chrome Web Store API v2 when CHROME_PUBLISHER_ID is set,
 *           otherwise the legacy v1.1 API).
 *   Edge:   the Publish API has no read-only "who am I" call. This sends one harmless
 *           GET for an operation that does not exist: rejected credentials answer 401/403,
 *           accepted ones answer anything else. The API key also expires after ~72 days,
 *           so the date set in the repository variable EDGE_KEY_EXPIRES is tracked as well.
 *
 * Writes a table to the job summary, annotations for warnings and errors, and one machine
 * readable line starting with "STORE-STATUS " (read by Get-StoreStatus.ps1).
 * Exit code 1 when something needs attention, so GitHub sends a failure e-mail.
 *
 * Needs Node 18+, no dependencies. Secrets are read from the environment, never printed.
 */
import fs from 'node:fs';

const env = (k) => (process.env[k] || '').trim();
const TIMEOUT = 20_000;
const DAY = 86_400_000;

// ── helpers ──────────────────────────────────────────────────────────────────
function readManifest() {
  try {
    const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8').replace(/^﻿/, ''));
    let name = m.name || '';
    const msg = /^__MSG_(.+)__$/.exec(name);
    if (msg) {
      try {
        const loc = m.default_locale || 'en';
        const j = JSON.parse(fs.readFileSync(`_locales/${loc}/messages.json`, 'utf8').replace(/^﻿/, ''));
        name = j[msg[1]]?.message || name;
      } catch { /* keep the placeholder */ }
    }
    return { name: name || env('GITHUB_REPOSITORY'), version: String(m.version || '') };
  } catch {
    return { name: env('GITHUB_REPOSITORY') || 'extension', version: '' };
  }
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

async function http(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, reason: res.statusText || '', json, text };
}

const result = (store, status, message, extra = {}) => ({ store, status, message, ...extra });

// ── Chrome Web Store ─────────────────────────────────────────────────────────
async function checkChrome(manifest) {
  const need = ['CHROME_EXTENSION_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'];
  const missing = need.filter((k) => !env(k));
  if (missing.length === need.length) return result('Chrome', 'skip', 'Not set up (no CHROME_* secrets).');
  if (missing.length) return result('Chrome', 'fail', `Incomplete: missing ${missing.join(', ')}.`);

  const ext = env('CHROME_EXTENSION_ID');
  const publisher = env('CHROME_PUBLISHER_ID');

  // 1. OAuth: the refresh token must still be accepted.
  let token;
  try {
    const r = await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('CHROME_CLIENT_ID'),
        client_secret: env('CHROME_CLIENT_SECRET'),
        refresh_token: env('CHROME_REFRESH_TOKEN'),
        grant_type: 'refresh_token',
      }),
    });
    if (r.status === 200 && r.json?.access_token) {
      token = r.json.access_token;
    } else {
      const code = r.json?.error || `HTTP ${r.status}`;
      const hint = {
        invalid_grant: 'The refresh token expired or was revoked. Create a new one and update CHROME_REFRESH_TOKEN.',
        invalid_client: 'Client ID or client secret is wrong. Check CHROME_CLIENT_ID and CHROME_CLIENT_SECRET.',
      }[code] || (r.json?.error_description || 'Google rejected the login.');
      return result('Chrome', 'fail', `Login rejected (${code}). ${hint}`);
    }
  } catch (e) {
    return result('Chrome', 'warn', `Could not reach Google (${e.name}). Try again later.`);
  }

  const auth = { authorization: `Bearer ${token}` };

  // 2a. Current API (v2) - needs the publisher ID.
  if (publisher) {
    try {
      const r = await http(`https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(ext)}:fetchStatus`, { headers: auth });
      if (r.status === 200 && r.json) {
        const live = r.json.publishedItemRevisionStatus || {};
        const sent = r.json.submittedItemRevisionStatus || {};
        const liveVer = live.distributionChannels?.[0]?.crxVersion || '';
        const sentVer = sent.distributionChannels?.[0]?.crxVersion || '';
        const bits = [];
        bits.push(liveVer ? `live v${liveVer}${live.state ? ` (${live.state})` : ''}` : 'nothing live yet');
        if (sent.state) bits.push(`submission ${sentVer ? 'v' + sentVer + ' ' : ''}${sent.state}`);
        let status = 'ok';
        const notes = [];
        if (r.json.takenDown) { status = 'fail'; notes.push('TAKEN DOWN by the store'); }
        else if (sent.state === 'REJECTED') { status = 'fail'; notes.push('last submission was REJECTED - see the Developer Dashboard'); }
        else if (r.json.warned) { status = 'warn'; notes.push('the store issued a policy warning'); }
        if (manifest.version && liveVer && cmpVersion(manifest.version, liveVer) > 0 && !sentVer) {
          notes.push(`repository has v${manifest.version}, not live yet`);
        }
        return result('Chrome', status, `Login OK, ${bits.join(', ')}${notes.length ? '. ' + notes.join('; ') : ''}.`, {
          storeVersion: liveVer || null, api: 'v2',
        });
      }
      const why = r.status === 404 ? 'extension not found for this publisher ID'
        : (r.status === 401 || r.status === 403) ? 'access denied - check CHROME_PUBLISHER_ID and that the Google account owns the item'
        : (r.json?.error?.message || r.reason || 'unexpected answer');
      return result('Chrome', 'fail', `Login OK, but the status call failed (HTTP ${r.status}): ${why}.`);
    } catch (e) {
      return result('Chrome', 'warn', `Login OK, status call failed (${e.name}).`);
    }
  }

  // 2b. Legacy API (v1.1) - still used when CHROME_PUBLISHER_ID is not set.
  try {
    const r = await http(`https://www.googleapis.com/chromewebstore/v1.1/items/${encodeURIComponent(ext)}?projection=DRAFT`, {
      headers: { ...auth, 'x-goog-api-version': '2' },
    });
    const advice = 'Google planned to retire this old API on 2026-10-15 - add CHROME_PUBLISHER_ID to switch to the current one.';
    if (r.status === 200 && r.json) {
      const up = r.json.uploadState || 'unknown';
      return result('Chrome', 'warn', `Login OK, item found (last upload ${up}). Using the legacy API: ${advice}`, { api: 'v1.1' });
    }
    return result('Chrome', 'fail', `Login OK, but the legacy API answered HTTP ${r.status}. ${advice}`);
  } catch (e) {
    return result('Chrome', 'warn', `Login OK, legacy status call failed (${e.name}).`);
  }
}

// ── Microsoft Edge Add-ons ───────────────────────────────────────────────────
async function checkEdge() {
  const product = env('EDGE_PRODUCT_ID'), client = env('EDGE_CLIENT_ID'), key = env('EDGE_API_KEY');
  // The client ID and API key belong to the account and may be set in every repository;
  // only the product ID says that this extension actually exists on Edge.
  if (!product) return result('Edge', 'skip', 'Not on Edge yet (no EDGE_PRODUCT_ID).');
  if (!client || !key) {
    const missing = ['EDGE_CLIENT_ID', 'EDGE_API_KEY'].filter((k) => !env(k));
    return result('Edge', 'fail', `Incomplete: missing ${missing.join(', ')}.`);
  }

  const notes = [];
  let status = 'ok';
  let expires = null;

  // The API key lives about 72 days; the date is kept in the variable EDGE_KEY_EXPIRES.
  const raw = env('EDGE_KEY_EXPIRES');
  if (raw) {
    const d = new Date(`${raw}T23:59:59Z`);
    if (Number.isNaN(d.getTime())) {
      status = 'warn';
      notes.push(`EDGE_KEY_EXPIRES "${raw}" is not a date (use YYYY-MM-DD)`);
    } else {
      const days = Math.ceil((d.getTime() - Date.now()) / DAY);
      expires = raw;
      if (days < 0) { status = 'fail'; notes.push(`API key EXPIRED ${-days} day(s) ago (${raw})`); }
      else if (days <= 10) { status = 'fail'; notes.push(`API key expires in ${days} day(s) (${raw})`); }
      else notes.push(`API key expires in ${days} days (${raw})`);
    }
  } else {
    notes.push('EDGE_KEY_EXPIRES is not set, so the expiry date cannot be tracked');
    if (status === 'ok') status = 'warn';
  }

  // Read-only probe: a well-formed request for an operation that does not exist.
  try {
    const nil = '00000000-0000-0000-0000-000000000000';
    const r = await http(`https://api.addons.microsoftedge.microsoft.com/v1/products/${encodeURIComponent(product)}/submissions/operations/${nil}`, {
      headers: { authorization: `ApiKey ${key}`, 'x-clientid': client },
    });
    if (r.status === 401 || r.status === 403) {
      status = 'fail';
      notes.unshift(`Credentials REJECTED (HTTP ${r.status}${r.reason ? ' ' + r.reason : ''}). Create a new API key in Partner Center and update EDGE_CLIENT_ID / EDGE_API_KEY`);
    } else if (r.status >= 500) {
      if (status === 'ok') status = 'warn';
      notes.unshift(`Edge API had a problem (HTTP ${r.status}), credentials not verified`);
    } else {
      notes.unshift('Credentials accepted');
    }
  } catch (e) {
    if (status === 'ok') status = 'warn';
    notes.unshift(`Could not reach Edge API (${e.name}), credentials not verified`);
  }

  return result('Edge', status, `${notes.join('. ')}.`, { keyExpires: expires });
}

// ── run ──────────────────────────────────────────────────────────────────────
const manifest = readManifest();
const [chrome, edge] = await Promise.all([checkChrome(manifest), checkEdge()]);
const checks = [chrome, edge];

const icon = { ok: 'OK', warn: 'WARNING', fail: 'FAILED', skip: 'skipped' };
const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';

for (const c of checks) {
  const line = `${c.store}: ${c.message}`;
  if (c.status === 'fail') console.log(`::error title=${c.store} credentials::${c.message}`);
  else if (c.status === 'warn') console.log(`::warning title=${c.store} credentials::${c.message}`);
  else console.log(line);
}

const summary = [
  `### ${manifest.name} v${manifest.version}`,
  '',
  '| Store | Result | Details |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.store} | **${icon[c.status]}** | ${c.message.replace(/\|/g, '\\|')} |`),
  '',
  `Checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
].join('\n');
if (env('GITHUB_STEP_SUMMARY')) fs.appendFileSync(env('GITHUB_STEP_SUMMARY'), summary + '\n');

console.log('STORE-STATUS ' + JSON.stringify({
  repo: env('GITHUB_REPOSITORY'),
  name: manifest.name,
  manifestVersion: manifest.version,
  checkedAt: new Date().toISOString(),
  overall: worst,
  chrome, edge,
}));

process.exit(worst === 'fail' ? 1 : 0);
