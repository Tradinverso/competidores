const CONFIG_KEYS = Object.freeze({
  supabaseUrl: "SUPABASE_URL",
  supabaseKey: "SUPABASE_SECRET_KEY",
  dashboardUserId: "DASHBOARD_USER_ID",
  spreadsheetId: "SPREADSHEET_ID",
  driveRootFolderId: "DRIVE_ROOT_FOLDER_ID"
});

const MASTER_SHEET = "pestaña 1";
const SYNC_SHEET = "Dashboard";
const STORAGE_BUCKET = "mailerfind";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Dashboard")
    .addItem("Sincronizar ahora", "syncDashboardToSheet")
    .addItem("Recrear conexión automática", "setupSync")
    .addToUi();
}

function setupSync() {
  const missing = getMissingConfig_();
  if (missing.length) throw new Error(`Faltan propiedades: ${missing.join(", ")}`);

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "syncDashboardToSheet")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("syncDashboardToSheet")
    .timeBased()
    .everyMinutes(5)
    .create();

  syncDashboardToSheet();
}

function syncDashboardToSheet() {
  const config = getConfig_();
  const competitors = fetchCompetitors_(config);
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const master = spreadsheet.getSheetByName(MASTER_SHEET);
  if (!master) throw new Error(`No existe la hoja ${MASTER_SHEET}`);

  const lastRow = master.getLastRow();
  if (lastRow < 2) throw new Error("La hoja maestra no contiene competidores");

  const masterValues = master.getRange(2, 1, lastRow - 1, 10).getValues();
  const masterFormulas = master.getRange(2, 1, lastRow - 1, 10).getFormulas();
  const rowByCode = new Map();
  const codeOrder = new Map();
  masterValues.forEach((row, index) => {
    const code = String(row[0] || "").trim();
    if (!code) return;
    rowByCode.set(code, index);
    codeOrder.set(code, index);
  });

  const rootFolder = DriveApp.getFolderById(config.driveRootFolderId);
  const foldersByCode = getCompetitorFolders_(rootFolder);
  const rowsForRepository = masterValues.map(row => [row[7], row[8], row[9]]);
  const syncErrors = [];

  competitors.forEach(competitor => {
    const code = String(competitor.code || "").trim();
    if (!code || !rowByCode.has(code)) return;
    const masterIndex = rowByCode.get(code);
    const extraction = normalizeExtraction_(competitor.extraction);
    rowsForRepository[masterIndex] = [
      Boolean(extraction.salesDone && extraction.resourcesDone),
      Boolean(extraction.followers.done && extraction.following.done),
      String(competitor.notes || "")
    ];

    try {
      mirrorCsvFiles_(competitor, extraction, foldersByCode.get(code), config);
    } catch (error) {
      syncErrors.push(`${code}: ${error.message}`);
    }
  });

  master.getRange(2, 8, rowsForRepository.length, 3).setValues(rowsForRepository);
  writeDashboardSheet_(spreadsheet, competitors, codeOrder, masterValues, masterFormulas);

  PropertiesService.getScriptProperties().setProperties({
    LAST_SYNC_AT: new Date().toISOString(),
    LAST_SYNC_ERRORS: syncErrors.slice(0, 25).join("\n")
  });

  if (syncErrors.length) console.warn(syncErrors.join("\n"));
}

