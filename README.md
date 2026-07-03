# Family Vault — Offline Family Document Manager

A fully offline, installable web app for storing, organizing, and instantly
sharing every family member's important documents. No backend, no account,
no tracking — everything lives in your phone's browser storage.

This is a **website** (plain HTML/CSS/JS). It is not a native Android app —
you don't install an APK. You open it in Chrome, and Chrome lets you "Add to
Home screen" so it behaves like an app (its own icon, full-screen, works
offline). Under the hood it's just files served over HTTP.

---

## 1. How to run it

Browsers block `IndexedDB`, `localStorage`, and Service Workers on pages
opened directly from disk (`file://…`). So this needs to be served over
`http://` or `https://` — even if that "server" is just your own laptop.
Pick whichever is easiest for you:

### Option A — Host it for free (recommended, gives you a real HTTPS link)
1. Create a free GitHub account if you don't have one.
2. Create a new repository and upload every file in this folder, keeping
   the folder structure (`index.html` at the root, `css/`, `js/`, `vendor/`,
   `icons/` alongside it).
3. In the repo, go to **Settings → Pages**, set the source to the `main`
   branch, root folder, and save. GitHub gives you a URL like
   `https://yourname.github.io/family-vault/`.
4. Open that link on your Android phone in Chrome.
5. Tap the **⋮** menu → **Add to Home screen** (Chrome may also prompt you
   automatically). It now opens like an app, and works with the phone in
   airplane mode.

Netlify Drop (netlify.com/drop) and Cloudflare Pages work the same way if
you'd rather drag-and-drop the folder instead of using git.

### Option B — Run it from your own computer, on your home Wi-Fi
1. Install [Node.js](https://nodejs.org) or just use Python (usually
   already installed on macOS/Linux).
2. In this folder, run either:
   ```
   npx serve .
   ```
   or
   ```
   python3 -m http.server 8080
   ```
3. Find your computer's local IP address (e.g. `192.168.1.20`).
4. On your phone (same Wi-Fi), open `http://192.168.1.20:8080` (or
   whatever port the tool printed) in Chrome, then **Add to Home screen**.

> Once installed via "Add to Home screen," the service worker caches the
> entire app, so it keeps working with **zero internet connection** —
> reopening it from the home screen icon never needs Wi-Fi/data again.
> You only need connectivity again if you want to use WhatsApp/Gmail
> sharing, which hands off to those apps.

### Option C — Quick local preview on a desktop browser
Any static server works, e.g. `npx serve .` and open
`http://localhost:3000` in Chrome/Edge on your computer to try it before
deploying to a phone.

---

## 2. What's implemented

- **Fully offline** — IndexedDB storage, a Service Worker that caches the
  entire app shell, and a Web App Manifest so Chrome can install it.
- **Multiple family members** — name, relationship, date of birth, photo,
  each with their own document shelf.
- **Predefined categories** across Identity, Educational, Government,
  Financial, Medical, and Personal documents, exactly as specified, plus
  unlimited **custom categories**.
- **Documents** — title, category, member, issue/expiry dates, notes,
  tags, and multiple PDF/JPG/PNG attachments per document. Every document
  gets an auto-generated reference number (e.g. `IDN-AAD-0001`), like a
  real filing-cabinet index.
- **Search** by name/notes/tags text, member, category, favorites, and
  expiry window (expired / next 30 / next 90 days).
- **Quick Share** — the native Android share sheet (`navigator.share`)
  lets you send a document straight to WhatsApp, Gmail, Drive, Bluetooth,
  etc., including multiple files zipped together. Falls back to
  `wa.me`/`mailto:` text links plus a manual file download on browsers
  that don't support file sharing (e.g. desktop Chrome).
- **Security** — optional 6-digit PIN, AES-256-GCM encryption of every
  file (key derived from the PIN via PBKDF2, 150k iterations), and an
  optional WebAuthn-based biometric unlock layered on top of the PIN.
- **Backup & restore** — encrypted `.fvbackup` export (full vault or a
  single member), passphrase-protected, restorable on any device running
  the same app.
- **Dashboard** — member/document counts, documents expiring within 30
  days, recently added documents, an Emergency-documents shortcut, and a
  Favorites flag.
- **QR codes** — generates a scannable reference card for a document
  (title, member, category, ref number, expiry). Since the app is fully
  offline it can't encode a hosted file URL — see the note in-app.
- **Dark mode**, mobile-first card UI, bottom navigation, large tap
  targets.

## 3. Deliberately simplified / not included

Being upfront about scope so nothing surprises you later:

- **OCR** — not bundled. Real offline OCR (e.g. Tesseract.js) needs ~10MB+
  of WASM/model files per language, which is a lot to ship in a first
  version. The document form has room to add an "Extract text" button —
  wire it to `tesseract.js` if you want this; happy to add it as a
  follow-up.
- **Biometric unlock** uses WebAuthn's platform authenticator as a
  convenience gate (Chrome only shows the fingerprint/face prompt for a
  credential it already trusts on that device). The PIN remains the
  actual source of the encryption key — biometrics unlock the *session*,
  not the file encryption itself, since there's no server to verify a
  WebAuthn assertion against.
- **Background expiry notifications** — reminders currently show when you
  open the app (a toast for documents expiring within 7 days, plus a
  dashboard section for 30 days). True background push notifications
  while the app is closed need a push service and aren't reliable across
  Android browsers for a no-backend app.
- Member **photos** are stored unencrypted (resized to a small thumbnail)
  so avatars render instantly in lists; **document files** are the ones
  that get AES-256 encrypted, since those are the sensitive data.

## 4. Folder structure

```
index.html            — app shell
manifest.json          — PWA install manifest
service-worker.js      — offline caching
css/style.css           — design system + all UI styling
js/db.js               — IndexedDB wrapper + schema
js/crypto.js            — PIN handling, AES-GCM encryption, biometrics
js/zip-share.js         — Web Share API + ZIP bundling for multi-file share
js/qr.js                — QR code rendering
js/app.js               — all screens, forms, navigation, backup/restore
vendor/qrcode.js         — QR encoder (Kazuhiko Arase, MIT license)
vendor/fflate.js         — ZIP compression (MIT license)
icons/                  — app icons (incl. maskable variants)
```

No build step, no bundler, no npm install needed to run it — the two
vendor files are the only third-party code, and they're already included.

## 5. Data & privacy

Everything — member profiles, documents, and file attachments — is stored
in the browser's IndexedDB on that one device. There is no server and
nothing is ever uploaded anywhere by the app itself. Clearing the
browser's site data (or uninstalling if installed as an app) deletes the
vault, so use the backup feature periodically and keep the exported
`.fvbackup` file (and its passphrase) somewhere safe.
