"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import seedData from "./data/seed.json";

type Priority = "Crítica" | "Alta" | "Media" | "Baja";

type MailerfindMeta = {
  fileName: string;
  importedAt: string;
  rows: number;
  columns: string[];
  preview: string[][];
};

type Competitor = {
  id: string;
  name: string;
  username: string;
  instagramUrl: string;
  youtubeUrl: string;
  priority: Priority;
  followers: number | null;
  followersUpdatedAt: string | null;
  studied: boolean;
  notes: string;
  source: string;
  mailerfind: MailerfindMeta | null;
  manualOrder: number;
};

const STORAGE_KEY = "radar-competidores-v1";
const priorities: Priority[] = ["Crítica", "Alta", "Media", "Baja"];
const priorityWeight: Record<Priority, number> = { Crítica: 0, Alta: 1, Media: 2, Baja: 3 };

function formatFollowers(value: number | null) {
  if (value == null) return "Sin dato";
  return new Intl.NumberFormat("es-ES", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function parseCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function openCsvDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("radar-competidores-files", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("csv")) request.result.createObjectStore("csv", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeCsv(id: string, fileName: string, text: string) {
  const database = await openCsvDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("csv", "readwrite");
    transaction.objectStore("csv").put({ id, fileName, text });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function retrieveCsv(id: string) {
  const database = await openCsvDatabase();
  const result = await new Promise<{ id: string; fileName: string; text: string } | undefined>((resolve, reject) => {
    const request = database.transaction("csv", "readonly").objectStore("csv").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

export default function Home() {
  const [competitors, setCompetitors] = useState<Competitor[]>(seedData as Competitor[]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("Todas");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [sortBy, setSortBy] = useState("manual");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [toast, setToast] = useState("");
  const [newItem, setNewItem] = useState({ name: "", instagramUrl: "", youtubeUrl: "", priority: "Media" as Priority });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCompetitors(JSON.parse(stored));
    } catch {
      setToast("No se pudo recuperar la copia local. Se han cargado los datos iniciales.");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(competitors));
  }, [competitors, ready]);

  useEffect(() => setVisibleCount(40), [search, priorityFilter, statusFilter, sortBy]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const metrics = useMemo(() => ({
    total: competitors.length,
    critical: competitors.filter((item) => item.priority === "Crítica").length,
    studied: competitors.filter((item) => item.studied).length,
    csv: competitors.filter((item) => item.mailerfind).length,
  }), [competitors]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...competitors]
      .filter((item) => !term || `${item.name} ${item.username} ${item.notes}`.toLowerCase().includes(term))
      .filter((item) => priorityFilter === "Todas" || item.priority === priorityFilter)
      .filter((item) => {
        if (statusFilter === "Pendientes") return !item.studied;
        if (statusFilter === "Estudiados") return item.studied;
        if (statusFilter === "Con CSV") return Boolean(item.mailerfind);
        if (statusFilter === "Sin CSV") return !item.mailerfind;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "priority") return priorityWeight[a.priority] - priorityWeight[b.priority] || a.manualOrder - b.manualOrder;
        if (sortBy === "followers") return (b.followers ?? -1) - (a.followers ?? -1);
        if (sortBy === "name") return a.name.localeCompare(b.name, "es");
        return a.manualOrder - b.manualOrder;
      });
  }, [competitors, search, priorityFilter, statusFilter, sortBy]);

  const updateCompetitor = (id: string, patch: Partial<Competitor>) => {
    setCompetitors((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const moveCompetitor = (id: string, direction: -1 | 1) => {
    setCompetitors((current) => {
      const ordered = [...current].sort((a, b) => a.manualOrder - b.manualOrder);
      const index = ordered.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      const ownOrder = ordered[index].manualOrder;
      ordered[index] = { ...ordered[index], manualOrder: ordered[target].manualOrder };
      ordered[target] = { ...ordered[target], manualOrder: ownOrder };
      return ordered.sort((a, b) => a.manualOrder - b.manualOrder);
    });
  };

  const addCompetitor = (event: FormEvent) => {
    event.preventDefault();
    const instagramUrl = newItem.instagramUrl.trim();
    const username = instagramUrl.match(/instagram\.com\/([^/?#]+)/i)?.[1] ?? "";
    const id = `manual-${Date.now()}`;
    setCompetitors((current) => [...current, {
      id,
      name: newItem.name.trim() || username || "Nuevo competidor",
      username,
      instagramUrl,
      youtubeUrl: newItem.youtubeUrl.trim(),
      priority: newItem.priority,
      followers: null,
      followersUpdatedAt: null,
      studied: false,
      notes: "",
      source: "Añadido manualmente",
      mailerfind: null,
      manualOrder: current.length + 1,
    }]);
    setNewItem({ name: "", instagramUrl: "", youtubeUrl: "", priority: "Media" });
    setShowAdd(false);
    setExpandedId(id);
    setToast("Competidor añadido a la cola.");
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>, competitor: Competitor) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      setToast("El CSV está vacío o no se ha podido leer.");
      return;
    }
    const columns = rows[0];
    const meta: MailerfindMeta = {
      fileName: file.name,
      importedAt: new Date().toISOString(),
      rows: Math.max(rows.length - 1, 0),
      columns,
      preview: rows.slice(1, 5),
    };
    await storeCsv(competitor.id, file.name, text);
    updateCompetitor(competitor.id, { mailerfind: meta });
    event.target.value = "";
    setToast(`CSV asociado a ${competitor.name}.`);
  };

  const downloadCsv = async (competitor: Competitor) => {
    const stored = await retrieveCsv(competitor.id);
    if (!stored) {
      setToast("El archivo original no está disponible en este navegador.");
      return;
    }
    const url = URL.createObjectURL(new Blob([stored.text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = stored.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(competitors, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `competidores-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error("Formato no válido");
      setCompetitors(data);
      setToast("Copia del dashboard importada.");
    } catch {
      setToast("No se pudo importar esa copia.");
    }
    event.target.value = "";
  };

  return (
    <main>
      {toast && <div className="toast" role="status">{toast}</div>}

      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Ir al inicio">
          <span className="brandMark">TV</span>
          <span><strong>Radar</strong><small>Competidores</small></span>
        </a>
        <div className="topActions">
          <span className="saveState"><i /> Guardado local</span>
          <label className="button ghost fileButton">Importar copia<input type="file" accept="application/json,.json" onChange={importBackup} /></label>
          <button className="button ghost" onClick={exportBackup}>Exportar</button>
          <button className="button primary" onClick={() => setShowAdd(true)}>+ Añadir competidor</button>
        </div>
      </header>

      <section className="hero" id="inicio">
        <div>
          <p className="eyebrow">INTELIGENCIA DE MERCADO</p>
          <h1>Tu mapa competitivo,<br /><em>en orden de acción.</em></h1>
          <p className="heroCopy">Prioriza perfiles, registra seguidores, guarda la investigación de Mailerfind y no pierdas de vista lo que ya has estudiado.</p>
        </div>
        <div className="heroProgress">
          <div className="progressRing" style={{ "--progress": `${metrics.total ? Math.round(metrics.studied / metrics.total * 100) : 0}%` } as React.CSSProperties}>
            <span>{metrics.total ? Math.round(metrics.studied / metrics.total * 100) : 0}%</span>
          </div>
          <div><strong>Avance global</strong><span>{metrics.studied} de {metrics.total} estudiados</span></div>
        </div>
      </section>

      <section className="metrics" aria-label="Resumen">
        <article><span>Total en radar</span><strong>{metrics.total}</strong><small>perfiles limpios</small></article>
        <article className="accent"><span>Prioridad crítica</span><strong>{metrics.critical}</strong><small>primero en Mailerfind</small></article>
        <article><span>Ya estudiados</span><strong>{metrics.studied}</strong><small>{metrics.total - metrics.studied} pendientes</small></article>
        <article><span>CSV cargados</span><strong>{metrics.csv}</strong><small>datos asociados</small></article>
      </section>

      <section className="workflow">
        <span className="workflowTitle">Flujo recomendado</span>
        <div><b>1</b><span><strong>Prioriza</strong><small>Ordena la cola</small></span></div>
        <i>→</i>
        <div><b>2</b><span><strong>Investiga</strong><small>Perfil y seguidores</small></span></div>
        <i>→</i>
        <div><b>3</b><span><strong>Sube el CSV</strong><small>Datos de Mailerfind</small></span></div>
        <i>→</i>
        <div><b>4</b><span><strong>Completa</strong><small>Marca estudiado</small></span></div>
      </section>

      <section className="workspace">
        <div className="sectionHeading">
          <div><p className="eyebrow">COLA DE INVESTIGACIÓN</p><h2>Competidores</h2></div>
          <span>{filtered.length} resultados</span>
        </div>

        <div className="toolbar">
          <label className="searchBox"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, usuario o nota…" aria-label="Buscar competidores" /></label>
          <label><span>Prioridad</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option>Todas</option>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
          <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todos</option><option>Pendientes</option><option>Estudiados</option><option>Con CSV</option><option>Sin CSV</option></select></label>
          <label><span>Orden</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="manual">Mi orden manual</option><option value="priority">Nivel de prioridad</option><option value="followers">Más seguidores</option><option value="name">Nombre A–Z</option></select></label>
        </div>

        <div className="tableWrap">
          <div className="tableHeader">
            <span>Orden</span><span>Competidor</span><span>Prioridad</span><span>Seguidores</span><span>Mailerfind</span><span>Estado</span><span />
          </div>
          <div className="competitorList">
            {filtered.slice(0, visibleCount).map((competitor) => (
              <article className={`competitor ${competitor.studied ? "isStudied" : ""}`} key={competitor.id}>
                <div className="competitorRow">
                  <div className="orderCell">
                    <strong>{competitor.manualOrder}</strong>
                    <span className="moveButtons">
                      <button onClick={() => moveCompetitor(competitor.id, -1)} disabled={sortBy !== "manual"} aria-label={`Subir ${competitor.name}`}>↑</button>
                      <button onClick={() => moveCompetitor(competitor.id, 1)} disabled={sortBy !== "manual"} aria-label={`Bajar ${competitor.name}`}>↓</button>
                    </span>
                  </div>
                  <div className="identity">
                    <span className="avatarText">{(competitor.name || competitor.username).slice(0, 2).toUpperCase()}</span>
                    <span><strong>{competitor.name}</strong><small>{competitor.username ? `@${competitor.username}` : "Perfil pendiente"}</small></span>
                  </div>
                  <select className={`prioritySelect priority-${competitor.priority.toLowerCase()}`} value={competitor.priority} onChange={(event) => updateCompetitor(competitor.id, { priority: event.target.value as Priority })} aria-label={`Prioridad de ${competitor.name}`}>
                    {priorities.map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                  <button className="followersButton" onClick={() => setExpandedId(expandedId === competitor.id ? null : competitor.id)}>{formatFollowers(competitor.followers)}<small>{competitor.followersUpdatedAt ? "actualizado" : "añadir dato"}</small></button>
                  <span className={`csvState ${competitor.mailerfind ? "ready" : ""}`}>{competitor.mailerfind ? <><b>✓</b><span>{competitor.mailerfind.rows} registros<small>{competitor.mailerfind.fileName}</small></span></> : <><b>＋</b><span>Sin CSV<small>pendiente</small></span></>}</span>
                  <label className="studiedToggle"><input type="checkbox" checked={competitor.studied} onChange={(event) => updateCompetitor(competitor.id, { studied: event.target.checked })} /><span>{competitor.studied ? "Estudiado" : "Pendiente"}</span></label>
                  <button className="expandButton" onClick={() => setExpandedId(expandedId === competitor.id ? null : competitor.id)} aria-expanded={expandedId === competitor.id}>{expandedId === competitor.id ? "×" : "•••"}</button>
                </div>

                {expandedId === competitor.id && (
                  <div className="detailsPanel">
                    <div className="detailBlock">
                      <h3>Ficha del competidor</h3>
                      <label>Nombre<input value={competitor.name} onChange={(event) => updateCompetitor(competitor.id, { name: event.target.value })} /></label>
                      <label>Instagram<div className="inputAction"><input value={competitor.instagramUrl} onChange={(event) => updateCompetitor(competitor.id, { instagramUrl: event.target.value })} placeholder="https://instagram.com/usuario" />{competitor.instagramUrl && <a href={competitor.instagramUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}</div></label>
                      <label>YouTube<div className="inputAction"><input value={competitor.youtubeUrl} onChange={(event) => updateCompetitor(competitor.id, { youtubeUrl: event.target.value })} placeholder="Canal de YouTube" />{competitor.youtubeUrl && <a href={competitor.youtubeUrl} target="_blank" rel="noreferrer">Abrir ↗</a>}</div></label>
                      <label>Notas<textarea value={competitor.notes} onChange={(event) => updateCompetitor(competitor.id, { notes: event.target.value })} placeholder="Oferta, posicionamiento, puntos fuertes…" /></label>
                    </div>

                    <div className="detailBlock followersBlock">
                      <h3>Audiencia</h3>
                      <label>Seguidores de Instagram<input type="number" min="0" value={competitor.followers ?? ""} onChange={(event) => updateCompetitor(competitor.id, { followers: event.target.value ? Number(event.target.value) : null, followersUpdatedAt: event.target.value ? new Date().toISOString() : null })} placeholder="Ej. 125000" /></label>
                      <div className="automationNote"><span>◎</span><p><strong>Actualización automática preparada</strong>Para activarla hará falta conectar una fuente autorizada de datos de Instagram.</p></div>
                    </div>

                    <div className="detailBlock csvBlock">
                      <h3>Datos de Mailerfind</h3>
                      {competitor.mailerfind ? (
                        <>
                          <div className="fileSummary"><span>CSV</span><p><strong>{competitor.mailerfind.fileName}</strong><small>{competitor.mailerfind.rows} registros · {competitor.mailerfind.columns.length} columnas</small></p></div>
                          <div className="csvActions"><button className="button ghost small" onClick={() => downloadCsv(competitor)}>Descargar</button><label className="button ghost small fileButton">Reemplazar<input type="file" accept=".csv,text/csv" onChange={(event) => importCsv(event, competitor)} /></label></div>
                          <div className="csvColumns">{competitor.mailerfind.columns.slice(0, 6).map((column) => <span key={column}>{column || "Sin título"}</span>)}</div>
                        </>
                      ) : (
                        <label className="dropCsv">＋<strong>Subir CSV de Mailerfind</strong><small>Se guardará asociado a este competidor</small><input type="file" accept=".csv,text/csv" onChange={(event) => importCsv(event, competitor)} /></label>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!filtered.length && <div className="emptyState">No hay competidores que coincidan con estos filtros.</div>}
        </div>

        {visibleCount < filtered.length && <button className="loadMore" onClick={() => setVisibleCount((count) => count + 40)}>Mostrar 40 más <span>{filtered.length - visibleCount} restantes</span></button>}
      </section>

      {showAdd && (
        <div className="modalBackdrop" onMouseDown={() => setShowAdd(false)}>
          <form className="modal" onSubmit={addCompetitor} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="modalClose" onClick={() => setShowAdd(false)}>×</button>
            <p className="eyebrow">NUEVO PERFIL</p>
            <h2>Añadir competidor</h2>
            <p>Con la URL de Instagram extraeremos el usuario automáticamente.</p>
            <label>Nombre<input autoFocus value={newItem.name} onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} placeholder="Nombre o marca" /></label>
            <label>Instagram<input value={newItem.instagramUrl} onChange={(event) => setNewItem({ ...newItem, instagramUrl: event.target.value })} placeholder="https://instagram.com/usuario" /></label>
            <label>YouTube <small>opcional</small><input value={newItem.youtubeUrl} onChange={(event) => setNewItem({ ...newItem, youtubeUrl: event.target.value })} placeholder="https://youtube.com/@canal" /></label>
            <label>Prioridad<select value={newItem.priority} onChange={(event) => setNewItem({ ...newItem, priority: event.target.value as Priority })}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
            <div className="modalActions"><button type="button" className="button ghost" onClick={() => setShowAdd(false)}>Cancelar</button><button className="button primary" type="submit">Añadir a la cola</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
