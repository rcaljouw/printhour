import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, set, click, text } from './helpers/app.js';

async function addSupply(h, { name, type = 'hardware', cost = 0.08, stock = 100, low = 20, supplier = '', sku = '', url = '' }) {
  const d = h.document;
  d.getElementById('s_name').value = name;
  d.getElementById('s_type').value = type;
  set(d, 's_cost', cost);
  set(d, 's_stock', stock);
  set(d, 's_low', low);
  d.getElementById('s_supplier').value = supplier;
  d.getElementById('s_sku').value = sku;
  d.getElementById('s_url').value = url;
  click(d, 's_save');
  await h.tick();
  return h.app().DB.supplies.at(-1);
}

describe('supplies', () => {
  test('keeps an article number and an order link', async () => {
    const h = await boot();
    const s = await addSupply(h, {
      name: 'M3x8 heat-set insert', supplier: '123-3D',
      sku: 'M3-INS-8', url: 'https://www.123-3d.nl/artikel/12345'
    });
    assert.equal(s.sku, 'M3-INS-8');
    assert.equal(s.url, 'https://www.123-3d.nl/artikel/12345');
  });

  test('both survive a database round trip', async () => {
    const h = await boot();
    await addSupply(h, { name: 'Doos 20x15x8', type: 'packaging', sku: 'BOX-2015', url: 'https://example.com/box' });

    h.app().sync();
    h.app().DB.supplies.length = 0;
    h.app().load();

    const s = h.app().DB.supplies.find(x => x.name === 'Doos 20x15x8');
    assert.equal(s.sku, 'BOX-2015');
    assert.equal(s.url, 'https://example.com/box');
  });

  test('shows the article number and turns the name into a link', async () => {
    const h = await boot();
    await addSupply(h, { name: 'Magneet 6mm', sku: 'MAG-6', url: 'https://example.com/magnet' });

    const row = [...h.document.querySelectorAll('#s_list .it')]
      .find(el => el.textContent.includes('Magneet 6mm'));
    assert.ok(row, 'item not listed');
    assert.match(row.textContent, /MAG-6/);

    const a = row.querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://example.com/magnet');
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
  });

  test('an item without a link is plain text, not a dead anchor', async () => {
    const h = await boot();
    await addSupply(h, { name: 'Zakje 10x15', sku: 'BAG-1015' });
    const row = [...h.document.querySelectorAll('#s_list .it')]
      .find(el => el.textContent.includes('Zakje 10x15'));
    assert.equal(row.querySelector('a'), null);
  });

  // A url can arrive through the JSON import as well as the form, so the
  // scheme is checked at render time rather than trusted on entry.
  test('refuses to render anything but http and https', async () => {
    const h = await boot();
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd']) {
      await addSupply(h, { name: 'Verdacht ' + bad.slice(0, 6), url: bad });
    }
    const html = h.document.getElementById('s_list').innerHTML;
    assert.ok(!/javascript:/i.test(html), 'javascript: url rendered');
    assert.ok(!/data:text\/html/i.test(html), 'data: url rendered');
    assert.ok(!/file:\/\//i.test(html), 'file: url rendered');
  });

  test('the article number shows up when picking parts for a job', async () => {
    const h = await boot();
    await addSupply(h, { name: 'Inzetmoer', sku: 'INS-M4' });
    const opts = [...h.document.getElementById('c_supPick').options].map(o => o.textContent);
    assert.ok(opts.some(o => o.includes('INS-M4')), opts.join(' | '));
  });

  test('a low-stock warning links straight to the reorder page', async () => {
    const h = await boot();
    await addSupply(h, { name: 'Bijna op', stock: 2, low: 20, url: 'https://example.com/reorder' });
    click(h.document, h.document.getElementById('tabs').querySelector('[data-tab=insights]'));
    await h.tick();

    const warn = [...h.document.querySelectorAll('#i_warn .it')]
      .find(el => el.textContent.includes('Bijna op'));
    assert.ok(warn, 'not flagged as low');
    assert.equal(warn.querySelector('a').getAttribute('href'), 'https://example.com/reorder');
  });
});
