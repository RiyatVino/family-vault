// Family Vault — main application.
// Vanilla JS, no framework: keeps the whole app dependency-free and fast
// to load with zero network access. Rendering is done with template
// strings + a single delegated click handler per container.

/* ===================== Static data ===================== */

const GROUP_META = {
  "Identity Proof":          { code: "IDN", icon: "🪪" },
  "Educational Documents":   { code: "EDU", icon: "🎓" },
  "Government Certificates": { code: "GOV", icon: "🏛️" },
  "Financial Documents":     { code: "FIN", icon: "💰" },
  "Medical Documents":       { code: "MED", icon: "🩺" },
  "Personal Documents":      { code: "PER", icon: "🖼️" },
  "Custom":                  { code: "CUS", icon: "🗂️" }
};

const CATEGORY_SEED = [
  ["Identity Proof", ["Aadhaar Card", "PAN Card", "Passport", "Voter ID", "Driving License"]],
  ["Educational Documents", ["10th Mark Sheet", "12th Mark Sheet", "Degree Certificate", "College Mark Sheets", "Transfer Certificate", "Provisional Certificate"]],
  ["Government Certificates", ["Birth Certificate", "Community Certificate", "Income Certificate", "Residence Certificate", "Marriage Certificate", "Death Certificate"]],
  ["Financial Documents", ["Bank Passbook", "Insurance Documents", "Property Documents", "Tax Documents"]],
  ["Medical Documents", ["Health Insurance Card", "Medical Reports", "Vaccination Records", "Prescriptions"]],
  ["Personal Documents", ["Passport Size Photos", "Signature Images", "Family Photos"]]
];

const RELATIONSHIPS = ["Father", "Mother", "Son", "Daughter", "Husband", "Wife", "Grandfather", "Grandmother", "Brother", "Sister", "Self", "Other"];

/* ===================== Utilities ===================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const escapeHtml = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target - today) / 86400000);
}
function catCode(name) {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 3) || "GEN").padEnd(3, "X");
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function resizeImageDataUrl(file, maxDim = 200) {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/* ===================== App state ===================== */

const state = {
  tab: "home",
  view: { type: "home" },
  stack: [],
  members: [],
  categories: [],
  documents: [],
  theme: (() => { try { return localStorage.getItem("fv_theme") || "light"; } catch (e) { return "light"; } })()
};

function cacheMember(id) { return state.members.find((m) => m.id === id); }
function cacheCategory(id) { return state.categories.find((c) => c.id === id); }
function docsFor(filterFn) { return state.documents.filter(filterFn); }

/* ===================== Boot / lock flow ===================== */

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  document.documentElement.setAttribute("data-theme", state.theme);
  await FVDB.open();
  const sec = await FVDB.get("settings", "security");
  if (sec && sec.pinEnabled) {
    renderLockScreen();
  } else {
    await FVCrypto.ensureUnlockedNoPin();
    await startApp();
  }
}

async function startApp() {
  $("#lockscreen-root").innerHTML = "";
  await seedCategoriesIfNeeded();
  await refreshCache();
  $("#topbar").hidden = false;
  $("#view").hidden = false;
  $("#fab-add").hidden = false;
  $("#bottomnav").hidden = false;
  document.documentElement.setAttribute("data-theme", state.theme);
  $("#btn-theme").textContent = state.theme === "dark" ? "☀️" : "🌙";
  bindChrome();
  navigate({ type: "home" }, "home");
  maybeShowExpiryReminder();
}

async function seedCategoriesIfNeeded() {
  const existing = await FVDB.all("categories");
  if (existing.length) return;
  for (const [group, names] of CATEGORY_SEED) {
    for (const name of names) {
      await FVDB.put("categories", { id: FVDB.uid("cat_"), name, group, custom: false, counter: 0 });
    }
  }
}

async function refreshCache() {
  state.members = (await FVDB.all("members")).sort((a, b) => a.name.localeCompare(b.name));
  state.categories = await FVDB.all("categories");
  state.documents = (await FVDB.all("documents")).sort((a, b) => b.createdAt - a.createdAt);
}

/* ===================== Lock screen ===================== */

function renderLockScreen() {
  const root = $("#lockscreen-root");
  let pin = "";
  root.innerHTML = `
    <div class="lockscreen">
      <div class="seal">🗄️</div>
      <h1>Family Vault</h1>
      <p>Enter your PIN to unlock</p>
      <div class="dots" id="ls-dots"></div>
      <div class="keypad" id="ls-keypad"></div>
      <button class="btn ghost" id="ls-bio" style="margin-top:18px;">Use biometric unlock</button>
    </div>`;
  const dotsEl = $("#ls-dots", root);
  function drawDots() {
    dotsEl.innerHTML = Array.from({ length: 6 }).map((_, i) => `<div class="d ${i < pin.length ? "filled" : ""}"></div>`).join("");
  }
  drawDots();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "bio", "0", "⌫"];
  $("#ls-keypad", root).innerHTML = keys.map((k) =>
    `<button data-k="${k}">${k === "bio" ? "🔓" : k}</button>`
  ).join("");
  $("#ls-keypad", root).addEventListener("click", async (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const k = btn.dataset.k;
    if (k === "⌫") pin = pin.slice(0, -1);
    else if (k === "bio") return tryBiometric();
    else if (pin.length < 6) pin += k;
    drawDots();
    if (pin.length === 6) {
      const ok = await FVCrypto.tryUnlock(pin);
      if (ok) { await startApp(); }
      else { toast("Incorrect PIN"); pin = ""; drawDots(); }
    }
  });
  $("#ls-bio", root).addEventListener("click", tryBiometric);
  checkBiometricAvailable();

  async function checkBiometricAvailable() {
    const rec = await FVDB.get("settings", "biometric");
    $("#ls-bio", root).hidden = !(rec && rec.enabled);
  }
  async function tryBiometric() {
    const ok = await FVCrypto.verifyBiometric();
    if (!ok) { toast("Biometric unlock failed — use your PIN"); return; }
    // Biometric confirms identity; the actual AES key still needs the PIN
    // marker check, so we store a locally-wrapped copy only when the user
    // opts in via Settings. Here we fall back to asking for PIN once more
    // is unnecessary because Settings already wired a session key path.
    const sec = await FVDB.get("settings", "security");
    if (sec && sec.bioUnlockPin) {
      const ok2 = await FVCrypto.tryUnlock(sec.bioUnlockPin);
      if (ok2) return startApp();
    }
    toast("Enter your PIN to finish unlocking");
  }
}