function fetchCompetitors_(config) {
  const query = `dashboard_state?user_id=eq.${encodeURIComponent(config.dashboardUserId)}&select=competitors,updated_at`;
  const response = UrlFetchApp.fetch(`${config.supabaseUrl}/rest/v1/${query}`, {
    method: "get",
    headers: {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Supabase respondió ${response.getResponseCode()}: ${response.getContentText().slice(0, 240)}`);
  }
  const rows = JSON.parse(response.getContentText());
  if (!rows.length || !Array.isArray(rows[0].competitors)) {
    throw new Error("No se encontró el estado del dashboard en Supabase");
  }
  return rows[0].competitors;
}

function writeDashboardSheet_(spreadsheet, competitors, codeOrder, masterValues, masterFormulas) {
  const headers = [
    "Código", "Usuario", "Competidor", "Prioridad", "Seguidores IG", "Seguidos IG",
    "Seguidos extraídos", "Seguidores extraídos", "Reels venta completos", "Nº reels venta",
    "URLs reels venta", "Reels recurso completos", "Nº reels recurso", "URLs reels recurso",
    "CSV cargados", "Emails", "Teléfonos", "Info extraída", "Campaña enviada",
    "Email", "Tráfico", "VSL", "Notas", "Última sincronización",
    "Carpeta Drive", "Carpeta Reels", "Carpeta Seguidores"
  ];

  const folderLinksByCode = new Map();
  masterValues.forEach((row, index) => {
    const code = String(row[0] || "").trim();
    if (!code) return;
    folderLinksByCode.set(code, {
      master: masterFormulas[index][3] || "",
      reels: masterFormulas[index][4] || "",
      followers: masterFormulas[index][5] || ""
    });
  });

  const sorted = competitors.slice().sort((a, b) => {
    const aOrder = codeOrder.has(a.code) ? codeOrder.get(a.code) : Number.MAX_SAFE_INTEGER;
    const bOrder = codeOrder.has(b.code) ? codeOrder.get(b.code) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || Number(a.manualOrder || 0) - Number(b.manualOrder || 0);
  });

  const now = new Date();
  const rows = sorted.map(competitor => {
    const extraction = normalizeExtraction_(competitor.extraction);
    const files = collectFiles_(competitor, extraction).map(item => item.meta).filter(Boolean);
    const channels = competitor.channels || {};
    return [
      competitor.code || "", competitor.username || "", competitor.name || "", competitor.priority || "",
      numberOrBlank_(competitor.followers), numberOrBlank_(competitor.following),
      Boolean(extraction.following.done), Boolean(extraction.followers.done), Boolean(extraction.salesDone),
      extraction.salesReels.length, extraction.salesReels.map(reel => reel.url).filter(Boolean).join("\n"),
      Boolean(extraction.resourcesDone), extraction.resourceReels.length,
      extraction.resourceReels.map(reel => reel.url).filter(Boolean).join("\n"),
      files.length,
      files.reduce((sum, file) => sum + Number(file.emails || 0), 0),
      files.reduce((sum, file) => sum + Number(file.phones || 0), 0),
      Boolean(competitor.studied), Boolean(competitor.campaignSent), Boolean(channels.email),
      Boolean(channels.traffic), Boolean(channels.vsl), String(competitor.notes || ""), now,
      "", "", ""
    ];
  });

  let sheet = spreadsheet.getSheetByName(SYNC_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(SYNC_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#0b2f2a")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setWrap(true);
  if (rows.length) {
    [7, 8, 9, 12, 18, 19, 20, 21, 22].forEach(column => sheet.getRange(2, column, rows.length, 1).insertCheckboxes());
    const usernames = sorted.map(competitor => {
      const username = String(competitor.username || "").trim();
      const richText = SpreadsheetApp.newRichTextValue().setText(username);
      if (username) richText.setLinkUrl(`https://www.instagram.com/${encodeURIComponent(username)}/`);
      return [richText.build()];
    });
    sheet.getRange(2, 2, rows.length, 1).setRichTextValues(usernames);

    const folderFormulas = sorted.map(competitor => {
      const links = folderLinksByCode.get(String(competitor.code || "").trim()) || {};
      return [links.master || "", links.reels || "", links.followers || ""];
    });
    sheet.getRange(2, 25, rows.length, 3).setFormulas(folderFormulas);
    sheet.getRange(2, 11, rows.length, 1).setWrap(true);
    sheet.getRange(2, 14, rows.length, 1).setWrap(true);
    sheet.getRange(2, 24, rows.length, 1).setNumberFormat("yyyy-mm-dd hh:mm");
  }

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  if (rows.length) sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
  sheet.setColumnWidths(1, headers.length, 110);
  sheet.setColumnWidth(2, 155);
  sheet.setColumnWidth(3, 210);
  sheet.setColumnWidth(11, 280);
  sheet.setColumnWidth(14, 280);
  sheet.setColumnWidth(23, 260);
  sheet.setColumnWidths(25, 3, 150);
}

