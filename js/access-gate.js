// Family Vault — site access gate.
//
// A simple static 4-digit code that protects the whole site. This is
// separate from the in-app vault PIN (Settings → PIN lock), which
// encrypts the documents themselves. This gate just stops a stranger
// who opens the link from seeing the app at all.
//
// ⚠️ CHANGE THIS CODE before sharing the link with your family.
const ACCESS_CODE = "1234";

// Remembers the unlock for this browser tab/session only — closing the
// app (or the browser) will ask for the code again next time.
const SESSION_KEY = "fv_gate_unlocked";

(function () {
  if (sessionStorage.getItem(SESSION_KEY) === "1") return; // already unlocked this session
  renderGate();

  function renderGate() {
    const root = document.getElementById("access-gate-root");
    let code = "";
    root.innerHTML = `
      <div class="lockscreen" id="gate-screen">
        <div class="seal">🔐</div>
        <h1>Family Vault</h1>
        <p>Enter the 4-digit access code</p>
        <div class="dots" id="gate-dots"></div>
        <div class="gate-error" id="gate-error"></div>
        <div class="keypad" id="gate-keypad"></div>
      </div>`;

    const screenEl = document.getElementById("gate-screen");
    const dotsEl = document.getElementById("gate-dots");
    const errorEl = document.getElementById("gate-error");

    function drawDots() {
      dotsEl.innerHTML = Array.from({ length: 4 })
        .map((_, i) => `<div class="d ${i < code.length ? "filled" : ""}"></div>`)
        .join("");
    }
    drawDots();

    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
    document.getElementById("gate-keypad").innerHTML = keys
      .map((k) => (k ? `<button data-k="${k}">${k}</button>` : `<span></span>`))
      .join("");

    document.getElementById("gate-keypad").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const k = btn.dataset.k;
      errorEl.textContent = "";
      dotsEl.classList.remove("error");

      if (k === "⌫") code = code.slice(0, -1);
      else if (code.length < 4) code += k;
      drawDots();

      if (code.length === 4) {
        if (code === ACCESS_CODE) {
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
          unlock();
        } else {
          errorEl.textContent = "Incorrect code, try again";
          dotsEl.classList.add("error");
          screenEl.classList.add("shake");
          setTimeout(() => screenEl.classList.remove("shake"), 400);
          code = "";
          setTimeout(drawDots, 120);
        }
      }
    });

    function unlock() {
      screenEl.style.transition = "opacity .25s ease";
      screenEl.style.opacity = "0";
      setTimeout(() => { root.innerHTML = ""; }, 250);
    }
  }
})();