/* ===================== Navigation ===================== */

function navigate(view, tab) {
  if (tab) { state.tab = tab; state.stack = []; }
  else if (state.view && state.view.type !== view.type) { state.stack.push(state.view); }
  state.view = view;
  render();
}
function goBack() {
  const prev = state.stack.pop();
  state.view = prev || { type: state.tab };
  render();
}

function bindChrome() {
  $("#bottomnav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]"); if (!btn) return;
    $$("#bottomnav button").forEach((b) => b.classList.toggle("active", b === btn));
    navigate({ type: btn.dataset.tab }, btn.dataset.tab);
  });
  $("#btn-theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("fv_theme", state.theme); } catch (e) {}
    document.documentElement.setAttribute("data-theme", state.theme);
    $("#btn-theme").textContent = state.theme === "dark" ? "☀️" : "🌙";
  });
  $("#btn-lock").addEventListener("click", () => {
    FVCrypto.lock();
    $("#topbar").hidden = true; $("#view").hidden = true; $("#fab-add").hidden = true; $("#bottomnav").hidden = true;
    boot();
  });
  $("#fab-add").addEventListener("click", () => openDocForm());
}

/* ===================== Render dispatcher ===================== */

function render() {
  const titles = { home: "Home", members: "Family", search: "Search", settings: "Vault" };
  const v = state.view;
  const isTop = ["home", "members", "search", "settings"].includes(v.type);
  $("#topbar-title").textContent = v.title || titles[v.type] || "Family Vault";
  $("#topbar-eyebrow").textContent = isTop ? "Family Vault" : "◂ Back";
  $("#topbar-eyebrow").style.cursor = isTop ? "default" : "pointer";
  $("#topbar-eyebrow").onclick = isTop ? null : goBack;

  $$("#bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));

  const view = $("#view");
  switch (v.type) {
    case "home": view.innerHTML = renderHome(); break;
    case "members": view.innerHTML = renderMembersTab(); break;
    case "memberDetail": view.innerHTML = renderMemberDetail(v.memberId); break;
    case "categoryDocs": view.innerHTML = renderCategoryDocs(v.memberId, v.categoryId); break;
    case "search": view.innerHTML = renderSearch(); break;
    case "settings": view.innerHTML = renderSettings(); break;
    default: view.innerHTML = renderHome();
  }
  bindViewActions();
}

/* ===================== Home / Dashboard ===================== */

function renderHome() {
  const totalMembers = state.members.length;
  const totalDocs = state.documents.length;
  const expiring = state.documents.filter((d) => d.expiryDate && daysUntil(d.expiryDate) !== null && daysUntil(d.expiryDate) <= 30 && daysUntil(d.expiryDate) >= 0);
  const recent = state.documents.slice(0, 5);
  const favorites = state.documents.filter((d) => d.favorite).slice(0, 5);
  const emergency = state.documents.filter((d) => d.emergency);

  if (!totalMembers) {
    return emptyState("👪", "Add your first family member", "Set up profiles for everyone, then start filing documents under each person.", `<button class="btn" data-action="open-member-form">Add Family Member</button>`);
  }

  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${totalMembers}</div><div class="label">Family members</div></div>
      <div class="stat-card"><div class="num">${totalDocs}</div><div class="label">Documents stored</div></div>
      <div class="stat-card ${expiring.length ? "warn" : ""}"><div class="num">${expiring.length}</div><div class="label">Expiring in 30 days</div></div>
      <div class="stat-card"><div class="num">${favorites.length ? state.documents.filter(d=>d.favorite).length : 0}</div><div class="label">Favorites</div></div>
    </div>

    ${emergency.length ? `
    <div class="section-title"><h2>🚨 Emergency shortcuts</h2></div>
    <div class="card" style="padding:8px;">
      ${emergency.map((d) => docRow(d)).join("")}
    </div>` : ""}

    ${expiring.length ? `
    <div class="section-title"><h2>Expiring soon</h2></div>
    <div class="card" style="padding:8px;">
      ${expiring.slice(0, 6).map((d) => docRow(d)).join("")}
    </div>` : ""}

    <div class="section-title"><h2>Family</h2><button class="link" data-action="goto-tab" data-tab="members">See all</button></div>
    <div class="member-strip">
      ${state.members.map(memberChip).join("")}
    </div>

    <div class="section-title"><h2>Recently added</h2></div>
    ${recent.length ? `<div class="card" style="padding:8px;">${recent.map((d) => docRow(d)).join("")}</div>` : `<div class="empty"><p>No documents yet.</p></div>`}
  `;
}

function memberChip(m, active = false) {
  return `<button class="member-chip ${active ? "active" : ""}" data-action="open-member" data-id="${m.id}">
    <div class="avatar">${m.photo ? `<img src="${m.photo}" />` : initials(m.name)}</div>
    <span class="name">${escapeHtml(m.name)}</span>
    <span class="rel">${escapeHtml(m.relationship || "")}</span>
  </button>`;
}
function initials(name = "") { return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }

function docRow(d) {
  const member = cacheMember(d.memberId);
  const cat = cacheCategory(d.categoryId);
  const dleft = d.expiryDate ? daysUntil(d.expiryDate) : null;
  let badge = "";
  if (dleft !== null) {
    if (dleft < 0) badge = `<span class="expiry-badge">Expired ${fmtDate(d.expiryDate)}</span>`;
    else if (dleft <= 30) badge = `<span class="expiry-badge soon">Expires in ${dleft}d</span>`;
  }
  return `<div class="doc-card" data-action="open-doc" data-id="${d.id}" style="margin-bottom:6px;">
    <div class="stamp">${GROUP_META[cat?.group]?.icon || "📄"}</div>
    <div class="body">
      <div class="refno">${d.refNo || ""}</div>
      <div class="title">${escapeHtml(d.title)} ${d.favorite ? '<span class="fav">★</span>' : ""}</div>
      <div class="meta"><span>${escapeHtml(member?.name || "Unassigned")}</span><span>${escapeHtml(cat?.name || "")}</span></div>
      ${badge}
    </div>
  </div>`;
}

function emptyState(glyph, title, desc, actionsHtml) {
  return `<div class="empty"><div class="glyph">${glyph}</div><h3>${title}</h3><p>${desc}</p>${actionsHtml || ""}</div>`;
}

function maybeShowExpiryReminder() {
  const expiring = state.documents.filter((d) => d.expiryDate && daysUntil(d.expiryDate) !== null && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 7);
  if (expiring.length) toast(`⏰ ${expiring.length} document${expiring.length > 1 ? "s" : ""} expiring within 7 days`);
}

/* ===================== Members tab ===================== */

function renderMembersTab() {
  return `
    <div class="section-title"><h2>Family members</h2><button class="link" data-action="open-member-form">+ Add</button></div>
    ${state.members.length ? `<div class="grid2">${state.members.map(memberCard).join("")}</div>` :
      emptyState("👪", "No family members yet", "Add everyone whose documents you want to keep organized.", `<button class="btn" data-action="open-member-form">Add Family Member</button>`)}
  `;
}
function memberCard(m) {
  const count = state.documents.filter((d) => d.memberId === m.id).length;
  return `<div class="card" data-action="open-member" data-id="${m.id}" style="text-align:center; cursor:pointer;">
    <div class="avatar" style="width:64px;height:64px;font-size:24px;">${m.photo ? `<img src="${m.photo}" />` : initials(m.name)}</div>
    <div style="font-weight:600; font-size:14px; margin-top:8px;">${escapeHtml(m.name)}</div>
    <div style="font-size:12px; color:var(--text-faint);">${escapeHtml(m.relationship || "")}</div>
    <div class="tag" style="margin-top:8px;">${count} document${count === 1 ? "" : "s"}</div>
  </div>`;
}

function renderMemberDetail(memberId) {
  const m = cacheMember(memberId);
  if (!m) return emptyState("⚠️", "Member not found", "");
  const counts = {};
  state.documents.filter((d) => d.memberId === memberId).forEach((d) => { counts[d.categoryId] = (counts[d.categoryId] || 0) + 1; });
  const groups = groupCategories();
  return `
    <div class="card" style="display:flex; gap:12px; align-items:center;">
      <div class="avatar" style="width:56px;height:56px;font-size:20px;">${m.photo ? `<img src="${m.photo}" />` : initials(m.name)}</div>
      <div style="flex:1;">
        <div style="font-weight:700; font-size:16px;">${escapeHtml(m.name)}</div>
        <div style="font-size:12px; color:var(--text-faint);">${escapeHtml(m.relationship || "")} ${m.dob ? "· " + fmtDate(m.dob) : ""}</div>
      </div>
      <button class="btn secondary sm" data-action="open-member-form" data-id="${m.id}">Edit</button>
    </div>
    <div class="section-title"><h2>Categories</h2><button class="link" data-action="open-category-form">+ Custom</button></div>
    ${Object.entries(groups).map(([group, cats]) => `
      <div class="eyebrow" style="font-family:var(--font-mono); font-size:11px; color:var(--text-faint); margin:14px 0 6px; text-transform:uppercase; letter-spacing:.08em;">${group}</div>
      <div class="cat-grid">
        ${cats.map((c) => `<div class="cat-tile" data-action="open-category" data-member="${memberId}" data-cat="${c.id}">
          <span class="ic">${GROUP_META[c.group]?.icon || "🗂️"}</span>
          <div class="lb">${escapeHtml(c.name)}</div>
          <div class="ct">${counts[c.id] || 0}</div>
        </div>`).join("")}
      </div>
    `).join("")}
    <div class="section-title" style="margin-top:24px;"><h2>Export this member's data</h2></div>
    <button class="btn secondary block" data-action="export-member" data-id="${m.id}">📦 Export ${escapeHtml(m.name)}'s documents</button>
  `;
}

function groupCategories() {
  const groups = {};
  for (const c of state.categories) { (groups[c.group] ||= []).push(c); }
  return groups;
}

function renderCategoryDocs(memberId, categoryId) {
  const m = cacheMember(memberId);
  const cat = cacheCategory(categoryId);
  const docs = state.documents.filter((d) => d.memberId === memberId && d.categoryId === categoryId);
  state.view.title = cat ? cat.name : "Documents";
  return `
    <div class="card" style="display:flex; align-items:center; gap:10px;">
      <span style="font-size:22px;">${GROUP_META[cat?.group]?.icon || "🗂️"}</span>
      <div>
        <div style="font-weight:700;">${escapeHtml(cat?.name || "")}</div>
        <div style="font-size:12px; color:var(--text-faint);">${escapeHtml(m?.name || "")} · ${docs.length} document${docs.length === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div style="margin:14px 0;">
      <button class="btn block" data-action="open-doc-form" data-member="${memberId}" data-cat="${categoryId}">+ Add ${escapeHtml(cat?.name || "document")}</button>
    </div>
    ${docs.length ? docs.map(docRow).join("") : emptyState("📄", "Nothing filed yet", "Add the first document in this category.")}
  `;
}

/* ===================== Search tab ===================== */

const searchState = { q: "", memberId: "", categoryId: "", tag: "", expiry: "", favOnly: false };

function renderSearch() {
  const results = filteredDocs();
  return `
    <div class="search-bar">
      <span>🔎</span>
      <input id="search-q" placeholder="Search by title, notes, or tag" value="${escapeHtml(searchState.q)}" />
    </div>
    <div class="chip-row" style="margin-top:10px;">
      <button class="chip ${searchState.favOnly ? "active" : ""}" data-action="toggle-fav-filter">★ Favorites</button>
      <button class="chip ${searchState.expiry === "expired" ? "active" : ""}" data-action="set-expiry-filter" data-v="expired">Expired</button>
      <button class="chip ${searchState.expiry === "30" ? "active" : ""}" data-action="set-expiry-filter" data-v="30">Next 30 days</button>
      <button class="chip ${searchState.expiry === "90" ? "active" : ""}" data-action="set-expiry-filter" data-v="90">Next 90 days</button>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Family member</label>
      <select id="search-member">
        <option value="">All members</option>
        ${state.members.map((m) => `<option value="${m.id}" ${searchState.memberId === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Category</label>
      <select id="search-category">
        <option value="">All categories</option>
        ${state.categories.map((c) => `<option value="${c.id}" ${searchState.categoryId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
      </select>
    </div>
    <div class="section-title"><h2>${results.length} result${results.length === 1 ? "" : "s"}</h2></div>
    ${results.length ? results.map(docRow).join("") : emptyState("🔍", "No matches", "Try a different name, member, category, tag, or date range.")}
  `;
}

function filteredDocs() {
  return state.documents.filter((d) => {
    if (searchState.q) {
      const q = searchState.q.toLowerCase();
      const hay = [d.title, d.notes, ...(d.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (searchState.memberId && d.memberId !== searchState.memberId) return false;
    if (searchState.categoryId && d.categoryId !== searchState.categoryId) return false;
    if (searchState.favOnly && !d.favorite) return false;
    if (searchState.expiry) {
      const dl = d.expiryDate ? daysUntil(d.expiryDate) : null;
      if (dl === null) return false;
      if (searchState.expiry === "expired" && dl >= 0) return false;
      if (searchState.expiry === "30" && (dl < 0 || dl > 30)) return false;
      if (searchState.expiry === "90" && (dl < 0 || dl > 90)) return false;
    }
    return true;
  });
}

/* ===================== Settings / Vault tab ===================== */

function renderSettings() {
  return `
    <div class="section-title"><h2>Appearance</h2></div>
    <div class="card">
      <div class="row"><span class="rl">Dark mode</span>
        <label class="switch"><input type="checkbox" id="set-dark" ${state.theme === "dark" ? "checked" : ""}/><span class="track"></span></label>
      </div>
    </div>

    <div class="section-title"><h2>Security</h2></div>
    <div class="card" id="security-card">Loading…</div>

    <div class="section-title"><h2>Backup &amp; restore</h2></div>
    <div class="card">
      <button class="btn block" data-action="export-all">📦 Export full encrypted backup</button>
      <div style="height:10px;"></div>
      <button class="btn secondary block" data-action="restore-backup">⤴️ Restore from backup file</button>
      <p class="hint" style="margin-top:8px;">Backups are encrypted with a passphrase you choose. Store the file and passphrase somewhere safe — Family Vault cannot recover either.</p>
    </div>

    <div class="section-title"><h2>Custom categories</h2></div>
    <div class="card">
      <button class="btn secondary block" data-action="open-category-form">+ Add custom category</button>
      <div style="margin-top:10px;">
        ${state.categories.filter((c) => c.custom).map((c) => `<div class="row"><span class="rl">${escapeHtml(c.name)}</span><span class="rs">${c.group}</span></div>`).join("") || `<p class="hint">No custom categories yet.</p>`}
      </div>
    </div>

    <div class="section-title"><h2>About</h2></div>
    <div class="card">
      <div class="row"><span class="rl">Family members</span><span class="rs">${state.members.length}</span></div>
      <div class="row"><span class="rl">Documents</span><span class="rs">${state.documents.length}</span></div>
      <div class="row"><span class="rl">Storage</span><span class="rs">On this device only</span></div>
    </div>
  `;
}

async function renderSecurityCard() {
  const sec = await FVDB.get("settings", "security");
  const bio = await FVDB.get("settings", "biometric");
  const bioSupported = await FVCrypto.biometricAvailable();
  const el = $("#security-card");
  if (!el) return;
  el.innerHTML = `
    <div class="row"><span class="rl">PIN lock</span>
      <label class="switch"><input type="checkbox" id="set-pin-toggle" ${sec && sec.pinEnabled ? "checked" : ""}/><span class="track"></span></label>
    </div>
    ${sec && sec.pinEnabled ? `<div class="row"><span class="rl">Change PIN</span><button class="btn secondary sm" data-action="change-pin">Change</button></div>` : ""}
    ${bioSupported ? `<div class="row"><span class="rl">Biometric unlock</span>
      <label class="switch"><input type="checkbox" id="set-bio-toggle" ${bio && bio.enabled ? "checked" : ""} ${!(sec && sec.pinEnabled) ? "disabled" : ""}/><span class="track"></span></label>
    </div>` : `<p class="hint">Biometric unlock isn't available on this device/browser.</p>`}
    <p class="hint">Files are encrypted on this device (AES-256) using a key derived from your PIN. Without a PIN, a device-only key is used instead — enable a PIN for real confidentiality.</p>
  `;
  $("#set-pin-toggle").addEventListener("change", async (e) => {
    if (e.target.checked) openPinSetup();
    else {
      if (!confirm("Turn off PIN lock? Your files will be re-encrypted with a device-only key.")) { e.target.checked = true; return; }
      await FVCrypto.disablePin();
      toast("PIN lock disabled");
      renderSecurityCard();
    }
  });
  const bioToggle = $("#set-bio-toggle");
  if (bioToggle) bioToggle.addEventListener("change", async (e) => {
    if (e.target.checked) {
      try {
        const ok = await FVCrypto.registerBiometric();
        if (ok) { toast("Biometric unlock enabled"); } else { e.target.checked = false; }
      } catch (err) { toast("Couldn't enable biometric unlock"); e.target.checked = false; }
    } else {
      await FVDB.put("settings", { key: "biometric", enabled: false });
      toast("Biometric unlock disabled");
    }
  });
}

/* ===================== Delegated view actions ===================== */

function bindViewActions() {
  const view = $("#view");
  view.onclick = onViewAction;

  if (state.view.type === "search") {
    $("#search-q")?.addEventListener("input", (e) => { searchState.q = e.target.value; render(); });
    $("#search-member")?.addEventListener("change", (e) => { searchState.memberId = e.target.value; render(); });
    $("#search-category")?.addEventListener("change", (e) => { searchState.categoryId = e.target.value; render(); });
  }
  if (state.view.type === "settings") {
    $("#set-dark")?.addEventListener("change", (e) => {
      state.theme = e.target.checked ? "dark" : "light";
      try { localStorage.setItem("fv_theme", state.theme); } catch (e) {}
      document.documentElement.setAttribute("data-theme", state.theme);
      $("#btn-theme").textContent = state.theme === "dark" ? "☀️" : "🌙";
    });
    renderSecurityCard();
  }
}

async function onViewAction(e) {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const action = t.dataset.action;
  const id = t.dataset.id;

  switch (action) {
    case "goto-tab": navigate({ type: t.dataset.tab }, t.dataset.tab); break;
    case "open-member": navigate({ type: "memberDetail", memberId: id }); break;
    case "open-member-form": openMemberForm(id); break;
    case "open-category": navigate({ type: "categoryDocs", memberId: t.dataset.member, categoryId: t.dataset.cat }); break;
    case "open-category-form": openCategoryForm(); break;
    case "open-doc-form": openDocForm({ memberId: t.dataset.member, categoryId: t.dataset.cat }); break;
    case "open-doc": openDocSheet(id); break;
    case "toggle-fav-filter": searchState.favOnly = !searchState.favOnly; render(); break;
    case "set-expiry-filter": searchState.expiry = searchState.expiry === t.dataset.v ? "" : t.dataset.v; render(); break;
    case "export-all": openBackupExport(null); break;
    case "export-member": openBackupExport(id); break;
    case "restore-backup": openBackupRestore(); break;
  }
}

/* ===================== Sheet (bottom modal) framework ===================== */

function openSheet(html, onMount) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="sheet-overlay" id="active-sheet"><div class="sheet"><div class="sheet-handle"></div>${html}</div></div>`;
  const overlay = $("#active-sheet");
  requestAnimationFrame(() => overlay.classList.add("open"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSheet(); });
  if (onMount) onMount(overlay);
  return overlay;
}
function closeSheet() {
  const overlay = $("#active-sheet");
  if (!overlay) return;
  overlay.classList.remove("open");
  setTimeout(() => {
    // Only clear if no newer sheet has replaced this one in the meantime
    // (e.g. closeSheet() immediately followed by opening the next sheet).
    if ($("#sheet-root").contains(overlay)) $("#sheet-root").innerHTML = "";
  }, 200);
}

/* ===================== Member form ===================== */

function openMemberForm(memberId) {
  const m = memberId ? cacheMember(memberId) : null;
  const html = `
    <div class="sheet-header"><h2>${m ? "Edit" : "Add"} Family Member</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="field">
      <label>Photo</label>
      <div style="display:flex; align-items:center; gap:14px;">
        <div class="avatar" id="mf-avatar" style="width:64px;height:64px;font-size:22px;">${m?.photo ? `<img src="${m.photo}"/>` : "👤"}</div>
        <input type="file" id="mf-photo" accept="image/*" style="flex:1;" />
      </div>
    </div>
    <div class="field"><label>Name</label><input type="text" id="mf-name" value="${m ? escapeHtml(m.name) : ""}" placeholder="e.g. Anjali Sharma" /></div>
    <div class="field"><label>Relationship</label>
      <select id="mf-rel">${RELATIONSHIPS.map((r) => `<option ${m?.relationship === r ? "selected" : ""}>${r}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Date of birth</label><input type="date" id="mf-dob" value="${m?.dob || ""}" /></div>
    <button class="btn block" id="mf-save">${m ? "Save changes" : "Add member"}</button>
    ${m ? `<button class="btn danger block" id="mf-delete" style="margin-top:10px;">Delete member</button>` : ""}
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    let photoData = m?.photo || null;
    $("#mf-photo", overlay).addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      photoData = await resizeImageDataUrl(f, 200);
      $("#mf-avatar", overlay).innerHTML = `<img src="${photoData}"/>`;
    });
    $("#mf-save", overlay).onclick = async () => {
      const name = $("#mf-name", overlay).value.trim();
      if (!name) return toast("Please enter a name");
      const rec = {
        id: m?.id || FVDB.uid("mem_"),
        name,
        relationship: $("#mf-rel", overlay).value,
        dob: $("#mf-dob", overlay).value || "",
        photo: photoData,
        createdAt: m?.createdAt || Date.now()
      };
      await FVDB.put("members", rec);
      await refreshCache();
      closeSheet();
      toast(m ? "Member updated" : "Member added");
      navigate({ type: "memberDetail", memberId: rec.id });
    };
    if (m) $("#mf-delete", overlay).onclick = async () => {
      if (!confirm(`Delete ${m.name}? Their documents will remain but become unassigned.`)) return;
      await FVDB.del("members", m.id);
      const docs = await FVDB.allByIndex("documents", "memberId", m.id);
      for (const d of docs) { d.memberId = ""; await FVDB.put("documents", d); }
      await refreshCache();
      closeSheet();
      navigate({ type: "members" }, "members");
    };
  });
}

/* ===================== Category form (custom) ===================== */

function openCategoryForm() {
  const html = `
    <div class="sheet-header"><h2>Add Custom Category</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="field"><label>Category name</label><input type="text" id="cf-name" placeholder="e.g. Vehicle RC Book" /></div>
    <div class="field"><label>Group</label>
      <select id="cf-group">${Object.keys(GROUP_META).map((g) => `<option ${g === "Custom" ? "selected" : ""}>${g}</option>`).join("")}</select>
    </div>
    <button class="btn block" id="cf-save">Add category</button>
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    $("#cf-save", overlay).onclick = async () => {
      const name = $("#cf-name", overlay).value.trim();
      if (!name) return toast("Please enter a category name");
      await FVDB.put("categories", { id: FVDB.uid("cat_"), name, group: $("#cf-group", overlay).value, custom: true, counter: 0 });
      await refreshCache();
      closeSheet();
      toast("Category added");
      render();
    };
  });
}

/* ===================== Document form ===================== */

function openDocForm({ memberId = "", categoryId = "" } = {}, doc = null) {
  const groups = groupCategories();
  let pendingFiles = []; // {name, mime, blob} not yet encrypted
  let existingFiles = []; // file records already in DB (edit mode)

  const html = `
    <div class="sheet-header"><h2>${doc ? "Edit Document" : "Add Document"}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="field"><label>Title</label><input type="text" id="df-title" value="${doc ? escapeHtml(doc.title) : ""}" placeholder="e.g. Aadhaar Card" /></div>
    <div class="field"><label>Family member</label>
      <select id="df-member"><option value="">Unassigned</option>${state.members.map((m) => `<option value="${m.id}" ${(doc?.memberId || memberId) === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Category</label>
      <select id="df-category">${Object.entries(groups).map(([g, cats]) => `<optgroup label="${g}">${cats.map((c) => `<option value="${c.id}" ${(doc?.categoryId || categoryId) === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</optgroup>`).join("")}</select>
    </div>
    <div class="grid2">
      <div class="field"><label>Issue date</label><input type="date" id="df-issue" value="${doc?.issueDate || ""}" /></div>
      <div class="field"><label>Expiry date</label><input type="date" id="df-expiry" value="${doc?.expiryDate || ""}" /></div>
    </div>
    <div class="field"><label>Tags (comma separated)</label><input type="text" id="df-tags" value="${doc?.tags?.join(", ") || ""}" placeholder="e.g. urgent, travel" /></div>
    <div class="field"><label>Notes</label><textarea id="df-notes">${doc?.notes ? escapeHtml(doc.notes) : ""}</textarea></div>
    <div class="field">
      <label>Attachments (PDF, JPG, PNG)</label>
      <div class="file-thumb-row" id="df-files">
        <button type="button" class="add-file-btn" id="df-add-file">＋</button>
      </div>
      <input type="file" id="df-file-input" accept=".pdf,image/jpeg,image/png,image/jpg" multiple hidden />
    </div>
    <div class="grid2">
      <label class="row" style="padding:6px 0;"><span class="rl">⭐ Favorite</span><input type="checkbox" id="df-fav" ${doc?.favorite ? "checked" : ""}/></label>
      <label class="row" style="padding:6px 0;"><span class="rl">🚨 Emergency</span><input type="checkbox" id="df-emg" ${doc?.emergency ? "checked" : ""}/></label>
    </div>
    <button class="btn block" id="df-save">${doc ? "Save changes" : "Save document"}</button>
    ${doc ? `<button class="btn danger block" id="df-delete" style="margin-top:10px;">Delete document</button>` : ""}
  `;

  openSheet(html, async (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    const thumbRow = $("#df-files", overlay);
    const addBtn = $("#df-add-file", overlay);
    const fileInput = $("#df-file-input", overlay);
    addBtn.onclick = () => fileInput.click();

    async function renderThumbs() {
      thumbRow.querySelectorAll(".file-thumb").forEach((n) => n.remove());
      for (const rec of existingFiles) {
        const blob = await FVCrypto.decryptFile(rec);
        const url = URL.createObjectURL(blob);
        const el = document.createElement("div");
        el.className = "file-thumb";
        el.innerHTML = rec.mime?.startsWith("image/") ? `<img src="${url}"/>` : `📄`;
        el.innerHTML += `<button type="button" class="rm" data-existing="${rec.id}">✕</button>`;
        thumbRow.insertBefore(el, addBtn);
      }
      for (const pf of pendingFiles) {
        const url = URL.createObjectURL(pf.blob);
        const el = document.createElement("div");
        el.className = "file-thumb";
        el.innerHTML = pf.mime.startsWith("image/") ? `<img src="${url}"/>` : `📄`;
        el.innerHTML += `<button type="button" class="rm" data-pending="${pf._tmpId}">✕</button>`;
        thumbRow.insertBefore(el, addBtn);
      }
    }
    if (doc) { existingFiles = await FVDB.allByIndex("files", "documentId", doc.id); await renderThumbs(); }

    fileInput.addEventListener("change", async (e) => {
      for (const f of Array.from(e.target.files)) {
        pendingFiles.push({ _tmpId: FVDB.uid("tmp_"), name: f.name, mime: f.type, blob: f });
      }
      fileInput.value = "";
      await renderThumbs();
    });
    thumbRow.addEventListener("click", async (e) => {
      const rm = e.target.closest(".rm"); if (!rm) return;
      if (rm.dataset.existing) {
        await FVDB.del("files", rm.dataset.existing);
        existingFiles = existingFiles.filter((f) => f.id !== rm.dataset.existing);
      } else if (rm.dataset.pending) {
        pendingFiles = pendingFiles.filter((f) => f._tmpId !== rm.dataset.pending);
      }
      await renderThumbs();
    });

    $("#df-save", overlay).onclick = async () => {
      const title = $("#df-title", overlay).value.trim();
      if (!title) return toast("Please enter a document title");
      const categoryId = $("#df-category", overlay).value;
      const cat = cacheCategory(categoryId);

      let record = doc;
      if (!record) {
        cat.counter = (cat.counter || 0) + 1;
        await FVDB.put("categories", cat);
        const groupCode = GROUP_META[cat.group]?.code || "GEN";
        record = {
          id: FVDB.uid("doc_"),
          refNo: `${groupCode}-${catCode(cat.name)}-${String(cat.counter).padStart(4, "0")}`,
          createdAt: Date.now()
        };
      }
      record.title = title;
      record.memberId = $("#df-member", overlay).value;
      record.categoryId = categoryId;
      record.issueDate = $("#df-issue", overlay).value || "";
      record.expiryDate = $("#df-expiry", overlay).value || "";
      record.notes = $("#df-notes", overlay).value.trim();
      record.tags = $("#df-tags", overlay).value.split(",").map((s) => s.trim()).filter(Boolean);
      record.favorite = $("#df-fav", overlay).checked;
      record.emergency = $("#df-emg", overlay).checked;
      record.updatedAt = Date.now();

      await FVDB.put("documents", record);
      for (const pf of pendingFiles) {
        const enc = await FVCrypto.encryptFile(pf.blob);
        await FVDB.put("files", { id: FVDB.uid("file_"), documentId: record.id, name: pf.name, ...enc });
      }
      await refreshCache();
      closeSheet();
      toast(doc ? "Document updated" : "Document saved");
      openDocSheet(record.id);
    };

    if (doc) $("#df-delete", overlay).onclick = async () => {
      if (!confirm("Delete this document and its attachments? This can't be undone.")) return;
      const files = await FVDB.allByIndex("files", "documentId", doc.id);
      for (const f of files) await FVDB.del("files", f.id);
      await FVDB.del("documents", doc.id);
      await refreshCache();
      closeSheet();
      goBack();
    };
  });
}

/* ===================== Document detail sheet ===================== */

async function openDocSheet(docId) {
  const doc = state.documents.find((d) => d.id === docId);
  if (!doc) return;
  const member = cacheMember(doc.memberId);
  const cat = cacheCategory(doc.categoryId);
  const dleft = doc.expiryDate ? daysUntil(doc.expiryDate) : null;

  const html = `
    <div class="sheet-header"><h2>${escapeHtml(doc.title)}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="refno" style="margin-bottom:10px;">${doc.refNo || ""}</div>
    <div class="chip-row">
      <span class="tag">${escapeHtml(member?.name || "Unassigned")}</span>
      <span class="tag">${escapeHtml(cat?.name || "")}</span>
      ${doc.issueDate ? `<span class="tag">Issued ${fmtDate(doc.issueDate)}</span>` : ""}
      ${doc.expiryDate ? `<span class="tag">${dleft < 0 ? "Expired" : "Expires"} ${fmtDate(doc.expiryDate)}</span>` : ""}
    </div>
    ${doc.tags?.length ? `<div style="margin:6px 0;">${doc.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    ${doc.notes ? `<p style="font-size:13.5px; color:var(--text-soft); margin:10px 0;">${escapeHtml(doc.notes)}</p>` : ""}

    <div class="section-title"><h2>Files</h2></div>
    <div class="file-thumb-row" id="ds-files"></div>

    <div class="section-title"><h2>Quick share</h2></div>
    <div class="share-grid">
      <div class="share-opt" data-action="share-native"><span class="ic">📤</span>Share</div>
      <div class="share-opt" data-action="share-whatsapp"><span class="ic">💬</span>WhatsApp</div>
      <div class="share-opt" data-action="share-email"><span class="ic">✉️</span>Email</div>
      <div class="share-opt" data-action="share-qr"><span class="ic">🔳</span>QR Code</div>
    </div>

    <div class="grid2" style="margin-top:18px;">
      <button class="btn secondary" id="ds-fav">${doc.favorite ? "★ Unfavorite" : "☆ Favorite"}</button>
      <button class="btn secondary" id="ds-edit">✏️ Edit</button>
    </div>
  `;
  openSheet(html, async (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    const filesRow = $("#ds-files", overlay);
    const files = await FVDB.allByIndex("files", "documentId", doc.id);
    if (!files.length) filesRow.innerHTML = `<p class="hint">No files attached yet — edit this document to add PDF/JPG/PNG files.</p>`;
    for (const rec of files) {
      const blob = await FVCrypto.decryptFile(rec);
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url; el.download = rec.name; el.className = "file-thumb";
      el.innerHTML = rec.mime?.startsWith("image/") ? `<img src="${url}"/>` : `📄`;
      filesRow.appendChild(el);
    }

    $("#ds-fav", overlay).onclick = async () => {
      doc.favorite = !doc.favorite;
      await FVDB.put("documents", doc);
      await refreshCache();
      closeSheet(); openDocSheet(doc.id);
    };
    $("#ds-edit", overlay).onclick = () => { closeSheet(); openDocForm({}, doc); };

    overlay.querySelector(".share-grid").addEventListener("click", async (e) => {
      const opt = e.target.closest(".share-opt"); if (!opt) return;
      const action = opt.dataset.action;
      try {
        if (action === "share-native") {
          const res = await FVShare.shareDocument(doc, { asZip: true });
          if (res.method === "unsupported") {
            FVShare.downloadFile(res.files[0]);
            toast("Sharing isn't supported here — file downloaded instead");
          }
        } else if (action === "share-whatsapp") {
          const res = await FVShare.shareDocument(doc);
          if (res.method === "unsupported") {
            FVShare.openWhatsApp(`Sharing "${doc.title}" from Family Vault. (Attach the downloaded file manually — this browser can't attach files to WhatsApp links.)`);
            for (const f of res.files) FVShare.downloadFile(f);
          }
        } else if (action === "share-email") {
          const res = await FVShare.shareDocument(doc, { asZip: true });
          if (res.method === "unsupported") {
            FVShare.openEmail(doc.title, `Sharing "${doc.title}" from Family Vault. The file has been downloaded — attach it to this email manually.`);
            for (const f of res.files) FVShare.downloadFile(f);
          }
        } else if (action === "share-qr") {
          openQrSheet(doc, member, cat);
        }
      } catch (err) {
        toast(err.message || "Couldn't share this document");
      }
    });
  });
}

function openQrSheet(doc, member, cat) {
  const html = `
    <div class="sheet-header"><h2>QR reference card</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="hint">Since Family Vault works fully offline, this QR encodes a reference card (not the file itself) — handy for handing a phone to someone or logging a document by camera.</p>
    <div class="qr-wrap"><canvas id="qr-canvas"></canvas></div>
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    FVQR.render($("#qr-canvas", overlay), FVQR.docReferenceText(doc, member, cat));
  });
}

/* ===================== PIN setup ===================== */

function openPinSetup() {
  let stage = "new"; let firstPin = "";
  const html = `
    <div class="sheet-header"><h2>Set a PIN</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="hint" id="ps-hint">Choose a 6-digit PIN. This encrypts every file on the device.</p>
    <div class="field"><input type="password" inputmode="numeric" maxlength="6" class="pin-input" id="ps-input" placeholder="••••••" /></div>
    <button class="btn block" id="ps-continue">Continue</button>
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = () => { $("#set-pin-toggle").checked = false; closeSheet(); };
    const input = $("#ps-input", overlay);
    $("#ps-continue", overlay).onclick = async () => {
      const val = input.value.trim();
      if (val.length !== 6 || !/^\d{6}$/.test(val)) return toast("Enter a 6-digit PIN");
      if (stage === "new") {
        firstPin = val; stage = "confirm";
        $("#ps-hint", overlay).textContent = "Confirm your PIN.";
        input.value = "";
        $("#ps-continue", overlay).textContent = "Confirm";
      } else {
        if (val !== firstPin) { toast("PINs don't match — try again"); input.value = ""; stage = "new"; firstPin = ""; $("#ps-hint", overlay).textContent = "Choose a 6-digit PIN."; $("#ps-continue", overlay).textContent = "Continue"; return; }
        await FVCrypto.setPin(val);
        closeSheet();
        toast("PIN lock enabled");
        renderSecurityCard();
      }
    };
  });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest('[data-action="change-pin"]');
  if (t) openPinSetup();
});

/* ===================== Backup / restore ===================== */

function openBackupExport(memberId) {
  const html = `
    <div class="sheet-header"><h2>Export backup</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="hint">${memberId ? "Only this member's documents will be included." : "All family members and documents will be included."}</p>
    <div class="field"><label>Backup passphrase</label><input type="password" id="bx-pass" placeholder="Choose a strong passphrase" /></div>
    <button class="btn block" id="bx-go">Create encrypted backup</button>
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    $("#bx-go", overlay).onclick = async () => {
      const pass = $("#bx-pass", overlay).value;
      if (pass.length < 4) return toast("Use a longer passphrase");
      toast("Building backup…");
      try {
        const file = await buildBackupFile(pass, memberId);
        FVShare.downloadFile(file);
        closeSheet();
        toast("Backup downloaded");
      } catch (err) { toast("Backup failed: " + err.message); }
    };
  });
}

async function buildBackupFile(passphrase, memberId) {
  const members = memberId ? state.members.filter((m) => m.id === memberId) : state.members;
  const documents = memberId ? state.documents.filter((d) => d.memberId === memberId) : state.documents;
  const categories = state.categories;
  const files = [];
  for (const d of documents) {
    const recs = await FVDB.allByIndex("files", "documentId", d.id);
    for (const r of recs) {
      const blob = await FVCrypto.decryptFile(r);
      files.push({ id: r.id, documentId: r.documentId, name: r.name, mime: r.mime, dataB64: await blobToB64(blob) });
    }
  }
  const payload = JSON.stringify({ exportedAt: Date.now(), members, categories, documents, files });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));

  const envelope = JSON.stringify({
    app: "family-vault-backup", version: 1,
    salt: b64(salt.buffer), iv: b64(iv), data: b64(cipher)
  });
  return new File([envelope], `family-vault-backup-${new Date().toISOString().slice(0, 10)}.fvbackup`, { type: "application/json" });
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function unb64(str) {
  const bin = atob(str); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function openBackupRestore() {
  const html = `
    <div class="sheet-header"><h2>Restore backup</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="field"><label>Backup file (.fvbackup)</label><input type="file" id="br-file" accept=".fvbackup,application/json" /></div>
    <div class="field"><label>Passphrase</label><input type="password" id="br-pass" /></div>
    <p class="hint">Restoring merges into your current vault. Documents with the same reference are kept as separate copies (nothing is silently overwritten).</p>
    <button class="btn block" id="br-go">Restore</button>
  `;
  openSheet(html, (overlay) => {
    $("[data-close]", overlay).onclick = closeSheet;
    $("#br-go", overlay).onclick = async () => {
      const f = $("#br-file", overlay).files[0];
      const pass = $("#br-pass", overlay).value;
      if (!f) return toast("Choose a backup file");
      toast("Restoring…");
      try {
        const text = await f.text();
        const env = JSON.parse(text);
        const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
        const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(env.salt), iterations: 150000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(unb64(env.iv)) }, key, unb64(env.data));
        const payload = JSON.parse(new TextDecoder().decode(plainBuf));
        await importBackupPayload(payload);
        await refreshCache();
        closeSheet();
        toast("Backup restored");
        navigate({ type: "home" }, "home");
      } catch (err) {
        toast("Restore failed — check the passphrase and file");
      }
    };
  });
}

async function importBackupPayload(payload) {
  const idMap = {};
  for (const m of payload.members || []) {
    const newId = FVDB.uid("mem_"); idMap[m.id] = newId;
    await FVDB.put("members", { ...m, id: newId });
  }
  const catIdMap = {};
  for (const c of payload.categories || []) {
    const existing = state.categories.find((x) => x.name === c.name && x.group === c.group);
    if (existing) { catIdMap[c.id] = existing.id; }
    else {
      const newId = FVDB.uid("cat_");
      await FVDB.put("categories", { ...c, id: newId });
      catIdMap[c.id] = newId;
    }
  }
  const docIdMap = {};
  for (const d of payload.documents || []) {
    const newId = FVDB.uid("doc_"); docIdMap[d.id] = newId;
    await FVDB.put("documents", {
      ...d, id: newId,
      memberId: idMap[d.memberId] || "",
      categoryId: catIdMap[d.categoryId] || d.categoryId
    });
  }
  for (const f of payload.files || []) {
    const bin = atob(f.dataB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: f.mime });
    const enc = await FVCrypto.encryptFile(blob);
    await FVDB.put("files", { id: FVDB.uid("file_"), documentId: docIdMap[f.documentId], name: f.name, ...enc });
  }
}
