import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, choose, click, text } from './helpers/app.js';

async function addProduct(h, { name, sku = '', collection = '', grams = 100 }) {
  const d = h.document;
  d.getElementById('p_name').value = name;
  d.getElementById('p_sku').value = sku;
  d.getElementById('p_collection').value = collection;
  set(d, 'p_grams', grams);
  click(d, 'p_save');
  await h.tick();
  return h.app().DB.products.at(-1);
}

const names = h => [...h.document.querySelectorAll('#p_list .it .nm b')].map(e => e.textContent);

describe('collections', () => {
  // A collection is a label that can change without the article changing, so
  // it lives in its own field rather than inside the SKU.
  test('is stored separately from the article number', async () => {
    const h = await boot();
    const p = await addProduct(h, { name: 'Pompoen', sku: 'DEC-PMP-01-S-BEI', collection: 'Autumn' });
    assert.equal(p.sku, 'DEC-PMP-01-S-BEI');
    assert.equal(p.collection, 'Autumn');
  });

  test('survives a database round trip', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Kerstbal', sku: 'DEC-XMS-01', collection: 'Christmas' });
    h.app().sync();
    h.app().DB.products.length = 0;
    h.app().load();
    assert.equal(h.app().DB.products.at(-1).collection, 'Christmas');
  });

  test('filters the catalogue, including products without one', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Pompoen', sku: 'A-1', collection: 'Autumn' });
    await addProduct(h, { name: 'Kerstbal', sku: 'C-1', collection: 'Christmas' });
    await addProduct(h, { name: 'Losse vaas', sku: 'V-1' });

    assert.equal(names(h).length, 3);

    choose(h.document, 'p_filter', 'Autumn');
    await h.tick();
    assert.deepEqual(names(h), ['Pompoen']);

    choose(h.document, 'p_filter', '\u2014');
    await h.tick();
    assert.deepEqual(names(h), ['Losse vaas']);

    choose(h.document, 'p_filter', '');
    await h.tick();
    assert.equal(names(h).length, 3);
  });

  test('offers the collections already in use as suggestions', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Pompoen', sku: 'A-1', collection: 'Autumn' });
    await addProduct(h, { name: 'Blad', sku: 'A-2', collection: 'Autumn' });
    await addProduct(h, { name: 'Kerstbal', sku: 'C-1', collection: 'Christmas' });

    const opts = [...h.document.querySelectorAll('#p_collections option')].map(o => o.value);
    assert.deepEqual(opts, ['Autumn', 'Christmas'], 'duplicates should collapse');
  });

  test('shows the collection on the catalogue line', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Pompoen', sku: 'DEC-PMP-01', collection: 'Autumn' });
    const line = h.document.querySelector('#p_list .it .nm small').textContent;
    assert.match(line, /DEC-PMP-01/);
    assert.match(line, /Autumn/);
  });
});

describe('article numbers are unique', () => {
  test('a second product cannot take the same one', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Eerste', sku: 'PP-JAP-01-60-DGR' });
    const before = h.app().DB.products.length;

    await addProduct(h, { name: 'Tweede', sku: 'PP-JAP-01-60-DGR' });
    assert.equal(h.app().DB.products.length, before, 'duplicate was saved anyway');
    assert.match(text(h.document, 'p_status'), /al in gebruik/);
  });

  test('the check ignores case and stray spaces', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Eerste', sku: 'PP-JAP-01' });
    const before = h.app().DB.products.length;
    await addProduct(h, { name: 'Tweede', sku: '  pp-jap-01 ' });
    assert.equal(h.app().DB.products.length, before);
  });

  test('editing a product may keep its own number', async () => {
    const h = await boot();
    const p = await addProduct(h, { name: 'Vaas', sku: 'V-1' });
    const d = h.document;
    click(d, [...d.querySelectorAll('#p_list .acts button')].find(b => b.textContent === 'edit'));
    set(d, 'p_grams', 250);
    click(d, 'p_save');
    await h.tick();
    assert.equal(h.app().DB.products.find(x => x.id === p.id).grams, 250);
    assert.equal(h.app().DB.products.length, 1, 'edit created a second product');
  });

  test('products without a number are left alone', async () => {
    const h = await boot();
    await addProduct(h, { name: 'Eerste' });
    await addProduct(h, { name: 'Tweede' });
    assert.equal(h.app().DB.products.length, 2);
  });

  test('spools and supplies are checked the same way', async () => {
    const h = await boot();
    const d = h.document;
    const spool = (material, sku) => {
      d.getElementById('f_brand').value = 'Bambu';
      d.getElementById('f_material').value = material;
      d.getElementById('f_sku').value = sku;
      click(d, 'f_save');
    };
    spool('PETG', '30503');
    await h.tick();
    const before = h.app().DB.filaments.length;
    spool('PLA', '30503');
    await h.tick();
    assert.equal(h.app().DB.filaments.length, before);
    assert.match(text(d, 'f_status'), /hoort al bij/);
  });
});

describe('order links', () => {
  // The word "bestellen" was doing nothing the underlined title did not
  // already say.
  test('the spool title is the link, with no extra label', async () => {
    const h = await boot();
    const d = h.document;
    d.getElementById('f_brand').value = 'Bambu';
    d.getElementById('f_material').value = 'PLA Matte';
    d.getElementById('f_colorName').value = 'Ivory White';
    d.getElementById('f_sku').value = '11100';
    d.getElementById('f_url').value = 'https://example.com/ivory';
    click(d, 'f_save');
    await h.tick();

    const row = [...d.querySelectorAll('#f_list .it')].find(el => el.textContent.includes('Ivory White'));
    assert.ok(!row.textContent.includes('bestellen'), 'label still present');
    const a = row.querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://example.com/ivory');
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.textContent, /PLA Matte/);
  });
});
