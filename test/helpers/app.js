/*
 * Boots app/index.html inside jsdom with a real SQLite engine and stubbed
 * browser storage, so tests exercise the actual shipped file rather than a
 * copy of its logic.
 *
 * The app runs inside an IIFE, so internals are not reachable from outside.
 * Tests drive it the way a person would: set field values, dispatch events,
 * read the DOM back. Where a test genuinely needs internals, boot() exposes
 * them through a debug hook injected at load time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import initSqlJs from 'sql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const APP = path.join(ROOT, 'app', 'index.html');
const WASM = path.dirname(fileURLToPath(import.meta.resolve('sql.js')));

export function readApp() {
  return fs.readFileSync(APP, 'utf8');
}

/** The app's main <script>, and the page with that script removed. */
export function splitApp() {
  let html = readApp();
  html = html.replace(/<script src="\.\/vendor\/sql-wasm\.js"><\/script>/, '');
  html = html.replace(/<script>\s*\/\* Fall back to a CDN[\s\S]*?<\/script>/, '');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const main = scripts.reduce((a, b) => (a.length > b.length ? a : b));
  return { html: html.replace('<script>' + main + '</script>', ''), main };
}

/** The SCHEMA string and ALTER statements, for storage-level tests. */
export function schema() {
  const src = readApp();
  return {
    create: src.match(/const SCHEMA = `([\s\S]*?)`;/)[1],
    migrations: [...src.matchAll(/'(ALTER TABLE [^']+)'/g)].map(m => m[1])
  };
}

export async function sqlEngine() {
  return initSqlJs({ locateFile: f => path.join(WASM, f) });
}

/**
 * Boot the app. Resolves once the database gate has been dealt with.
 * @param {object} opts
 * @param {ArrayBuffer|null} opts.bytes  existing database to open
 * @param {boolean} opts.gate            leave the startup gate open
 */
export async function boot(opts = {}) {
  const { html, main } = splitApp();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost:8777/index.html'
  });
  const w = dom.window;
  const d = w.document;

  const SQL = await sqlEngine();
  w.initSqlJs = async () => SQL;

  // File System Access, stubbed. Captures whatever the app writes.
  const written = { bytes: null, count: 0 };
  const handle = {
    name: 'printhour.sqlite',
    createWritable: async () => ({
      write: async b => { written.bytes = Buffer.from(b); written.count++; },
      close: async () => {}
    }),
    getFile: async () => ({ arrayBuffer: async () => opts.bytes ?? null }),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted'
  };
  w.showSaveFilePicker = async () => handle;
  w.showOpenFilePicker = async () => [handle];

  // IndexedDB, minimal in-memory stand-in.
  const kv = {};
  w.indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        req.result = {
          createObjectStore() {},
          transaction: () => ({
            objectStore: () => ({
              get(k) { const t = {}; setTimeout(() => { t.result = kv[k]; t.onsuccess?.(); }, 0); return t; },
              put(v, k) { kv[k] = v; const t = {}; setTimeout(() => t.onsuccess?.(), 0); return t; }
            })
          })
        };
        req.onsuccess?.();
      }, 0);
      return req;
    }
  };

  const errors = [];
  w.console.error = (...a) => errors.push(a.map(String).join(' '));

  // Expose internals for the few tests that need them.
  const hook = `window.__app={
    get DB(){return DB}, lastCalc:()=>lastCalc, productCost:p=>productCost(p),
    printerRate:p=>printerRate(p), quoteDoc:q=>quoteDoc(q), quoteText:q=>quoteText(q),
    sync:()=>syncToSqlite(), load:()=>loadFromSqlite(), bytes:()=>sqldb.export()
  };boot();`;
  w.eval(main.replace('boot();', hook));
  await tick(w);

  if (!opts.gate) {
    d.getElementById('gate_new').dispatchEvent(new w.Event('click'));
    await tick(w);
  }

  return { dom, window: w, document: d, app: () => w.__app, errors, written, kv, tick: ms => tick(w, ms) };
}

/**
 * Let the app's debounced writes settle. Milliseconds, not frames: the
 * settings autosave waits 500 ms, so anything shorter reads stale state.
 */
export function tick(w, ms = 700) {
  return new Promise(r => setTimeout(r, ms));
}

/* ---- driving the UI ---- */

export function set(d, id, value) {
  const el = d.getElementById(id);
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input'));
  return el;
}

export function choose(d, id, value) {
  const el = d.getElementById(id);
  el.value = value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change'));
  return el;
}

export function click(d, id) {
  const el = typeof id === 'string' ? d.getElementById(id) : id;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));
  return el;
}

export function text(d, id) {
  return d.getElementById(id)?.textContent ?? '';
}

/**
 * "€ 14,98" -> 14.98, in either locale.
 * Takes the first numeric run only: labels like "€ 15,15excl. VAT" trail a
 * full stop that would otherwise be read as a decimal point.
 */
export function money(str) {
  const src = String(str);
  const neg = /-\s*[\u20ac$\u00a3]?\s*\d|[\u20ac$\u00a3]\s*-\s*\d/.test(src);
  const hit = src.match(/\d[\d.,]*\d|\d/);
  if (!hit) return NaN;
  const m = hit[0];
  const v = m.includes(',') && m.lastIndexOf(',') > m.lastIndexOf('.')
    ? parseFloat(m.replace(/\./g, '').replace(',', '.'))
    : parseFloat(m.replace(/,/g, ''));
  return neg ? -v : v;
}
