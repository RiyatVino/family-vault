// Family Vault — main application.
// Vanilla JS, no framework. Flow is deliberately simple:
// Family members  →  a member's documents  →  download / share a document.

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
  view: { type: "members" },
  stack: [],
  members: [],
  categories: [],
  documents: [],
  theme: (() => { try { return localStorage.getItem("fv_theme") || "light"; } catch (e) { return "light"; } })()
};

function cacheMember(id) { return state.members.find((m) => m.id === id); }
function cacheCategory(id) { return state.categories.find((c) => c.id === id); }

/* ===================== Boot ===================== */

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  document.documentElement.setAttribute("data-theme", state.theme);
  await FVDB.open();
  await FVCrypto.ensureUnlockedNoPin();
  await startApp();
}

async function startApp() {
  await seedCategoriesIfNeeded();
  await refreshCache();
  $("#topbar").hidden = false;
  $("#view").hidden = false;
  $("#fab-add").hidden = false;
  $("#btn-theme").textContent = state.theme === "dark" ? "☀️" : "🌙";
  bindChrome();
  navigate({ type: "members" });
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

function maybeShowExpiryReminder() {
  const expiring = state.documents.filter((d) => d.expiryDate && daysUntil(d.expiryDate) !== null && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 7);
  if (expiring.length) toast(`⏰ ${expiring.length} document${expiring.length > 1 ? "s" : ""} expiring within 7 days`);
}

/* ===================== Navigation ===================== */

function navigate(view) {
  if (view.type === "members") { state.stack = []; }
  else if (state.view && state.view.type !== view.type) { state.stack.push(state.view); }
  state.view = view;
  render();
}
function goBack() {
  const prev = state.stack.pop();
  state.view = prev || { type: "members" };
  render();
}

function bindChrome() {
  $("#btn-theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("fv_theme", state.theme); } catch (e) {}
    document.documentElement.setAttribute("data-theme", state.theme);
    $("#btn-theme").textContent = state.theme === "dark" ? "☀️" : "🌙";
  });
  $("#fab-add").addEventListener("click", () => {
    if (state.view.type === "memberDetail") openDocForm({ memberId: state.view.memberId });
    else openMemberForm();
  });
}

/* ===================== Render dispatcher ===================== */

function render() {
  const v = state.view;
  const isTop = v.type === "members";

  const view = $("#view");
  switch (v.type) {
    case "memberDetail": view.innerHTML = renderMemberDetail(v.memberId); break;
    case "members":
    default: view.innerHTML = renderMembersTab();
  }

  $("#topbar-title").textContent = v.title || (isTop ? "Family" : "");
  $("#topbar-eyebrow").textContent = isTop ? "Family Vault" : "◂ Back";
  $("#topbar-eyebrow").style.cursor = isTop ? "default" : "pointer";
  $("#topbar-eyebrow").onclick = isTop ? null : goBack;
  $("#fab-add").title = isTop ? "Add family member" : "Add document";

  bindViewActions();
}

/* ===================== Family members ===================== */

function renderMembersTab() {
  return `
    <div class="section-title"><h2>Family members</h2><button class="link" data-action="open-member-form">+ Add</button></div>
    ${state.members.length ? `<div class="grid2">${state.members.map(memberCard).join("")}</div>` :
      emptyState("👪", "Add your first family member", "Set up a profile for everyone, then start filing documents under each person.", `<button class="btn" data-action="open-member-form">Add Family Member</button>`)}
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
function initials(name = "") { return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }

function emptyState(glyph, title, desc, actionsHtml) {
  return `<div class="empty"><div class="glyph">${glyph}</div><h3>${title}</h3><p>${desc}</p>${actionsHtml || ""}</div>`;
}

/* ===================== A member's documents ===================== */

function renderMemberDetail(memberId) {
  const m = cacheMember(memberId);
  if (!m) return emptyState("⚠️", "Member not found", "");
  state.view.title = m.name;
  const docs = state.documents.filter((d) => d.memberId === memberId);
  return `
    <div class="card" style="display:flex; gap:12px; align-items:center;">
      <div class="avatar" style="width:56px;height:56px;font-size:20px;">${m.photo ? `<img src="${m.photo}" />` : initials(m.name)}</div>
      <div style="flex:1;">
        <div style="font-weight:700; font-size:16px;">${escapeHtml(m.name)}</div>
        <div style="font-size:12px; color:var(--text-faint);">${escapeHtml(m.relationship || "")} ${m.dob ? "· " + fmtDate(m.dob) : ""}</div>
      </div>
      <button class="btn secondary sm" data-action="open-member-form" data-id="${m.id}">Edit</button>
    </div>
    <div class="section-title"><h2>Documents</h2><button class="link" data-action="open-doc-form" data-member="${memberId}">+ Add</button></div>
    ${docs.length ? docs.map(docRow).join("") : emptyState("📄", "No documents yet", "Add this person's first document.")}
  `;
}

function docRow(d) {
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
      <div class="meta"><span>${escapeHtml(cat?.name || "")}</span></div>
      ${badge}
    </div>
  </div>`;
}

