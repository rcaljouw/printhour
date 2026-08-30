/*
 * Every test here corresponds to a bug that actually shipped during
 * development. They are cheap to keep and each one cost real time to find.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, readApp, set, click, text } from './helpers/app.js';

describe('markup hygiene', () => {
  // The status <div> and the status <select> in the quote editor shared an id,
  // so every status message overwrote the dropdown's contents.
  test('no element id appears twice', async () => {
    const h = await boot();
    const ids = [...h.document.querySelectorAll('[id]')].map(e => e.id);
    const seen = new Set(), dupes = new Set();
    ids.forEach(i => (seen.has(i) ? dupes.add(i) : seen.add(i)));
    assert.deepEqual([...dupes], []);
  });

  test('no id appears twice in the source either, including generated markup', () => {
    const ids = [...readApp().matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const counts = {};
    ids.forEach(i => (counts[i] = (counts[i] || 0) + 1));
    assert.deepEqual(Object.entries(counts).filter(([, c]) => c > 1), []);
  });

  test('every id the script reaches for exists in the markup', () => {
    const src = readApp();
    const script = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]).reduce((a, b) => (a.length > b.length ? a : b));
    const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const used = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
    assert.deepEqual([...used].filter(i => !ids.has(i)), []);
  });
});

describe('styling', () => {
  // An author rule beats the UA stylesheet regardless of specificity, so
  // .gate{display:flex} silently defeated the hidden attribute and the
  // startup dialog stayed on top of the whole app.
  test('the hidden attribute wins over author display rules', () => {
    assert.match(readApp(), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  test('the startup gate really closes', async () => {
    const h = await boot({ gate: true });
    assert.equal(h.document.getElementById('gate').hidden, false);
    click(h.document, 'gate_new');
    await h.tick();
    const gate = h.document.getElementById('gate');
    assert.equal(gate.hidden, true);
    assert.equal(gate.style.display, 'none');
  });

  // Dark text on a saturated fill measured 2.47:1. Labels now sit above the
  // bar, on the page background, instead of inside it.
  test('chart labels are not drawn inside the coloured bar', () => {
    const src = readApp();
    assert.ok(!/\.barchart \.track span/.test(src), 'label still positioned inside the track');
    assert.match(src, /\.barchart \.lab/);
  });

  test('a build stamp is visible so the running version is never a guess', async () => {
    const h = await boot();
    assert.match(text(h.document, 'dbbuild'), /build \d{4}-\d{2}-\d{2}/);
  });
});

describe('feedback that survives a re-render', () => {
  // note() used to run before the panel was rebuilt, so the message was
  // destroyed the moment it was written.
  test('saving a quote leaves a visible confirmation', async () => {
    const h = await boot();
    const d = h.document;
    click(d, 'q_new');
    await h.tick();
    click(d, 'qe_save');
    await h.tick();
    assert.match(text(d, 'qe_msg'), /Opgeslagen/);
  });
});

describe('settings', () => {
  // The only save button lived in a different card from the business fields,
  // so a changed business name was never committed and the quote document
  // kept showing the placeholder.
  test('typing a business name is enough to reach the document', async () => {
    const h = await boot();
    const d = h.document;
    click(d, 'q_new');
    await h.tick();

    set(d, 'b_name', 'Caljouw 3D');
    await h.tick();

    assert.equal(h.app().DB.settings.business.name, 'Caljouw 3D');
    assert.match(h.app().quoteDoc(h.app().DB.quotes[0]), /Caljouw 3D/);
  });

  test('a logo is kept with the business details', async () => {
    const h = await boot();
    h.app().DB.settings.business.logo = 'data:image/svg+xml;base64,PHN2Zy8+';
    h.app().sync();
    h.app().load();
    assert.match(h.app().DB.settings.business.logo, /^data:image\/svg/);
  });
});
