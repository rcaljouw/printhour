import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, click } from './helpers/app.js';

async function addSpool(h, { brand = 'Bambu', material = 'PETG', colorName = 'Dennengroen',
  price = 22.99, weight = 1000, stock = 1000, low = 200, supplier = '', sku = '', url = '' }) {
  const d = h.document;
  d.getElementById('f_brand').value = brand;
  d.getElementById('f_material').value = material;
  d.getElementById('f_colorName').value = colorName;
  set(d, 'f_price', price);
  set(d, 'f_weight', weight);
  set(d, 'f_stock', stock);
  set(d, 'f_low', low);
  d.getElementById('f_supplier').value = supplier;
  d.getElementById('f_sku').value = sku;
  d.getElementById('f_url').value = url;
  click(d, 'f_save');
  await h.tick();
  return h.app().DB.filaments.at(-1);
}

const rowFor = (h, needle) =>
  [...h.document.querySelectorAll('#f_list .it')].find(el => el.textContent.includes(needle));

describe('filaments', () => {
  test('keeps an article number and an order link', async () => {
    const h = await boot();
    const f = await addSpool(h, { sku: '30503', url: 'https://eu.store.bambulab.com/products/petg' });
    assert.equal(f.sku, '30503');
    assert.equal(f.url, 'https://eu.store.bambulab.com/products/petg');
  });

  test('both survive a database round trip', async () => {
    const h = await boot();
    await addSpool(h, { material: 'ASA', colorName: 'Wit', sku: 'ASA-W-01', url: 'https://example.com/asa' });

    h.app().sync();
    h.app().DB.filaments.length = 0;
    h.app().load();

    const f = h.app().DB.filaments.find(x => x.material === 'ASA');
    assert.equal(f.sku, 'ASA-W-01');
    assert.equal(f.url, 'https://example.com/asa');
  });

  test('shows the article number and links the spool name', async () => {
    const h = await boot();
    await addSpool(h, { material: 'TPU', sku: 'TPU-95A', url: 'https://example.com/tpu' });
    const row = rowFor(h, 'TPU');
    assert.ok(row, 'spool not listed');
    assert.match(row.textContent, /TPU-95A/);

    const a = row.querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://example.com/tpu');
    assert.match(a.getAttribute('rel'), /noopener/);
  });

  test('a spool without a link stays plain text', async () => {
    const h = await boot();
    await addSpool(h, { material: 'PLA-CF', sku: 'CF-01' });
    assert.equal(rowFor(h, 'PLA-CF').querySelector('a'), null);
  });

  test('refuses to render anything but http and https', async () => {
    const h = await boot();
    await addSpool(h, { material: 'PC', url: 'javascript:alert(1)' });
    await addSpool(h, { material: 'PVA', url: 'data:text/html,<script>x</script>' });
    const html = h.document.getElementById('f_list').innerHTML;
    assert.ok(!/javascript:/i.test(html));
    assert.ok(!/data:text\/html/i.test(html));
  });

  test('a nearly empty spool links straight to the reorder page', async () => {
    const h = await boot();
    await addSpool(h, { material: 'ABS', colorName: 'Zwart', stock: 80, low: 200,
      url: 'https://example.com/abs-zwart' });
    click(h.document, h.document.getElementById('tabs').querySelector('[data-tab=insights]'));
    await h.tick();

    const warn = [...h.document.querySelectorAll('#i_warn .it')]
      .find(el => el.textContent.includes('ABS'));
    assert.ok(warn, 'not flagged as low');
    assert.equal(warn.querySelector('a').getAttribute('href'), 'https://example.com/abs-zwart');
  });

  test('the price change still reaches every product using the spool', async () => {
    const h = await boot();
    const spool = await addSpool(h, { material: 'PETG', price: 22.99, sku: 'PETG-1' });
    const d = h.document;
    d.getElementById('p_filament').value = spool.id;
    d.getElementById('p_name').value = 'Testvaas';
    set(d, 'p_grams', 100);
    click(d, 'p_save');
    await h.tick();

    const product = h.app().DB.products.at(-1);
    const before = h.app().productCost(product).material;

    // Find by article number: the seeded workshop already holds a "Generic PETG".
    const row = rowFor(h, 'PETG-1');
    click(d, [...row.querySelectorAll('.acts button')].find(b => b.textContent === 'edit'));
    set(d, 'f_price', 45.98);
    click(d, 'f_save');
    await h.tick();

    const after = h.app().productCost(h.app().DB.products.at(-1)).material;
    assert.ok(after > before * 1.9, `material ${before} -> ${after}`);
  });
});
