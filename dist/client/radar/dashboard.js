(function () {
  "use strict";

  const STORAGE_KEY = "radar-competidores-github-v1";
  const SEED_ORDER_MIGRATION_KEY = "radar-competidores-seed-order-2026-08-03-user-priority";
  const CLOUD_BUCKET = "mailerfind";
  const CLOUD_EMAIL = "tradinverso@gmail.com";
  const MERY_ID = "ig-merytrader212";
  const cloudConfig = window.SUPABASE_CONFIG || {};
  const cloudClient = window.supabase && cloudConfig.url && cloudConfig.publishableKey
    ? window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey)
    : null;
  const priorities = ["Crítica", "Alta", "Media", "Baja"];
  const priorityWeight = { "Crítica": 0, "Alta": 1, "Media": 2, "Baja": 3 };
  const repositoryCodes = window.COMPETITOR_CODES || {};
  function emptyExtractionStep() {
    return { done: false, mailerfind: null };
  }

  function normalizeExtraction(value) {
    const extraction = value && typeof value === "object" ? value : {};
    const normalizeStep = step => ({ ...emptyExtractionStep(), ...(step || {}) });
    const normalizeReel = (reel, index, type) => ({
      id: reel?.id || `${type}-${Date.now()}-${index}`,
      url: reel?.url || "",
      label: reel?.label || "",
      done: Boolean(reel?.done),
      mailerfind: reel?.mailerfind || null
    });
    return {
      followers: normalizeStep(extraction.followers),
      following: normalizeStep(extraction.following),
      salesDone: Boolean(extraction.salesDone),
      resourcesDone: Boolean(extraction.resourcesDone),
      salesReels: Array.isArray(extraction.salesReels) ? extraction.salesReels.map((reel, index) => normalizeReel(reel, index, "venta")) : [],
      resourceReels: Array.isArray(extraction.resourceReels) ? extraction.resourceReels.map((reel, index) => normalizeReel(reel, index, "recurso")) : []
    };
  }

  function normalizeCompetitor(item) {
    return {
      ...item,
      following: item.following ?? null,
      extraction: normalizeExtraction(item.extraction)
    };
  }

  if (Array.isArray(window.SEED_COMPETITORS)) {
    window.SEED_COMPETITORS = window.SEED_COMPETITORS.map(item => {
      const username = String(item.username || (item.instagramUrl?.match(/instagram\.com\/([^/?#]+)/i) || [])[1] || "").toLowerCase();
      return normalizeCompetitor({ ...item, code: item.code || repositoryCodes[username] || "" });
    });
  }
  let cloudSession = null;
  let cloudSaveTimer = null;
  let cloudSaving = false;
  let cloudSaveQueued = false;
  let competitors = loadData();
  let expandedId = null;
  let visibleCount = 40;
  let draggedCompetitorId = null;

  const elements = {
    list: document.getElementById("competitorList"),
    empty: document.getElementById("emptyState"),
    loadMore: document.getElementById("loadMoreButton"),
    search: document.getElementById("searchInput"),
    priority: document.getElementById("priorityFilter"),
    status: document.getElementById("statusFilter"),
    sort: document.getElementById("sortSelect"),
    dialog: document.getElementById("addDialog"),
    addForm: document.getElementById("addForm"),
    toast: document.getElementById("toast"),
    saveState: document.getElementById("saveState"),
    cloudButton: document.getElementById("cloudAccessButton"),
    cloudDialog: document.getElementById("cloudDialog"),
    cloudForm: document.getElementById("cloudForm"),
    cloudPassword: document.getElementById("cloudPassword"),
    cloudMessage: document.getElementById("cloudMessage")
  };

  function mergeSavedData(saved, migrateSeedOrder) {
      const seed = structuredClone(window.SEED_COMPETITORS || []);
      if (!Array.isArray(saved)) return seed;
      const freshById = new Map(seed.map(item => [item.id, item]));
      const merged = saved
        .filter(item => freshById.has(item.id) || item.source === "Añadido manualmente")
        .map(item => {
        const fresh = freshById.get(item.id);
        if (!fresh) return normalizeCompetitor(item);
        const freshTime = fresh.followersUpdatedAt ? Date.parse(fresh.followersUpdatedAt) : 0;
        const savedTime = item.followersUpdatedAt ? Date.parse(item.followersUpdatedAt) : 0;
        return normalizeCompetitor({ ...item, code: fresh.code || item.code || "", instagramStatus: fresh.instagramStatus, ...(fresh.followers != null && freshTime > savedTime ? { followers: fresh.followers, followersUpdatedAt: fresh.followersUpdatedAt } : {}) });
        });
      const savedIds = new Set(merged.map(item => item.id));
      let next = [...merged, ...seed.filter(item => !savedIds.has(item.id))];
      if (migrateSeedOrder && localStorage.getItem(SEED_ORDER_MIGRATION_KEY) !== "done") {
        next = next
          .sort((a, b) => (freshById.get(a.id)?.manualOrder ?? Number.MAX_SAFE_INTEGER) - (freshById.get(b.id)?.manualOrder ?? Number.MAX_SAFE_INTEGER))
          .map((item, index) => ({ ...item, priority: freshById.get(item.id)?.priority ?? item.priority, manualOrder: index + 1 }));
        localStorage.setItem(SEED_ORDER_MIGRATION_KEY, "done");
      }
      return next.map(normalizeCompetitor);
  }

  function loadData() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const data = stored ? mergeSavedData(JSON.parse(stored), true) : structuredClone(window.SEED_COMPETITORS || []);
      const promoted = applyMeryPriority(removeSmallProfiles(data.map(normalizeCompetitor)));
      if (promoted !== data) localStorage.setItem(STORAGE_KEY, JSON.stringify(promoted));
      return promoted;
    } catch (_) {
      return applyMeryPriority(removeSmallProfiles(structuredClone(window.SEED_COMPETITORS || []).map(normalizeCompetitor)));
    }
  }

  function removeSmallProfiles(items) {
    const cleaned = items.filter(item => {
      if (item.followers == null || item.followers === "") return true;
      const followers = Number(item.followers);
      return !Number.isFinite(followers) || followers >= 500;
    });
    if (cleaned.length === items.length) return items;
    return cleaned
      .sort((a, b) => (a.manualOrder ?? Number.MAX_SAFE_INTEGER) - (b.manualOrder ?? Number.MAX_SAFE_INTEGER))
      .map((item, index) => ({ ...item, manualOrder: index + 1 }));
  }

  function applyMeryPriority(items) {
    const mery = items.find(item => item.id === MERY_ID);
    if (!mery || mery.meryPriorityApplied) return items;
    return [...items]
      .sort((a, b) => (a.id === MERY_ID ? -1 : b.id === MERY_ID ? 1 : a.manualOrder - b.manualOrder))
      .map((item, index) => ({ ...item, manualOrder: index + 1, ...(item.id === MERY_ID ? { meryPriorityApplied: true } : {}) }));
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(competitors));
    if (cloudSession) scheduleCloudSave();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function formatFollowers(value) {
    if (value == null || value === "") return "Sin dato";
    return new Intl.NumberFormat("es-ES", { notation: Number(value) >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value));
  }

  function extractionStats(item) {
    const extraction = normalizeExtraction(item.extraction);
    const steps = [extraction.followers.done, extraction.following.done, extraction.salesDone, extraction.resourcesDone];
    const files = [
      extraction.followers.mailerfind,
      extraction.following.mailerfind,
      ...extraction.salesReels.map(reel => reel.mailerfind),
      ...extraction.resourceReels.map(reel => reel.mailerfind),
      item.mailerfind
    ].filter(Boolean);
    return {
      completed: steps.filter(Boolean).length,
      total: steps.length,
      files: files.length,
      emails: files.reduce((sum, file) => sum + Number(file.emails || 0), 0),
      phones: files.reduce((sum, file) => sum + Number(file.phones || 0), 0)
    };
  }

  function countContacts(rows) {
    const emails = new Set();
    const phones = new Set();
    const headers = (rows[0] || []).map(value => String(value || "").toLowerCase());
    const emailColumns = headers.map((header, index) => /e-?mail|correo/.test(header) ? index : -1).filter(index => index >= 0);
    const phoneColumns = headers.map((header, index) => /phone|tel[eé]fono|mobile|m[oó]vil|whatsapp|celular/.test(header) ? index : -1).filter(index => index >= 0);
    rows.slice(1).forEach(row => {
      const emailCells = emailColumns.length ? emailColumns.map(index => row[index]) : row;
      emailCells.forEach(cell => {
        const matches = String(cell || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
        matches.forEach(email => emails.add(email.toLowerCase()));
      });
      const phoneCells = phoneColumns.length ? phoneColumns.map(index => row[index]) : [];
      phoneCells.forEach(cell => {
        const compactPhone = String(cell || "").trim().replace(/[^\d+]/g, "");
        if (/^\+?\d{7,15}$/.test(compactPhone)) phones.add(compactPhone);
      });
    });
    return { emails: emails.size, phones: phones.size };
  }

  function notify(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { elements.toast.hidden = true; }, 3600);
  }

  function setSaveState(label, mode) {
    elements.saveState.classList.toggle("isSyncing", mode === "syncing");
    elements.saveState.classList.toggle("isOffline", mode === "offline");
    elements.saveState.querySelector("span").textContent = label;
  }

  function renderCloudAccount() {
    if (cloudSession) {
      elements.cloudButton.textContent = "Salir de la nube";
      elements.cloudButton.title = cloudSession.user.email || "Sesión activa";
      setSaveState("Guardado en la nube", "cloud");
    } else {
      elements.cloudButton.textContent = "Entrar";
      elements.cloudButton.removeAttribute("title");
      setSaveState("Guardado local", "offline");
    }
  }

  function scheduleCloudSave() {
    clearTimeout(cloudSaveTimer);
    setSaveState("Sincronizando…", "syncing");
    cloudSaveTimer = setTimeout(saveCloudData, 650);
  }

  async function saveCloudData() {
    if (!cloudClient || !cloudSession) return;
    if (cloudSaving) {
      cloudSaveQueued = true;
      return;
    }
    cloudSaving = true;
    const snapshot = structuredClone(competitors);
    const { error } = await cloudClient.from("dashboard_state").upsert({
      user_id: cloudSession.user.id,
      competitors: snapshot,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    cloudSaving = false;
    if (error) {
      setSaveState("Error de sincronización", "offline");
      notify("No se pudo guardar en la nube. La copia local sigue intacta.");
    } else {
      setSaveState("Guardado en la nube", "cloud");
    }
    if (cloudSaveQueued) {
      cloudSaveQueued = false;
      scheduleCloudSave();
    }
  }

  async function loadCloudData(session) {
    setSaveState("Cargando nube…", "syncing");
    const { data, error } = await cloudClient
      .from("dashboard_state")
      .select("competitors")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    if (data && Array.isArray(data.competitors)) {
      competitors = applyMeryPriority(removeSmallProfiles(mergeSavedData(data.competitors, false)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(competitors));
      render();
      scheduleCloudSave();
      return;
    }
    await saveCloudData();
    render();
  }

  async function activateCloud(session) {
    cloudSession = session;
    renderCloudAccount();
    try {
      await loadCloudData(session);
      notify("Radar sincronizado con la nube.");
    } catch (_) {
      setSaveState("Error de sincronización", "offline");
      notify("No se pudo cargar la nube. La copia local sigue disponible.");
    }
  }

  async function setupCloud() {
    renderCloudAccount();
    if (!cloudClient) return;
    const { data } = await cloudClient.auth.getSession();
    if (data.session) await activateCloud(data.session);
    cloudClient.auth.onAuthStateChange((_event, session) => {
      setTimeout(async () => {
        if (session && session.user.id !== cloudSession?.user?.id) await activateCloud(session);
        if (!session && cloudSession) {
          cloudSession = null;
          renderCloudAccount();
          notify("Has salido de la nube. Esta copia queda guardada en el navegador.");
        }
      }, 0);
    });
  }

  function getFiltered() {
    const term = elements.search.value.trim().toLowerCase();
    return [...competitors]
      .filter(item => !term || `${item.code || ""} ${item.name} ${item.username} ${item.notes}`.toLowerCase().includes(term))
      .filter(item => elements.priority.value === "Todas" || item.priority === elements.priority.value)
      .filter(item => {
        if (elements.status.value === "Pendientes") return !item.studied;
        if (elements.status.value === "Información extraída") return item.studied;
        if (elements.status.value === "Con CSV") return extractionStats(item).files > 0;
        if (elements.status.value === "Sin CSV") return extractionStats(item).files === 0;
        if (elements.status.value === "Extracción completa") return extractionStats(item).completed === 4;
        if (elements.status.value === "Extracción incompleta") return extractionStats(item).completed < 4;
        return true;
      })
      .sort((a, b) => {
        if (elements.sort.value === "priority") return priorityWeight[a.priority] - priorityWeight[b.priority] || a.manualOrder - b.manualOrder;
        if (elements.sort.value === "followers") return (b.followers ?? -1) - (a.followers ?? -1);
        if (elements.sort.value === "name") return a.name.localeCompare(b.name, "es");
        return a.manualOrder - b.manualOrder;
      });
  }

  function render() {
    const studied = competitors.filter(item => item.studied).length;
    const critical = competitors.filter(item => item.priority === "Crítica").length;
    const csv = competitors.reduce((sum, item) => sum + extractionStats(item).files, 0);
    const progress = competitors.length ? Math.round(studied / competitors.length * 100) : 0;
    document.getElementById("metricTotal").textContent = competitors.length;
    document.getElementById("metricCritical").textContent = critical;
    document.getElementById("metricStudied").textContent = studied;
    document.getElementById("metricPending").textContent = `${competitors.length - studied} pendientes`;
    document.getElementById("metricCsv").textContent = csv;
    document.getElementById("progressPercent").textContent = `${progress}%`;
    document.getElementById("progressLabel").textContent = `${studied} de ${competitors.length} estudiados`;
    document.getElementById("progressRing").style.setProperty("--progress", `${progress}%`);

    const filtered = getFiltered();
    document.getElementById("resultsCount").textContent = `${filtered.length} resultados`;
    elements.list.innerHTML = filtered.slice(0, visibleCount).map(renderCompetitor).join("");
    elements.empty.hidden = filtered.length > 0;
    elements.loadMore.hidden = visibleCount >= filtered.length;
    elements.loadMore.textContent = `Mostrar 40 más · ${Math.max(filtered.length - visibleCount, 0)} restantes`;
  }

  function csvMetaSummary(meta) {
    if (!meta) return "";
    return `<div class="extractionFile"><span>CSV</span><p><strong>${escapeHtml(meta.fileName)}</strong><small>${meta.rows} registros · ${Number(meta.emails || 0)} emails · ${Number(meta.phones || 0)} teléfonos</small></p></div>`;
  }

  function extractionUpload(item, step, meta, label) {
    const fileKey = `${item.id}__${step}`;
    const recommended = `${item.code || "CXXX"}__${item.username || "usuario"}__${label}__${new Date().toISOString().slice(0, 10)}.csv`;
    return `${csvMetaSummary(meta)}<div class="extractionActions">
      ${meta ? `<button class="button ghost small" data-action="download-extraction" data-id="${item.id}" data-file-key="${escapeHtml(fileKey)}" data-step="${step}" type="button">Descargar</button>` : ""}
      <label class="button ghost small fileButton">${meta ? "Reemplazar" : "Subir CSV"}<input type="file" accept=".csv,text/csv" data-action="extraction-csv" data-id="${item.id}" data-step="${step}" /></label>
    </div><small class="fileNameHint">Nombre recomendado: ${escapeHtml(recommended)}</small>`;
  }

  function renderAudienceStep(item, step, title, typeLabel) {
    const data = item.extraction[step];
    return `<article class="extractionCard${data.done ? " isDone" : ""}">
      <header><label><input type="checkbox" data-action="extraction-step" data-id="${item.id}" data-step="${step}"${data.done ? " checked" : ""} /><span>${title}</span></label><b>${data.done ? "Hecho" : "Pendiente"}</b></header>
      ${extractionUpload(item, step, data.mailerfind, typeLabel)}
    </article>`;
  }

  function renderReelItem(item, reel, type) {
    const typeLabel = type === "sales" ? "VENTA" : "RECURSO";
    const listName = type === "sales" ? "salesReels" : "resourceReels";
    const fileKey = `${item.id}__${type}__${reel.id}`;
    const reelUrl = safeUrl(reel.url);
    const recommended = `${item.code || "CXXX"}__${item.username || "usuario"}__${typeLabel}__${reel.label || "reel"}__${new Date().toISOString().slice(0, 10)}.csv`;
    return `<article class="reelItem${reel.done ? " isDone" : ""}">
      <div class="reelFields">
        <label>URL del reel<div class="inputAction"><input data-action="reel-field" data-id="${item.id}" data-reel-list="${listName}" data-reel-id="${reel.id}" data-reel-field="url" value="${escapeHtml(reel.url)}" placeholder="https://instagram.com/reel/..." />${reelUrl ? `<a href="${escapeHtml(reelUrl)}" target="_blank" rel="noreferrer">Abrir ↗</a>` : ""}</div></label>
        <label>De qué iba<input data-action="reel-field" data-id="${item.id}" data-reel-list="${listName}" data-reel-id="${reel.id}" data-reel-field="label" value="${escapeHtml(reel.label)}" placeholder="webinar, guía IFVG…" /></label>
      </div>
      <div class="reelStatus"><label><input type="checkbox" data-action="reel-done" data-id="${item.id}" data-reel-list="${listName}" data-reel-id="${reel.id}"${reel.done ? " checked" : ""} />Extraído</label><button data-action="remove-reel" data-id="${item.id}" data-reel-list="${listName}" data-reel-id="${reel.id}" type="button" aria-label="Eliminar reel">×</button></div>
      ${csvMetaSummary(reel.mailerfind)}
      <div class="extractionActions">${reel.mailerfind ? `<button class="button ghost small" data-action="download-extraction" data-id="${item.id}" data-file-key="${escapeHtml(fileKey)}" data-reel-list="${listName}" data-reel-id="${reel.id}" type="button">Descargar</button>` : ""}<label class="button ghost small fileButton">${reel.mailerfind ? "Reemplazar" : "Subir CSV"}<input type="file" accept=".csv,text/csv" data-action="reel-csv" data-id="${item.id}" data-reel-list="${listName}" data-reel-id="${reel.id}" /></label></div>
      <small class="fileNameHint">Nombre recomendado: ${escapeHtml(recommended)}</small>
    </article>`;
  }

  function renderReelSection(item, type, title, description) {
    const listName = type === "sales" ? "salesReels" : "resourceReels";
    const doneField = type === "sales" ? "salesDone" : "resourcesDone";
    const reels = item.extraction[listName];
    return `<section class="reelSection${item.extraction[doneField] ? " isDone" : ""}">
      <header><div><h4>${title}</h4><p>${description}</p></div><label><input type="checkbox" data-action="reel-section-done" data-id="${item.id}" data-done-field="${doneField}"${item.extraction[doneField] ? " checked" : ""} />Bloque completo</label></header>
      <div class="reelList">${reels.length ? reels.map(reel => renderReelItem(item, reel, type)).join("") : `<p class="emptyReels">Todavía no has guardado ningún reel.</p>`}</div>
      <button class="addReelButton" data-action="add-reel" data-id="${item.id}" data-reel-list="${listName}" type="button">＋ Añadir reel de ${type === "sales" ? "venta" : "recurso"}</button>
    </section>`;
  }

  function renderCompetitor(item) {
    item = normalizeCompetitor(item);
    const open = item.id === expandedId;
    const instagram = safeUrl(item.instagramUrl);
    const youtube = safeUrl(item.youtubeUrl);
    const priorityOptions = priorities.map(priority => `<option${priority === item.priority ? " selected" : ""}>${priority}</option>`).join("");
    const stats = extractionStats(item);
    const csvState = `<span class="csvState${stats.completed === 4 ? " ready" : ""}"><b>${stats.completed}/4</b><span>${stats.files} CSV<small>${stats.emails} emails · ${stats.phones} teléfonos</small></span></span>`;
    const csvPanel = item.mailerfind
      ? `<div class="fileSummary"><span>CSV</span><p><strong>${escapeHtml(item.mailerfind.fileName)}</strong><small>${item.mailerfind.rows} registros · ${item.mailerfind.columns.length} columnas</small></p></div><div class="csvActions"><button class="button ghost small" data-action="download-csv" data-id="${item.id}" type="button">Descargar</button><label class="button ghost small fileButton">Reemplazar<input type="file" accept=".csv,text/csv" data-action="csv" data-id="${item.id}" /></label></div><div class="csvColumns">${item.mailerfind.columns.slice(0, 6).map(column => `<span>${escapeHtml(column || "Sin título")}</span>`).join("")}</div>`
      : `<label class="dropCsv">＋<strong>Subir CSV de Mailerfind</strong><small>Se guardará asociado a este competidor</small><input type="file" accept=".csv,text/csv" data-action="csv" data-id="${item.id}" /></label>`;

    const channels = item.channels || {};
    const profile = instagram
      ? `<a class="profileLink" href="${escapeHtml(instagram)}" target="_blank" rel="noreferrer" title="Abrir perfil de Instagram">`
      : `<span class="profileLink isUnavailable">`;
    const profileClose = instagram ? "</a>" : "</span>";
    const channelToggle = (channel, label) => `<label class="campaignToggle" title="${label}"><input type="checkbox" data-action="channel" data-channel="${channel}" data-id="${item.id}"${channels[channel] ? " checked" : ""} /><span>${label}</span></label>`;

    const statusCell = `<div class="statusCell">
      <label class="studiedToggle"><input type="checkbox" data-action="studied" data-id="${item.id}"${item.studied ? " checked" : ""} /><span>Info extraída</span></label>
      <label class="studiedToggle campaignSentToggle"><input type="checkbox" data-action="campaign-sent" data-id="${item.id}"${item.campaignSent ? " checked" : ""} /><span>Campaña</span></label>
    </div>`;

    return `<article class="competitor${item.studied ? " isStudied" : ""}" data-id="${item.id}" draggable="${elements.sort.value === "manual"}">
      <div class="competitorRow">
        <div class="orderCell"><strong>${item.manualOrder}</strong><span class="moveButtons"><button data-action="up" data-id="${item.id}"${elements.sort.value !== "manual" ? " disabled" : ""}>↑</button><button data-action="down" data-id="${item.id}"${elements.sort.value !== "manual" ? " disabled" : ""}>↓</button></span></div>
        <div class="identity"><span class="avatarText">${escapeHtml((item.name || item.username).slice(0, 2).toUpperCase())}</span>${profile}<span><strong>${escapeHtml(item.name)}</strong><small>${item.code ? `<b class="competitorCode">${escapeHtml(item.code)}</b>` : ""}${item.username ? `@${escapeHtml(item.username)}` : "Perfil pendiente"}</small></span>${profileClose}</div>
        <select class="prioritySelect priority-${item.priority.toLowerCase()}" data-action="priority" data-id="${item.id}">${priorityOptions}</select>
        <button class="followersButton" data-action="expand" data-id="${item.id}" type="button">${item.instagramStatus === "unavailable" ? "No disponible" : item.instagramStatus === "missing_url" ? "Sin URL" : formatFollowers(item.followers)}<small>${item.followersUpdatedAt ? "Instagram · 03 ago" : item.instagramStatus === "not_found" ? "contador no visible" : "revisar perfil"}</small></button>
        ${channelToggle("email", "Email")}
        ${channelToggle("traffic", "Tráfico")}
        ${channelToggle("vsl", "VSL")}
        ${csvState}
        ${statusCell}
        <button class="expandButton" data-action="expand" data-id="${item.id}" type="button">${open ? "×" : "•••"}</button>
      </div>
      ${open ? `<div class="detailsPanel">
        <div class="detailBlock"><h3>Ficha del competidor</h3>
          <label>Código<input value="${escapeHtml(item.code || "Sin asignar")}" readonly /></label>
          <label>Nombre<input data-field="name" data-id="${item.id}" value="${escapeHtml(item.name)}" /></label>
          <label>Instagram<div class="inputAction"><input data-field="instagramUrl" data-id="${item.id}" value="${escapeHtml(item.instagramUrl)}" placeholder="https://instagram.com/usuario" />${instagram ? `<a href="${escapeHtml(instagram)}" target="_blank" rel="noreferrer">Abrir ↗</a>` : ""}</div></label>
          <label>YouTube<div class="inputAction"><input data-field="youtubeUrl" data-id="${item.id}" value="${escapeHtml(item.youtubeUrl)}" placeholder="Canal de YouTube" />${youtube ? `<a href="${escapeHtml(youtube)}" target="_blank" rel="noreferrer">Abrir ↗</a>` : ""}</div></label>
          <label>Notas<textarea data-field="notes" data-id="${item.id}" placeholder="Oferta, posicionamiento, puntos fuertes…">${escapeHtml(item.notes)}</textarea></label>
          <button class="button danger small" data-action="delete" data-id="${item.id}" type="button">Eliminar competidor</button>
        </div>
        <div class="detailBlock followersBlock"><h3>Audiencia visible</h3><label>Seguidores en Instagram<input data-field="followers" data-id="${item.id}" type="number" min="0" value="${item.followers ?? ""}" placeholder="Ej. 125000" /></label><label>Seguidos en Instagram<input data-field="following" data-id="${item.id}" type="number" min="0" value="${item.following ?? ""}" placeholder="Ej. 820" /></label><div class="automationNote"><span>◎</span><p><strong>Dato del perfil</strong>Estas cifras son distintas de los CSV que Mailerfind extrae de Seguidores y Seguidos.</p></div></div>
        <div class="detailBlock extractionBlock"><h3>Plan de extracción Mailerfind</h3><p class="extractionIntro">Guarda cada extracción por separado para que después pueda cruzarse sin confundir seguidores, seguidos y comentaristas.</p><div class="audienceExtractionGrid">${renderAudienceStep(item, "following", "Seguidos", "SIGUE")}${renderAudienceStep(item, "followers", "Seguidores", "SEGUIDORES")}</div>${renderReelSection(item, "sales", "Reels de venta", "Webinar, plazas, programa o llamada de venta.")}${renderReelSection(item, "resources", "Reels de recurso", "Guías, PDFs o publicaciones tipo «comenta GUÍA».")}${item.mailerfind ? `<div class="legacyCsv"><strong>CSV anterior</strong><p>Este archivo se conserva como carga general.</p>${csvPanel}</div>` : ""}</div>
      </div>` : ""}
    </article>`;
  }

  function update(id, patch) {
    competitors = competitors.map(item => item.id === id ? normalizeCompetitor({ ...item, ...patch }) : item);
    saveData();
    render();
  }

  function updateExtraction(id, mutate) {
    competitors = competitors.map(item => {
      if (item.id !== id) return item;
      const extraction = normalizeExtraction(item.extraction);
      mutate(extraction);
      return normalizeCompetitor({ ...item, extraction });
    });
    saveData();
    render();
  }

  function getExtractionMeta(item, target) {
    const extraction = normalizeExtraction(item.extraction);
    if (target.step) return extraction[target.step]?.mailerfind || null;
    const list = extraction[target.reelList] || [];
    return list.find(reel => reel.id === target.reelId)?.mailerfind || null;
  }

  function setExtractionMeta(id, target, meta) {
    updateExtraction(id, extraction => {
      if (target.step) {
        extraction[target.step] = { ...extraction[target.step], mailerfind: meta, done: true };
        return;
      }
      extraction[target.reelList] = extraction[target.reelList].map(reel => reel.id === target.reelId ? { ...reel, mailerfind: meta, done: true } : reel);
    });
  }

  function move(id, direction) {
    const ordered = [...competitors].sort((a, b) => a.manualOrder - b.manualOrder);
    const index = ordered.findIndex(item => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const order = ordered[index].manualOrder;
    ordered[index].manualOrder = ordered[target].manualOrder;
    ordered[target].manualOrder = order;
    competitors = ordered.sort((a, b) => a.manualOrder - b.manualOrder);
    saveData();
    render();
  }

  function moveToPosition(id, targetId) {
    if (id === targetId) return;
    const ordered = [...competitors].sort((a, b) => a.manualOrder - b.manualOrder);
    const from = ordered.findIndex(item => item.id === id);
    const to = ordered.findIndex(item => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item);
    competitors = ordered.map((candidate, index) => ({ ...candidate, manualOrder: index + 1 }));
    saveData();
    render();
  }

  async function removeCompetitor(id) {
    const item = competitors.find(candidate => candidate.id === id);
    if (!item || !window.confirm(`¿Eliminar a ${item.name}? Esta acción no se puede deshacer.`)) return;
    if (cloudSession) {
      const extraction = normalizeExtraction(item.extraction);
      const storagePaths = [
        item.mailerfind?.storagePath,
        extraction.followers.mailerfind?.storagePath,
        extraction.following.mailerfind?.storagePath,
        ...extraction.salesReels.map(reel => reel.mailerfind?.storagePath),
        ...extraction.resourceReels.map(reel => reel.mailerfind?.storagePath)
      ].filter(Boolean);
      if (storagePaths.length) await cloudClient.storage.from(CLOUD_BUCKET).remove(storagePaths);
    }
    competitors = competitors.filter(item => item.id !== id).sort((a, b) => a.manualOrder - b.manualOrder).map((item, index) => ({ ...item, manualOrder: index + 1 }));
    if (expandedId === id) expandedId = null;
    saveData();
    render();
    notify("Competidor eliminado.");
  }

  function parseCsv(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [], value = "", quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i], next = text[i + 1];
      if (char === '"' && quoted && next === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { row.push(value.trim()); value = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") i += 1; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
      else value += char;
    }
    row.push(value.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function openCsvDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("radar-competidores-github-files", 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("csv")) request.result.createObjectStore("csv", { keyPath: "id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeCsv(id, fileName, text) {
    const database = await openCsvDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("csv", "readwrite");
      transaction.objectStore("csv").put({ id, fileName, text });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async function retrieveCsv(id) {
    const database = await openCsvDatabase();
    const result = await new Promise((resolve, reject) => {
      const request = database.transaction("csv", "readonly").objectStore("csv").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  }

  function safeFileName(fileName) {
    return String(fileName || "mailerfind.csv")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mailerfind.csv";
  }

  async function uploadCsvToCloud(id, file, text, previousPath) {
    const path = `${cloudSession.user.id}/${encodeURIComponent(id)}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await cloudClient.storage.from(CLOUD_BUCKET).upload(
      path,
      new Blob([text], { type: file.type || "text/csv;charset=utf-8" }),
      { contentType: file.type || "text/csv", upsert: false }
    );
    if (error) throw error;
    if (previousPath) await cloudClient.storage.from(CLOUD_BUCKET).remove([previousPath]);
    return path;
  }

  async function downloadCsvFile(item) {
    if (cloudSession && item.mailerfind?.storagePath) {
      const { data, error } = await cloudClient.storage.from(CLOUD_BUCKET).download(item.mailerfind.storagePath);
      if (error) throw error;
      return { fileName: item.mailerfind.fileName, blob: data };
    }
    const stored = await retrieveCsv(item.id);
    if (!stored) return null;
    return { fileName: stored.fileName, blob: new Blob([stored.text], { type: "text/csv;charset=utf-8" }) };
  }

  async function downloadExtractionFile(fileKey, meta) {
    if (cloudSession && meta?.storagePath) {
      const { data, error } = await cloudClient.storage.from(CLOUD_BUCKET).download(meta.storagePath);
      if (error) throw error;
      return { fileName: meta.fileName, blob: data };
    }
    const stored = await retrieveCsv(fileKey);
    if (!stored) return null;
    return { fileName: stored.fileName, blob: new Blob([stored.text], { type: "text/csv;charset=utf-8" }) };
  }

  async function importExtractionCsv(target, file) {
    const id = target.dataset.id;
    const item = competitors.find(candidate => candidate.id === id);
    if (!item) return;
    const extractionTarget = target.dataset.step
      ? { step: target.dataset.step }
      : { reelList: target.dataset.reelList, reelId: target.dataset.reelId };
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return notify("El CSV está vacío o no se ha podido leer.");
    const previous = getExtractionMeta(item, extractionTarget);
    const fileKey = target.dataset.step
      ? `${id}__${target.dataset.step}`
      : `${id}__${target.dataset.reelList === "salesReels" ? "sales" : "resources"}__${target.dataset.reelId}`;
    const contacts = countContacts(rows);
    let storagePath = null;
    if (cloudSession) storagePath = await uploadCsvToCloud(fileKey, file, text, previous?.storagePath);
    else await storeCsv(fileKey, file.name, text);
    setExtractionMeta(id, extractionTarget, {
      fileName: file.name,
      importedAt: new Date().toISOString(),
      rows: Math.max(rows.length - 1, 0),
      columns: rows[0],
      preview: rows.slice(1, 5),
      emails: contacts.emails,
      phones: contacts.phones,
      storagePath
    });
    notify(`CSV guardado: ${contacts.emails} emails y ${contacts.phones} teléfonos detectados.`);
  }

  elements.list.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.action === "up") move(id, -1);
    if (button.dataset.action === "down") move(id, 1);
    if (button.dataset.action === "expand") { expandedId = expandedId === id ? null : id; render(); }
    if (button.dataset.action === "delete") await removeCompetitor(id);
    if (button.dataset.action === "add-reel") {
      const listName = button.dataset.reelList;
      updateExtraction(id, extraction => {
        extraction[listName].push({ id: `reel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url: "", label: "", done: false, mailerfind: null });
      });
    }
    if (button.dataset.action === "remove-reel") {
      const listName = button.dataset.reelList;
      updateExtraction(id, extraction => {
        extraction[listName] = extraction[listName].filter(reel => reel.id !== button.dataset.reelId);
      });
    }
    if (button.dataset.action === "download-extraction") {
      try {
        const item = competitors.find(candidate => candidate.id === id);
        const target = button.dataset.step
          ? { step: button.dataset.step }
          : { reelList: button.dataset.reelList, reelId: button.dataset.reelId };
        const meta = item ? getExtractionMeta(item, target) : null;
        const stored = meta ? await downloadExtractionFile(button.dataset.fileKey, meta) : null;
        if (!stored) return notify("El CSV original no está disponible en este navegador.");
        const url = URL.createObjectURL(stored.blob);
        const link = document.createElement("a"); link.href = url; link.download = stored.fileName; link.click(); URL.revokeObjectURL(url);
      } catch (_) {
        notify("No se pudo descargar el CSV.");
      }
    }
    if (button.dataset.action === "download-csv") {
      try {
        const item = competitors.find(candidate => candidate.id === id);
        const stored = item ? await downloadCsvFile(item) : null;
        if (!stored) return notify("El CSV original no está disponible en este navegador.");
        const url = URL.createObjectURL(stored.blob);
        const link = document.createElement("a"); link.href = url; link.download = stored.fileName; link.click(); URL.revokeObjectURL(url);
      } catch (_) {
        notify("No se pudo descargar el CSV desde la nube.");
      }
    }
  });

  elements.list.addEventListener("dragstart", event => {
    const row = event.target.closest(".competitor[draggable='true']");
    if (!row) return;
    draggedCompetitorId = row.dataset.id;
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("isDragging");
  });

  elements.list.addEventListener("dragover", event => {
    const row = event.target.closest(".competitor[draggable='true']");
    if (!row || !draggedCompetitorId || row.dataset.id === draggedCompetitorId) return;
    event.preventDefault();
    row.classList.add("isDropTarget");
  });

  elements.list.addEventListener("dragleave", event => {
    event.target.closest(".competitor")?.classList.remove("isDropTarget");
  });

  elements.list.addEventListener("dragend", event => {
    event.target.closest(".competitor")?.classList.remove("isDragging");
    elements.list.querySelectorAll(".isDropTarget").forEach(row => row.classList.remove("isDropTarget"));
    draggedCompetitorId = null;
  });

  elements.list.addEventListener("drop", event => {
    const row = event.target.closest(".competitor[draggable='true']");
    if (!row || !draggedCompetitorId) return;
    event.preventDefault();
    moveToPosition(draggedCompetitorId, row.dataset.id);
  });

  elements.list.addEventListener("change", async event => {
    const target = event.target;
    const id = target.dataset.id;
    if (!id) return;
    if (target.dataset.action === "priority") update(id, { priority: target.value });
    if (target.dataset.action === "studied") update(id, { studied: target.checked });
    if (target.dataset.action === "campaign-sent") {
      const item = competitors.find(candidate => candidate.id === id);
      if (target.checked && !item?.studied) {
        target.checked = false;
        return notify("Primero marca la información como extraída.");
      }
      update(id, { campaignSent: target.checked });
    }
    if (target.dataset.action === "channel") {
      const item = competitors.find(candidate => candidate.id === id);
      update(id, { channels: { ...(item?.channels || {}), [target.dataset.channel]: target.checked } });
    }
    if (target.dataset.action === "extraction-step") {
      updateExtraction(id, extraction => {
        extraction[target.dataset.step] = { ...extraction[target.dataset.step], done: target.checked };
      });
    }
    if (target.dataset.action === "reel-section-done") {
      updateExtraction(id, extraction => { extraction[target.dataset.doneField] = target.checked; });
    }
    if (target.dataset.action === "reel-done") {
      updateExtraction(id, extraction => {
        extraction[target.dataset.reelList] = extraction[target.dataset.reelList].map(reel => reel.id === target.dataset.reelId ? { ...reel, done: target.checked } : reel);
      });
    }
    if (target.dataset.action === "reel-field") {
      updateExtraction(id, extraction => {
        extraction[target.dataset.reelList] = extraction[target.dataset.reelList].map(reel => reel.id === target.dataset.reelId ? { ...reel, [target.dataset.reelField]: target.value } : reel);
      });
    }
    if (target.dataset.field) {
      const numericField = ["followers", "following"].includes(target.dataset.field);
      const value = numericField ? (target.value ? Number(target.value) : null) : target.value;
      const patch = { [target.dataset.field]: value };
      if (target.dataset.field === "followers") patch.followersUpdatedAt = target.value ? new Date().toISOString() : null;
      update(id, patch);
    }
    if (["extraction-csv", "reel-csv"].includes(target.dataset.action)) {
      const file = target.files && target.files[0];
      if (!file) return;
      try {
        await importExtractionCsv(target, file);
      } catch (_) {
        notify("No se pudo guardar el CSV. Prueba de nuevo.");
      }
    }
    if (target.dataset.action === "csv") {
      const file = target.files && target.files[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) return notify("El CSV está vacío o no se ha podido leer.");
      try {
        const current = competitors.find(item => item.id === id);
        let storagePath = null;
        if (cloudSession) storagePath = await uploadCsvToCloud(id, file, text, current?.mailerfind?.storagePath);
        else await storeCsv(id, file.name, text);
        update(id, { mailerfind: { fileName: file.name, importedAt: new Date().toISOString(), rows: Math.max(rows.length - 1, 0), columns: rows[0], preview: rows.slice(1, 5), storagePath } });
        notify(cloudSession ? "CSV guardado en la nube." : "CSV asociado en este navegador.");
      } catch (_) {
        notify("No se pudo guardar el CSV. Prueba de nuevo.");
      }
    }
  });

  [elements.search, elements.priority, elements.status, elements.sort].forEach(control => control.addEventListener(control.tagName === "INPUT" ? "input" : "change", () => { visibleCount = 40; render(); }));
  elements.loadMore.addEventListener("click", () => { visibleCount += 40; render(); });
  document.getElementById("openAddButton").addEventListener("click", () => elements.dialog.showModal());
  document.getElementById("closeAddButton").addEventListener("click", () => elements.dialog.close());
  document.getElementById("cancelAddButton").addEventListener("click", () => elements.dialog.close());

  elements.addForm.addEventListener("submit", event => {
    event.preventDefault();
    const instagramUrl = document.getElementById("newInstagram").value.trim();
    const username = (instagramUrl.match(/instagram\.com\/([^/?#]+)/i) || [])[1] || "";
    const id = `manual-${Date.now()}`;
    competitors.push({ id, code: "", name: document.getElementById("newName").value.trim() || username || "Nuevo competidor", username, instagramUrl, youtubeUrl: document.getElementById("newYoutube").value.trim(), priority: document.getElementById("newPriority").value, followers: null, following: null, followersUpdatedAt: null, studied: false, campaignSent: false, notes: "", channels: { email: false, traffic: false, vsl: false }, source: "Añadido manualmente", mailerfind: null, extraction: normalizeExtraction(null), manualOrder: competitors.length + 1, instagramStatus: "not_checked" });
    saveData();
    elements.addForm.reset();
    elements.dialog.close();
    expandedId = id;
    notify("Competidor añadido a la cola.");
    render();
  });

  document.getElementById("exportButton").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(competitors, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `competidores-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  });

  document.getElementById("backupInput").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) throw new Error("Formato incorrecto");
      competitors = imported.map(normalizeCompetitor); saveData(); render(); notify("Copia del dashboard importada.");
    } catch (_) { notify("No se pudo importar esa copia."); }
    event.target.value = "";
  });

  elements.cloudButton.addEventListener("click", async () => {
    if (cloudSession) {
      clearTimeout(cloudSaveTimer);
      await saveCloudData();
      await cloudClient.auth.signOut();
      return;
    }
    elements.cloudMessage.hidden = true;
    elements.cloudMessage.classList.remove("isError");
    elements.cloudDialog.showModal();
  });
  document.getElementById("closeCloudButton").addEventListener("click", () => elements.cloudDialog.close());
  document.getElementById("cancelCloudButton").addEventListener("click", () => elements.cloudDialog.close());

  elements.cloudForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!cloudClient) return notify("La conexión con la nube no está disponible.");
    const button = document.getElementById("sendCloudLinkButton");
    button.disabled = true;
    button.textContent = "Entrando…";
    elements.cloudMessage.hidden = true;
    elements.cloudMessage.classList.remove("isError");
    const { error } = await cloudClient.auth.signInWithPassword({
      email: CLOUD_EMAIL,
      password: elements.cloudPassword.value
    });
    button.disabled = false;
    button.textContent = "Entrar";
    elements.cloudMessage.hidden = false;
    if (error) {
      elements.cloudMessage.textContent = `No se pudo entrar: ${error.message}`;
      elements.cloudMessage.classList.add("isError");
      return;
    }
    elements.cloudPassword.value = "";
    elements.cloudDialog.close();
  });

  render();
  setupCloud();
})();
