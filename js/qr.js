// Family Vault — QR helper.
// Wraps the vendored qrcode-generator (Kazuhiko Arase, MIT) to draw a QR
// onto a canvas. The app is 100% offline, so a QR can't point at a hosted
// URL for the file itself — instead it encodes a compact reference card
// (document title, category, family member, reference number) that a
// receiving device can read at a glance, e.g. when handing a phone over
// in person or scanning between two family members' installs.
const FVQR = (() => {
  function render(canvas, text, { size = 240 } = {}) {
    const qr = qrcode(0, "M"); // type 0 = auto-detect smallest size
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.floor(size / count);
    const px = cell * count;
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#1B2420";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    return canvas;
  }

  function docReferenceText(doc, member, category) {
    return [
      `FAMILY VAULT DOCUMENT`,
      `Ref: ${doc.refNo}`,
      `Title: ${doc.title}`,
      `Member: ${member ? member.name : "-"}`,
      `Category: ${category ? category.name : "-"}`,
      doc.expiryDate ? `Expires: ${doc.expiryDate}` : null
    ].filter(Boolean).join("\n");
  }

  return { render, docReferenceText };
})();
