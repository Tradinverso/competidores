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
  assert.match(html, /\/radar\/index\.html/);
});

test("incluye la extracción simplificada y los KPI de cobertura", async () => {
  const [html, dashboard] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /Tu mapa competitivo\./);
  assert.doesNotMatch(html, /Flujo recomendado|en orden de acción/);
  assert.match(dashboard, /Sube aquí el archivo de Mailerfind/);
  assert.doesNotMatch(dashboard, /renderAudienceStep\(item, "following"/);
  assert.doesNotMatch(dashboard, /data-action="reel-csv"/);
  assert.match(dashboard, /Reels de venta/);
  assert.match(dashboard, /Reels de recurso/);
  assert.match(dashboard, /countContacts/);
  assert.match(dashboard, /emails y.*teléfonos/);
  assert.match(dashboard, /both: contacts\.both/);
  assert.match(dashboard, /backfillMissingContactCounts/);
  assert.match(dashboard, /filesMissingBoth/);
  assert.match(dashboard, /CONTACT_COUNT_VERSION = 2/);
  assert.match(dashboard, /Math\.min\(bothEmails\.size, bothPhones\.size\)/);
  assert.match(dashboard, /contactCounts/);
  assert.match(dashboard, /contactBreakdown/);
  assert.match(html, /id="metricContacts"/);
  assert.match(html, /id="metricEmails"/);
  assert.match(html, /id="metricPhones"/);
  assert.match(html, /id="metricBoth"/);
  assert.match(html, /id="metricAudience"/);
  assert.match(html, /id="metricContactsPct"/);
  assert.match(html, /id="metricEmailsPct"/);
  assert.match(html, /id="metricPhonesPct"/);
  assert.match(html, /id="metricBothPct"/);
  assert.match(html, /id="themeToggle"/);
  assert.match(dashboard, /function formatPercent/);
  assert.match(dashboard, /THEME_KEY/);
  assert.match(html, /styles\.css\?v=20260809-kpi-coverage/);
  assert.match(html, /competidores-folders\.js\?v=20260811-drive-links/);
  assert.match(html, /dashboard\.js\?v=20260811-simple-csv/);
  assert.match(dashboard, /COMPETITOR_FOLDERS/);
  assert.match(dashboard, /Abrir la carpeta de seguidores en Drive/);
  assert.match(dashboard, /function renderSingleCsvPanel/);
  assert.match(dashboard, /Abrir carpeta ↗/);
  assert.match(dashboard, /Reemplazar CSV/);
});

test("mantiene la lista limpia y el orden prioritario", async () => {
  const seed = JSON.parse(await readFile(new URL("../app/data/seed.json", import.meta.url), "utf8"));
  const expectedTop = [
    "alexruizn7", "tradinglab.es", "tradeando", "enrique.vv", "traderlabcaademy",
    "sr.machadofx", "amandix.fx", "merytrader212", "fondeapro", "fxtrading.lab",
    "alexosorio.fx", "maldotrading", "belikethealgo", "elsensei", "senseiprofe",
    "jacko_fxc", "alekayfx",
  ];

  assert.equal(seed.length, 282);
  assert.deepEqual(seed.slice(0, expectedTop.length).map((item) => item.username), expectedTop);
  assert.ok(seed.slice(0, expectedTop.length).every((item) => item.priority === "Crítica"));
  assert.ok(seed.every((item) => item.instagramStatus === "ok"));
  assert.equal(new Set(seed.map((item) => item.id)).size, seed.length);
});

test("elimina perfiles retirados sin borrar altas manuales", async () => {
  const dashboard = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
  assert.match(dashboard, /freshById\.has\(item\.id\) \|\| item\.source === "Añadido manualmente"/);
  assert.match(dashboard, /new Set\(merged\.map/);
  assert.match(dashboard, /SEED_ORDER_MIGRATION_KEY/);
});

test("sincroniza datos y CSV con Supabase sin contraseña y sin exponer claves privadas", async () => {
  const [html, dashboard, config] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase-config.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="cloudAccessButton"/);
  assert.ok(html.indexOf("@supabase/supabase-js@2.111.0") < html.indexOf("dashboard.js"));
  assert.match(config, /sb_publishable_/);
  assert.doesNotMatch(config, /service_role|sb_secret_/);
  assert.doesNotMatch(html, /cloudPassword|Entrar al radar/);
  assert.doesNotMatch(dashboard, /signInWithPassword|CLOUD_EMAIL/);
  assert.match(dashboard, /CLOUD_WORKSPACE_ID/);
  assert.match(dashboard, /from\("dashboard_state"\)\.upsert/);
  assert.match(dashboard, /storage\.from\(CLOUD_BUCKET\)\.upload/);
  assert.match(dashboard, /mergeLocalProgressIntoCloud/);
  assert.match(dashboard, /CLOUD_MERGE_KEY/);
  assert.match(dashboard, /setInterval\(pollCloudData, 2500\)/);
  assert.match(dashboard, /Los cambios ya se comparten automáticamente/);
  assert.match(html, /Conectando…/);
});
