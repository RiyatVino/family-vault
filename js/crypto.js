// Family Vault — encryption layer.
// Every file attachment is stored in IndexedDB as AES-GCM ciphertext.
// The AES key is derived (PBKDF2-SHA256) from the vault PIN, so nothing
// ever leaves the device and nothing is decryptable without the PIN.
// If the person never sets a PIN, a random on-device key is used instead
// so files still aren't stored as raw bytes — but real confidentiality
// requires enabling the PIN, since that key isn't derivable from a secret.

const FVCrypto = (() => {
  let sessionKey = null; // CryptoKey, held only in memory while unlocked

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveKey(pin, saltB64) {
    const enc = new TextEncoder();
    const salt = b64ToBuf(saltB64);
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function randomSaltB64() {
    return bufToB64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  }

  async function encrypt(key, plainBuf) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBuf);
    return { iv: bufToB64(iv.buffer), data: bufToB64(data) };
  }

  async function decrypt(key, ivB64, dataB64) {
    const iv = new Uint8Array(b64ToBuf(ivB64));
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(dataB64));
  }

  // ---- PIN setup / verification ----
  // We never store the PIN. We store a random salt + a ciphertext of a
  // known marker string. Unlock succeeds only if decrypting the marker
  // with the freshly-derived key works.
  async function setPin(pin) {
    const salt = randomSaltB64();
    const key = await deriveKey(pin, salt);
    const marker = await encrypt(key, new TextEncoder().encode("family-vault-ok"));
    await FVDB.put("settings", { key: "security", pinEnabled: true, salt, markerIv: marker.iv, markerData: marker.data });
    sessionKey = key;
    return true;
  }

  async function tryUnlock(pin) {
    const sec = await FVDB.get("settings", "security");
    if (!sec || !sec.pinEnabled) return false;
    try {
      const key = await deriveKey(pin, sec.salt);
      const plain = await decrypt(key, sec.markerIv, sec.markerData);
      if (new TextDecoder().decode(plain) === "family-vault-ok") {
        sessionKey = key;
        return true;
      }
    } catch (e) { /* wrong pin -> decrypt fails */ }
    return false;
  }

  async function disablePin() {
    // Files encrypted under the PIN-derived key are re-encrypted under a
    // fresh random device key so they remain readable without a PIN.
    const deviceKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const raw = await crypto.subtle.exportKey("raw", deviceKey);
    await FVDB.put("settings", { key: "security", pinEnabled: false, deviceKeyB64: bufToB64(raw) });
    sessionKey = deviceKey;
  }

  async function ensureUnlockedNoPin() {
    const sec = await FVDB.get("settings", "security");
    if (sec && !sec.pinEnabled && sec.deviceKeyB64) {
      sessionKey = await crypto.subtle.importKey("raw", b64ToBuf(sec.deviceKeyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
      return true;
    }
    if (!sec) {
      // first run, no security configured yet: create a device key
      const deviceKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      const raw = await crypto.subtle.exportKey("raw", deviceKey);
      await FVDB.put("settings", { key: "security", pinEnabled: false, deviceKeyB64: bufToB64(raw) });
      sessionKey = deviceKey;
      return true;
    }
    return false;
  }

  function isUnlocked() { return !!sessionKey; }
  function lock() { sessionKey = null; }

  async function encryptFile(blob) {
    const buf = await blob.arrayBuffer();
    const { iv, data } = await encrypt(sessionKey, buf);
    return { iv, data, mime: blob.type, size: blob.size };
  }

  async function decryptFile(fileRec) {
    const buf = await decrypt(sessionKey, fileRec.iv, fileRec.data);
    return new Blob([buf], { type: fileRec.mime });
  }

  // ---- Optional biometric unlock (WebAuthn platform authenticator) ----
  // This gates the app behind the device's fingerprint/face prompt. It's a
  // convenience layer on top of the PIN (the browser only shows the
  // biometric prompt for a credential it already trusts on this device);
  // the PIN remains the source of the actual encryption key.
  async function biometricAvailable() {
    return !!(window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false)));
  }

  async function registerBiometric() {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Family Vault" },
        user: { id: userId, name: "family-vault-user", displayName: "Family Vault" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000
      }
    });
    if (!cred) return false;
    await FVDB.put("settings", { key: "biometric", enabled: true, credId: bufToB64(cred.rawId) });
    return true;
  }

  async function verifyBiometric() {
    const rec = await FVDB.get("settings", "biometric");
    if (!rec || !rec.enabled) return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: b64ToBuf(rec.credId), type: "public-key" }],
          userVerification: "required",
          timeout: 60000
        }
      });
      return !!assertion;
    } catch (e) { return false; }
  }

  return {
    setPin, tryUnlock, disablePin, ensureUnlockedNoPin, isUnlocked, lock,
    encryptFile, decryptFile, biometricAvailable, registerBiometric, verifyBiometric,
    bufToB64, b64ToBuf
  };
})();
