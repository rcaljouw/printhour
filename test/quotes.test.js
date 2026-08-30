import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, choose, click, text } from './helpers/app.js';

/** Two products on two different spools, so per-line deduction is testable. */
async function shopWithProducts() {
  const h = await boot();
  const d = h.document;
  set(d, 'd_wage', 50);
  await h.tick();

  const spools = h.app().DB.filaments;   // seeded: PLA and PETG
  const add = (name, sku, spoolId, grams, hrs, price) => {
    choose(d, 'p_filament', spoolId);
    d.getElementById('p_name').value = name;
    d.getElementById('p_sku').value = sku;
    set(d, 'p_grams', grams);
    set(d, 'p_hrs', hrs);
    set(d, 'p_mins', 0);
    set(d, 'p_post', 5);
    set(d, 'p_setup', 10);
    set(d, 'p_batch', 5);
    set(d, 'p_extras', 0.55);
    set(d, 'p_listPrice', price);
    click(d, 'p_save');
  };
  add('Vaas Groot', 'VAAS-GR-01', spools[0].id, 164, 6, 29.95);
  add('Kabelclip', '', spools[1].id, 12, 0.4, 4.95);
  await h.tick();
  return h;
}

function addLine(h, optionIndex, qty) {
  const d = h.document;
  const sel = d.getElementById('ql_product');
  choose(d, 'ql_product', sel.options[optionIndex].value);
  set(d, 'ql_qty', qty);
  click(d, 'ql_add');
}

describe('quote lines', () => {
  test('a quote can hold several different products', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 10);
    await h.tick();
    addLine(h, 2, 25);
    await h.tick();

    const q = h.app().DB.quotes[0];
    assert.equal(q.lines.length, 2);
    assert.equal(q.lines[0].qty, 10);
    assert.equal(q.lines[1].qty, 25);
  });

  test('a line takes its cost from the product, not from the price', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 1);
    await h.tick();

    const line = h.app().DB.quotes[0].lines[0];
    const product = h.app().DB.products.find(p => p.id === line.productId);
    assert.ok(Math.abs(line.cost - h.app().productCost(product).total) < 0.01);
    assert.equal(line.price, 29.95);
  });

  // Regression: productId was set on the line object but never written to
  // SQLite, so reopening a database silently broke per-line stock deduction.
  test('productId and sku survive a database round trip', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 3);
    await h.tick();

    h.app().sync();
    h.app().DB.quotes.length = 0;
    h.app().load();

    const line = h.app().DB.quotes[0].lines[0];
    assert.ok(line.productId, 'productId lost on reload');
    assert.equal(line.sku, 'VAAS-GR-01');
  });
});

describe('stock', () => {
  test('deducts from each line its own spool', async () => {
    const h = await shopWithProducts();
    const before = h.app().DB.filaments.map(f => f.stock);

    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 2, 10);          // clips only
    await h.tick();
    click(h.document, 'qe_deduct');
    await h.tick();

    const after = h.app().DB.filaments.map(f => f.stock);
    assert.equal(after[0], before[0], 'untouched spool changed');
    assert.ok(after[1] < before[1], 'clip spool not deducted');
    // 12 g + 3% purge, ten times
    assert.ok(Math.abs((before[1] - after[1]) - 12 * 1.03 * 10) < 0.5);
  });

  test('warns when the order needs more filament than is on the shelf', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 10);          // 10 × 164 g against a 1000 g spool
    await h.tick();
    click(h.document, 'qe_deduct');
    await h.tick();

    assert.match(text(h.document, 'qe_msg'), /tekort/);
    assert.ok(h.app().DB.filaments[0].stock >= 0, 'stock went negative');
  });

  test('will not deduct the same quote twice', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 2, 5);
    await h.tick();
    click(h.document, 'qe_deduct');
    await h.tick();
    const once = h.app().DB.filaments[1].stock;

    click(h.document, 'qe_deduct');
    await h.tick();
    assert.equal(h.app().DB.filaments[1].stock, once);
  });
});

describe('client document', () => {
  test('shows a SKU column only when a line has one', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 2, 1);           // clip, no SKU
    await h.tick();
    assert.ok(!h.app().quoteDoc(h.app().DB.quotes[0]).includes('SKU'));

    addLine(h, 1, 1);           // vase, has a SKU
    await h.tick();
    const doc = h.app().quoteDoc(h.app().DB.quotes[0]);
    assert.ok(doc.includes('SKU'));
    assert.ok(doc.includes('VAAS-GR-01'));
  });

  test('renders in Dutch and English, with matching number formats', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 2);
    await h.tick();

    const q = h.app().DB.quotes[0];
    q.lang = 'nl';
    const nl = h.app().quoteDoc(q);
    assert.ok(nl.includes('Offerte') && nl.includes('Aantal') && nl.includes('BTW'));
    assert.ok(nl.includes('29,95'), 'Dutch decimal comma missing');

    q.lang = 'en';
    const en = h.app().quoteDoc(q);
    assert.ok(en.includes('Quote') && en.includes('Qty') && en.includes('VAT'));
    assert.ok(en.includes('29.95'), 'English decimal point missing');
    assert.ok(!en.includes('Offerte'));
  });

  test('totals are identical in both languages', async () => {
    const h = await shopWithProducts();
    click(h.document, 'q_new');
    await h.tick();
    addLine(h, 1, 3);
    await h.tick();

    const q = h.app().DB.quotes[0];
    const net = q.lines.reduce((a, l) => a + l.price * l.qty, 0);
    q.lang = 'nl'; const nl = h.app().quoteText(q);
    q.lang = 'en'; const en = h.app().quoteText(q);
    assert.ok(nl.includes('89,85') && en.includes('89.85'), `net ${net}`);
  });
});
