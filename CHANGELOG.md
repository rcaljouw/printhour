# Changelog

The build stamp in the app's database bar matches the entries below, so the
running version is never a guess.

## 2026-08-30a

- Portainer builds the stack from `deploy/`, not from the repository root, so
  the compose build context now steps up a level. Deploying straight from the
  repo failed before this.
- Server mode told you "not reachable" whenever a save failed, including when
  the server answered perfectly well and refused to write. Network failures,
  HTTP errors and conflicts are now three separate messages, and the server's
  own reason is shown.
- The server checks at startup that its data directory is writable and exits
  with an explanation if it is not. A read-only mount is the most common
  deployment mistake and it used to look healthy until the first save.

## 2026-08-29b

- Filament spools carry an article number and an order link too, with the same
  scheme check. A spool that drops below its alert level links to where you
  buy it.

## 2026-08-29a

- Supplies now carry an article number and an order link. The item name in the
  hardware list becomes a link, and so does a low-stock warning in Insights —
  the moment you notice you are running out is the moment you want to reorder.
- Only `http` and `https` links are rendered. A url can arrive through the JSON
  import as well as the form, so the scheme is checked at render time.

## 2026-08-28h — first tagged release

The app as it stood when it moved into its own repository, under the name
PrintHour.

**Costing**
- Material, electricity, machine time, labour, hardware and a failure
  allowance, per unit and per batch.
- Setup time is charged once per batch, post-processing per unit.
- Products rank on profit per print hour, not margin per piece.

**Inventory** — filament spools, printer profiles, hardware and packaging,
each with stock levels and alert thresholds.

**Quotes** — multi-line, built from products, with SKUs, per-line stock
deduction, a shortage warning, and a client document in Dutch or English.

**Marketplace** — Etsy, Shopify, eBay, Amazon and direct-sale fee models,
VAT with a KOR switch, reverse pricing, channel comparison, and a monthly
volume scenario against printer capacity.

**Storage** — a single SQLite file the user chooses, written through the File
System Access API, or held on an Umbrel by the bundled server.

### Fixed during development
- `.gate{display:flex}` defeated the `hidden` attribute, leaving the startup
  dialog on top of the app. Author rules beat the UA stylesheet.
- The quote editor's status `<div>` and status `<select>` shared an id.
- `productId` on a quote line was never persisted, so per-line stock
  deduction stopped working after a reload.
- Status messages were written before the panel was rebuilt, so they never
  appeared.
- Saved products omitted setup time and ignored the calculator's purge,
  failure and machine-rate overrides — €3.59 adrift on a €15 part.
- The marketplace calculator ignored VAT, overstating profit by a third.
- Chart labels sat inside the coloured bar at 2.47:1 contrast.

### Known
- `IDB_NAME` is still `printcosting`. It holds the saved file handle;
  renaming it would make existing installs forget their database.
- Persistence rewrites every table on each save. Fine at this size, wrong
  above roughly ten thousand rows.
