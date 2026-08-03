import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renderiza el radar actualizado", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Radar de Competidores \| Tradingverso<\/title>/i);
  assert.match(html, /Tu mapa competitivo/);
  assert.match(html, /282/);
  assert.match(html, /Enrique Moris/);
  assert.match(html, /@enrique\.vv/);
  assert.match(html, /Mario Casanova/);
  assert.match(html, /@amandix\.fx/);
  assert.match(html, /TradingLab \| Academia de Trading/);
  assert.match(html, /Iñigo Maldonado/);
});

test("mantiene la lista limpia y el orden prioritario", async () => {
  const seed = JSON.parse(await readFile(new URL("../app/data/seed.json", import.meta.url), "utf8"));
  const expectedTop = [
    "fxtrading.lab", "alexosorio.fx", "alexruizn7", "tradinglab.es", "maldotrading", "tradeando", "enrique.vv", "merytrader212",
    "fondeapro", "belikethealgo", "traderlabcaademy", "sr.machadofx", "elsensei",
    "senseiprofe", "jacko_fxc", "amandix.fx", "alekayfx",
  ];

  assert.equal(seed.length, 282);
  assert.deepEqual(seed.slice(0, expectedTop.length).map((item) => item.username), expectedTop);
  assert.ok(seed.slice(0, expectedTop.length).every((item) => item.priority === "Crítica"));
  assert.ok(seed.every((item) => item.instagramStatus === "ok"));
  assert.equal(new Set(seed.map((item) => item.id)).size, seed.length);
});

test("elimina perfiles retirados sin borrar altas manuales", async () => {
  const [page, dashboard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  ]);

  for (const source of [page, dashboard]) {
    assert.match(source, /freshById\.has\(item\.id\) \|\| item\.source === "Añadido manualmente"/);
    assert.match(source, /new Set\(merged\.map/);
    assert.match(source, /SEED_ORDER_MIGRATION_KEY/);
  }
});
