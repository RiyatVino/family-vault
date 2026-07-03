// Family Vault — sharing layer.
// Uses the Web Share API (level 2, file sharing) which on Android lets the
// user pick WhatsApp, Gmail, Drive, Bluetooth, etc. from the native sheet.
// Falls back to wa.me / mailto text links when file sharing isn't
// supported, and to a manual "save the zip" flow otherwise.

const FVShare = (() => {

  async function decryptedFilesFor(doc) {
    const fileRecs = await FVDB.allByIndex("files", "documentId", doc.id);
    const out = [];
    for (const rec of fileRecs) {
      const blob = await FVCrypto.decryptFile(rec);
      out.push(new File([blob], rec.name, { type: rec.mime || blob.type }));
    }
    return out;
  }

  async function buildZip(docs) {
    const zipInput = {};
    for (const doc of docs) {
      const files = await decryptedFilesFor(doc);
      for (const f of files) {
        const safeDocName = (doc.title || "document").replace(/[\\/:*?"<>|]/g, "_");
        const path = docs.length > 1 ? `${safeDocName}/${f.name}` : f.name;
        zipInput[path] = new Uint8Array(await f.arrayBuffer());
      }
    }
    const zipped = fflate.zipSync(zipInput, { level: 6 });
    return new File([zipped], `family-vault-share-${Date.now()}.zip`, { type: "application/zip" });
  }

  function canShareFiles(files) {
    return !!(navigator.canShare && navigator.canShare({ files }));
  }

  // Share one document. If it has multiple attachments, they're shared as
  // separate files together (WhatsApp/Gmail both accept multi-file shares).
  async function shareDocument(doc, { asZip = false } = {}) {
    const files = await decryptedFilesFor(doc);
    if (!files.length) throw new Error("This document has no attached files yet.");

    let shareFiles = files;
    if (asZip && files.length > 1) shareFiles = [await buildZip([doc])];

    await logShare(doc.id);

    if (navigator.share && canShareFiles(shareFiles)) {
      await navigator.share({ files: shareFiles, title: doc.title, text: doc.title });
      return { method: "share-sheet" };
    }
    return { method: "unsupported", files: shareFiles };
  }

  async function shareMultipleDocuments(docs) {
    const zipFile = await buildZip(docs);
    for (const d of docs) await logShare(d.id);
    if (navigator.share && canShareFiles([zipFile])) {
      await navigator.share({ files: [zipFile], title: "Family Vault documents" });
      return { method: "share-sheet" };
    }
    return { method: "unsupported", files: [zipFile] };
  }

  function openWhatsApp(text) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }
  function openEmail(subject, body) {
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function logShare(documentId) {
    await FVDB.put("shareLog", { id: FVDB.uid("share_"), documentId, ts: Date.now() });
  }

  return { shareDocument, shareMultipleDocuments, openWhatsApp, openEmail, downloadFile, buildZip, decryptedFilesFor, logShare };
})();