function mirrorCsvFiles_(competitor, extraction, masterFolder, config) {
  if (!masterFolder) return;
  const reelsFolder = getChildFolder_(masterFolder, "Reels");
  const followersFolder = getChildFolder_(masterFolder, "Seguidores");
  collectFiles_(competitor, extraction).forEach(file => {
    if (!file.meta || !file.meta.storagePath) return;
    const targetFolder = file.group === "reels" ? reelsFolder : followersFolder;
    if (!targetFolder) return;
    const fileName = recommendedFileName_(competitor, file);
    if (targetFolder.getFilesByName(fileName).hasNext()) return;
    const path = String(file.meta.storagePath).split("/").map(encodeURIComponent).join("/");
    const response = UrlFetchApp.fetch(`${config.supabaseUrl}/storage/v1/object/authenticated/${STORAGE_BUCKET}/${path}`, {
      method: "get",
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`
      },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`no se pudo descargar ${file.meta.fileName}`);
    }
    targetFolder.createFile(response.getBlob().setName(fileName));
  });
}

function collectFiles_(competitor, extraction) {
  const files = [
    { type: "SIGUE", group: "followers", meta: extraction.following.mailerfind },
    { type: "SEGUIDORES", group: "followers", meta: extraction.followers.mailerfind }
  ];
  extraction.salesReels.forEach(reel => files.push({ type: "VENTA", group: "reels", label: reel.label, meta: reel.mailerfind }));
  extraction.resourceReels.forEach(reel => files.push({ type: "RECURSO", group: "reels", label: reel.label, meta: reel.mailerfind }));
  if (competitor.mailerfind) files.push({ type: "GENERAL", group: "reels", meta: competitor.mailerfind });
  return files;
}

function recommendedFileName_(competitor, file) {
  const code = sanitizePart_(competitor.code || "CXXX");
  const username = sanitizePart_(competitor.username || "usuario");
  const date = String(file.meta.importedAt || new Date().toISOString()).slice(0, 10);
  const parts = [code, username, file.type];
  if (file.label) parts.push(sanitizePart_(file.label));
  parts.push(date);
  return `${parts.join("__")}.csv`;
}

function getCompetitorFolders_(rootFolder) {
  const folders = new Map();
  const iterator = rootFolder.getFolders();
  while (iterator.hasNext()) {
    const folder = iterator.next();
    const match = folder.getName().match(/^(C\d{3})\b/);
    if (match) folders.set(match[1], folder);
  }
  return folders;
}

function getChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : null;
}

function normalizeExtraction_(value) {
  const extraction = value || {};
  return {
    followers: Object.assign({ done: false, mailerfind: null }, extraction.followers || {}),
    following: Object.assign({ done: false, mailerfind: null }, extraction.following || {}),
    salesDone: Boolean(extraction.salesDone),
    resourcesDone: Boolean(extraction.resourcesDone),
    salesReels: Array.isArray(extraction.salesReels) ? extraction.salesReels : [],
    resourceReels: Array.isArray(extraction.resourceReels) ? extraction.resourceReels : []
  };
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    supabaseUrl: String(properties.getProperty(CONFIG_KEYS.supabaseUrl) || "").replace(/\/$/, ""),
    supabaseKey: properties.getProperty(CONFIG_KEYS.supabaseKey) || "",
    dashboardUserId: properties.getProperty(CONFIG_KEYS.dashboardUserId) || "",
    spreadsheetId: properties.getProperty(CONFIG_KEYS.spreadsheetId) || "",
    driveRootFolderId: properties.getProperty(CONFIG_KEYS.driveRootFolderId) || ""
  };
}

function getMissingConfig_() {
  const config = getConfig_();
  return Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
}

function numberOrBlank_(value) {
  return value === null || value === undefined || value === "" ? "" : Number(value);
}

function sanitizePart_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sin-dato";
}