function groupCategories() {
  const groups = {};
  for (const c of state.categories) { (groups[c.group] ||= []).push(c); }
  return groups;
}

/* ===================== Delegated view actions ===================== */

function bindViewActions() {
  $("#view").onclick = onViewAction;
}

async function onViewAction(e) {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const action = t.dataset.action;
  const id = t.dataset.id;

  switch (action) {
    case "open-member": navigate({ type: "memberDetail", memberId: id }); break;
    case "open-member-form": openMemberForm(id); break;
    case "open-doc-form": openDocForm({ memberId: t.dataset.member }); break;
    case "open-doc": openDocSheet(id); break;
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
      navigate({ type: "members" });
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
    <div class="field"><label>Notes</label><textarea id="df-notes">${doc?.notes ? escapeHtml(doc.notes) : ""}</textarea></div>
    <div class="field">
      <label>Attachments (PDF, JPG, PNG)</label>
      <div class="file-thumb-row" id="df-files">
        <button type="button" class="add-file-btn" id="df-add-file">＋</button>
      </div>
      <input type="file" id="df-file-input" accept=".pdf,image/jpeg,image/png,image/jpg" multiple hidden />
    </div>
    <label class="row" style="padding:6px 0;"><span class="rl">⭐ Favorite</span><input type="checkbox" id="df-fav" ${doc?.favorite ? "checked" : ""}/></label>
    <button class="btn block" id="df-save" style="margin-top:10px;">${doc ? "Save changes" : "Save document"}</button>
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
      record.tags = record.tags || [];
      record.favorite = $("#df-fav", overlay).checked;
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
    ${doc.notes ? `<p style="font-size:13.5px; color:var(--text-soft); margin:10px 0;">${escapeHtml(doc.notes)}</p>` : ""}

    <div class="section-title"><h2>Files</h2></div>
    <div class="file-thumb-row" id="ds-files"></div>

    <div class="section-title"><h2>Download &amp; share</h2></div>
    <div class="share-grid">
      <div class="share-opt" data-action="download-doc"><span class="ic">⬇️</span>Download</div>
      <div class="share-opt" data-action="share-whatsapp"><span class="ic">💬</span>WhatsApp</div>
      <div class="share-opt" data-action="share-email"><span class="ic">✉️</span>Gmail</div>
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
        if (action === "download-doc") {
          const files = await FVShare.decryptedFilesFor(doc);
          if (!files.length) return toast("No files attached yet");
          if (files.length === 1) FVShare.downloadFile(files[0]);
          else FVShare.downloadFile(await FVShare.buildZip([doc]));
          toast("Downloaded");
        } else if (action === "share-whatsapp") {
          const res = await FVShare.shareDocument(doc);
          if (res.method === "unsupported") {
            FVShare.openWhatsApp(`Sharing "${doc.title}" from Family Vault. (Attach the downloaded file manually — this browser can't attach files to WhatsApp links.)`);
            for (const f of res.files) FVShare.downloadFile(f);
          }
        } else if (action === "share-email") {
          const res = await FVShare.shareDocument(doc, { asZip: true });
          if (res.method === "unsupported") {
            FVShare.openEmail(doc.title, `Sharing "${doc.title}" from Family Vault. The file has been downloaded — attach it to this Gmail message manually.`);
            for (const f of res.files) FVShare.downloadFile(f);
          }
        }
      } catch (err) {
        toast(err.message || "Couldn't complete that action");
      }
    });
  });
}
