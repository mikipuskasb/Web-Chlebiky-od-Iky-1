import "./style.css";

const app = document.querySelector("#app");
const euro = (value) =>
  new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(
    value / 100,
  );
const dateLabel = (value) =>
  new Intl.DateTimeFormat("sk-SK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value + "T12:00:00"));
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const icons = {
  arrow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2"/></svg>',
  wheat:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 22 18 3M9 18c-5 0-6-3-5-6 4 0 6 2 5 6Zm3-5c-5 0-5-3-4-6 4 1 5 3 4 6Zm3-5c-3-2-2-5 0-7 3 2 3 4 0 7Zm-3 9c0-4 3-6 7-5 0 4-3 6-7 5Zm3-5c0-4 3-6 7-5 0 4-3 6-7 5Z"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
const state = {
  member: null,
  offer: null,
  quantities: {},
  adminKey: "",
  offers: [],
  selected: null,
  authMode: "register",
  members: [],
};
const slug = location.pathname.match(/^\/ponuka\/([a-f0-9]{32})$/)?.[1];
const adminPage = location.pathname === "/admin";
let polling;

async function api(path, { method = "GET", body, admin = false } = {}) {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(admin ? { Authorization: "Bearer " + state.adminKey } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || "Požiadavka sa nepodarila.");
    error.status = res.status;
    throw error;
  }
  return data;
}
function toast(message, error = false) {
  document.querySelector(".toast")?.remove();
  const box = document.createElement("div");
  box.className = "toast" + (error ? " error" : "");
  box.setAttribute("role", error ? "alert" : "status");
  box.textContent = message;
  document.body.append(box);
  setTimeout(() => box.remove(), 6500);
}
const statusLabel = (status) =>
  ({
    draft: "Rozpracovaná",
    published: "Objednávanie otvorené",
    closed: "Uzavretá",
  })[status];
function header() {
  return `<header class="site-header"><a href="/" class="brand" aria-label="Chlebíky od Iky – úvod">${icons.wheat}<span>Chlebíky <i>od Iky</i><small>POCTIVO. DOMÁCO. PRE VÁS.</small></span></a><nav aria-label="Hlavná navigácia">${adminPage ? '<a href="/" class="quiet">Zákaznícky web</a><span class="nav-pill">Správa pre Iku</span>' : `<a href="/#ako-to-funguje" class="quiet how-link">Ako to funguje</a>${state.member ? `<span class="member-name">Ahoj, ${esc(state.member.name.split(" ")[0])}</span><button class="text-button" id="logout">Odhlásiť</button>` : slug ? '<button class="button small secondary" id="open-login">Môj účet</button>' : '<span class="nav-pill">Z našej kuchyne</span>'}`}</nav></header>`;
}
function footer() {
  return `<footer class="site-footer"><a class="footer-brand" href="/">Chlebíky <i>od Iky</i></a><span>Malé pečenie. Veľká radosť.</span><a href="/admin">Vstup pre Iku ${icons.arrow}</a></footer>`;
}
const steps = () =>
  `<section class="steps-section" id="ako-to-funguje"><div class="section-heading"><span class="eyebrow">OD PONUKY AŽ NA VÁŠ STÔL</span><h2>Každý týždeň trochu inak.<br>Vždy jednoducho.</h2></div><div class="steps"><article><span class="step-number">01</span><h3>V utorok príde ponuka</h3><p>Ika pridá čerstvú ponuku a pošle odkaz do našej WhatsApp skupiny.</p></article><article><span class="step-number">02</span><h3>Vyberiete si svoj chlebík</h3><p>Prihlásite sa a rezervujete si toľko kusov, koľko potrebujete a koľko ešte zostáva.</p></article><article><span class="step-number">03</span><h3>V stredu je napečené</h3><p>Vaša objednávka čaká na vás. Podrobnosti odberu si dohodneme v skupine.</p></article></div></section>`;
function home() {
  const remembered = localStorage.getItem("iky-last-offer");
  app.innerHTML = `${header()}<main><section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="tiny-line"></span> MALÁ DOMÁCA PEKÁREŇ</span><h1>Chlebík, na ktorý<br>sa <em>tešíte.</em></h1><p>Chrumkavá kôrka, mäkká striedka a vôňa domova. Chlebíky a pečivo od Iky, pripravené pre našu malú komunitu.</p><a class="button" href="#ako-to-funguje">Ako si objednať ${icons.arrow}</a><div class="hero-note">${icons.clock}<span>Nová ponuka v utorok · Pečieme na stredu</span></div></div><div class="hero-art"><img src="/bread.svg" alt="Ilustrácia domáceho chleba s klasmi obilia"><span class="art-note">S láskou,<br><i>Ika</i></span><div class="round-seal">PEČENÉ<br><strong>♥</strong><br>PRE VÁS</div></div></section><section class="invitation"><div class="invitation-icon">${icons.bag}</div><div><span class="eyebrow">PONUKA PRE NAŠU SKUPINU</span><h2>Váš chlebík je len o klik ďalej.</h2><p>Aktuálnu ponuku otvoríte cez odkaz, ktorý Ika zdieľa vo WhatsApp skupine Chlebíky od Iky.</p></div>${remembered && /^[a-f0-9]{32}$/.test(remembered) ? `<a class="button secondary" href="/ponuka/${remembered}">Moja posledná ponuka ${icons.arrow}</a>` : '<span class="invitation-badge">Sledujte našu skupinu</span>'}</section>${steps()}</main>${footer()}`;
  bindCommon();
}
function bindCommon() {
  document.querySelector("#logout")?.addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST", body: {} });
      state.member = null;
      if (slug) {
        await loadOffer();
        renderOffer();
      } else home();
      toast("Ste odhlásení.");
    } catch (error) {
      toast(error.message, true);
    }
  });
  document
    .querySelector("#open-login")
    ?.addEventListener("click", () => showAuth("login"));
}
async function loadOffer() {
  const { offer } = await api("/offers/" + slug);
  state.offer = offer;
  state.quantities = Object.fromEntries(
    offer.ownItems.map((item) => [item.id, item.quantity]),
  );
  localStorage.setItem("iky-last-offer", slug);
}
function renderOffer() {
  const offer = state.offer;
  const open = offer.status === "published";
  const hasOrder = offer.ownItems.length > 0;
  app.innerHTML = `${header()}<main class="offer-page"><div class="page-intro"><div><span class="eyebrow">ČERSTVO Z IKINEJ KUCHYNE</span><h1>${esc(offer.title)}</h1><p>Na ${esc(dateLabel(offer.date))} <span class="intro-dot">·</span> Odber podľa dohody v skupine</p></div><span class="status ${offer.status}">${open ? '<span class="status-dot"></span>' : icons.check}${statusLabel(offer.status)}</span></div>${!open ? '<div class="notice">Táto ponuka je už uzavretá. Nový odkaz nájdete vo WhatsApp skupine. Svoju uloženú objednávku si môžete pozrieť nižšie.</div>' : ""}${hasOrder ? '<div class="saved-banner">' + icons.check + "<div><strong>Vaša objednávka je uložená.</strong><span>" + (open ? "Do uzavretia ponuky môžete počty upraviť a znovu uložiť." : "Ďakujeme. Tešíme sa na vás pri odbere.") + "</span></div></div>" : ""}<div class="order-layout"><section aria-label="Ponuka chleba a pečiva"><div class="catalog-heading"><h2>Čo si dáte tento týždeň?</h2><button class="text-button" id="refresh-offer">Obnoviť dostupnosť ↻</button></div><div class="product-list">${offer.items
    .map((p, index) => {
      const own =
        offer.ownItems.find((item) => item.id === p.id)?.quantity || 0;
      const max = p.available + own;
      return `<article class="product-card"><div class="product-art variation-${index % 3}" aria-hidden="true"><img src="/bread.svg" alt=""></div><div class="product-info"><span class="product-tag">${p.available > 0 ? `Zostáva ${p.available} ks` : "Vypredané"}${own ? ` · Pre vás ${own} ks` : ""}</span><h3>${esc(p.name)}</h3><p>${esc(p.description) || "Domáce pečenie od Iky."}</p><div class="product-bottom"><strong>${euro(p.price)} <small>/ ks</small></strong><div class="stepper"><button data-adjust="${p.id}" data-delta="-1" aria-label="Odobrať kus: ${esc(p.name)}" ${!open ? "disabled" : ""}>−</button><input type="number" id="qty-${p.id}" data-quantity="${p.id}" aria-label="Počet kusov: ${esc(p.name)}" min="0" max="${max}" step="1" value="${state.quantities[p.id] || 0}" ${!open ? "disabled" : ""}><button data-adjust="${p.id}" data-delta="1" aria-label="Pridať kus: ${esc(p.name)}" ${!open || !max ? "disabled" : ""}>+</button></div></div></div></article>`;
    })
    .join(
      "",
    )}</div><p class="catalog-note">${icons.wheat} Ponuka a dostupné počty sa každý týždeň menia. Popisy a informácie o alergénoch uvádza Ika pri výrobkoch.</p></section><aside class="order-summary" aria-label="Vaša objednávka"><div class="summary-heading">${icons.bag}<h2>Vaša objednávka</h2></div><div id="summary-items"></div><div class="summary-total"><span>Spolu</span><strong id="summary-total">0,00 €</strong></div><p class="summary-note">Bez platby online. Ide o rezerváciu pečiva na ${esc(dateLabel(offer.date))}.</p>${state.member ? `<div class="order-person"><span>OBJEDNÁVATE ZA SEBA</span><strong>${esc(state.member.name)}</strong><small>${esc(state.member.phone)}</small></div>` : '<p class="login-note">Na uloženie objednávky sa prihláste. Účet si vytvoríte iba raz.</p>'}<button class="button wide" id="save-order" ${!open ? "disabled" : ""}>${state.member ? (hasOrder ? "Uložiť zmeny objednávky" : "Uložiť moju objednávku") : "Prihlásiť a objednať"} ${icons.arrow}</button>${hasOrder && open ? '<button class="text-button cancel-order" id="cancel-order">Zrušiť moju objednávku</button>' : ""}<div class="form-error" id="order-error" role="alert"></div><div class="summary-trust">${icons.check} Ukladajú sa iba vaše vlastné objednávky.</div></aside></div>${steps()}</main>${footer()}<dialog id="auth-dialog" class="modal"></dialog><dialog id="confirm-dialog" class="modal compact"></dialog>`;
  bindCommon();
  updateSummary();
  document.querySelectorAll("[data-adjust]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = document.querySelector("#qty-" + button.dataset.adjust);
      input.value = Math.max(
        0,
        Math.min(
          Number(input.max),
          Number(input.value) + Number(button.dataset.delta),
        ),
      );
      state.quantities[button.dataset.adjust] = Number(input.value);
      updateSummary();
    }),
  );
  document.querySelectorAll("[data-quantity]").forEach((input) =>
    input.addEventListener("input", () => {
      input.value = Math.max(
        0,
        Math.min(Number(input.max), Math.floor(Number(input.value) || 0)),
      );
      state.quantities[input.dataset.quantity] = Number(input.value);
      updateSummary();
    }),
  );
  document
    .querySelector("#refresh-offer")
    .addEventListener("click", async () => {
      try {
        const selected = { ...state.quantities };
        await loadOffer();
        state.quantities = selected;
        renderOffer();
        toast("Dostupnosť je aktualizovaná.");
      } catch (error) {
        toast(error.message, true);
      }
    });
  document.querySelector("#save-order").addEventListener("click", saveOrder);
  document.querySelector("#cancel-order")?.addEventListener("click", () =>
    confirmAction(
      "Zrušiť vašu objednávku?",
      "Všetky vaše rezervované kusy sa vrátia do ponuky.",
      async () => {
        state.quantities = {};
        await saveOrder();
      },
      "Áno, zrušiť objednávku",
    ),
  );
}
function updateSummary() {
  const selected = state.offer.items.filter(
    (p) => (state.quantities[p.id] || 0) > 0,
  );
  document.querySelector("#summary-items").innerHTML = selected.length
    ? selected
        .map(
          (p) =>
            `<div class="summary-item"><span><strong>${esc(p.name)}</strong><small>${state.quantities[p.id]} ks × ${euro(p.price)}</small></span><b>${euro(p.price * state.quantities[p.id])}</b></div>`,
        )
        .join("")
    : '<div class="summary-empty">Váš výber sa objaví tu.<br>Pridajte si niečo dobré.</div>';
  document.querySelector("#summary-total").textContent = euro(
    selected.reduce((sum, p) => sum + p.price * state.quantities[p.id], 0),
  );
  const button = document.querySelector("#save-order");
  if (state.member && state.offer.status === "published")
    button.disabled = !selected.length && !state.offer.ownItems.length;
}
async function saveOrder() {
  if (!state.member) return showAuth("login");
  const button = document.querySelector("#save-order");
  button.disabled = true;
  const errorBox = document.querySelector("#order-error");
  errorBox.textContent = "";
  try {
    const items = state.offer.items
      .filter((p) => (state.quantities[p.id] || 0) > 0)
      .map((p) => ({ id: p.id, quantity: state.quantities[p.id] }));
    const result = await api("/offers/" + slug + "/order", {
      method: "PUT",
      body: { items },
    });
    state.offer = result.offer;
    state.quantities = Object.fromEntries(
      result.offer.ownItems.map((item) => [item.id, item.quantity]),
    );
    renderOffer();
    toast(
      items.length
        ? "Objednávka je uložená. Ďakujeme!"
        : "Objednávka bola zrušená.",
    );
  } catch (error) {
    if (error.status === 401) {
      state.member = null;
      renderOffer();
      showAuth("login");
      toast("Prihlásenie vypršalo. Prihláste sa znova.", true);
    } else {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  }
}
function showAuth(mode) {
  state.authMode = mode;
  const dialog = document.querySelector("#auth-dialog");
  const register = mode === "register";
  dialog.innerHTML = `<button class="modal-close" aria-label="Zavrieť">×</button><span class="eyebrow">VITAJTE PRI NAŠOM STOLE</span><h2>${register ? "Váš vlastný účet" : "Radi vás vidíme znova."}</h2><p>${register ? "Účet si vytvoríte raz. Každý ďalší týždeň už len vyberiete svoje chlebíky." : "Prihláste sa telefónnym číslom a heslom. Objednávať môžete len za seba."}</p><div class="auth-tabs"><button data-mode="login" class="${!register ? "active" : ""}">Prihlásenie</button><button data-mode="register" class="${register ? "active" : ""}">Nový účet</button></div><form id="auth-form">${register ? '<label>Vaše meno a priezvisko<input name="name" autocomplete="name" minlength="2" maxlength="100" placeholder="Ako vás Ika pozná" required></label>' : ""}<label>Telefónne číslo<input type="tel" name="phone" autocomplete="tel" placeholder="+421 900 123 456" minlength="7" maxlength="25" required></label><label>Heslo<input type="password" name="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="8" maxlength="128" placeholder="Aspoň 8 znakov" required></label>${register ? '<label class="checkbox"><input type="checkbox" name="consent" required><span>Rozumiem, že Ika uvidí moje meno, telefón a objednávky na zabezpečenie odberu. Heslo sa ukladá iba v zabezpečenej podobe.</span></label>' : '<p class="muted small-text">Zabudli ste heslo? Ozvite sa Ike v skupine. Môže vám nastaviť nové.</p>'}<div class="form-error" id="auth-error" role="alert"></div><button class="button wide" type="submit">${register ? "Vytvoriť môj účet" : "Prihlásiť sa"} ${icons.arrow}</button></form>`;
  dialog
    .querySelector(".modal-close")
    .addEventListener("click", () => dialog.close());
  dialog
    .querySelectorAll("[data-mode]")
    .forEach((button) =>
      button.addEventListener("click", () => showAuth(button.dataset.mode)),
    );
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      body.consent = body.consent === "on";
      if (register) body.offerSlug = slug;
      const result = await api(register ? "/register" : "/login", {
        method: "POST",
        body,
      });
      state.member = result.member;
      const quantities = { ...state.quantities };
      await loadOffer();
      state.quantities = Object.keys(quantities).some(
        (id) => quantities[id] > 0,
      )
        ? quantities
        : state.quantities;
      dialog.close();
      renderOffer();
      toast("Ste prihlásení. Teraz môžete uložiť svoj výber.");
    } catch (error) {
      dialog.querySelector("#auth-error").textContent = error.message;
      button.disabled = false;
    }
  });
  if (!dialog.open) dialog.showModal();
}
function confirmAction(title, description, action, label = "Potvrdiť") {
  const dialog = document.querySelector("#confirm-dialog");
  dialog.innerHTML = `<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="form-error" role="alert"></div><div class="dialog-actions"><button class="button secondary" data-no>Späť</button><button class="button" data-yes>${esc(label)}</button></div>`;
  dialog.querySelector("[data-no]").onclick = () => dialog.close();
  dialog.querySelector("[data-yes]").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      await action();
      if (dialog.isConnected) dialog.close();
    } catch (error) {
      dialog.querySelector(".form-error").textContent = error.message;
      event.currentTarget.disabled = false;
    }
  };
  dialog.showModal();
}

function adminLogin() {
  app.innerHTML = `${header()}<main class="admin-login"><div class="login-illustration"><img src="/bread.svg" alt="Ilustrácia domáceho chleba"><span class="eyebrow">VŠETKO PRE VAŠE PEČENIE</span><h1>Ahoj, Ika.</h1><p>Jedna ponuka, jeden odkaz.<br>A všetky objednávky pekne spolu.</p></div><form id="admin-login" class="login-panel"><span class="eyebrow">VSTUP LEN PRE VÁS</span><h2>Správa ponúk</h2><p>Prístupový kľúč chráni vašu ponuku a údaje zákazníkov.</p><label>Váš prístupový kľúč<input type="password" name="key" autocomplete="current-password" required minlength="16" placeholder="Zadajte prístupový kľúč"></label><div id="admin-error" class="form-error" role="alert"></div><button class="button wide">Otvoriť správu ${icons.arrow}</button><p class="small-text muted">Prístupový kľúč je pri prvom nastavení webu vygenerovaný pre Iku. Nezdieľajte ho v skupine.</p></form></main>${footer()}`;
  document.querySelector("#admin-login").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    state.adminKey = new FormData(event.currentTarget).get("key").trim();
    try {
      await loadDashboard();
      renderAdmin();
    } catch (error) {
      document.querySelector("#admin-error").textContent = error.message;
      state.adminKey = "";
      button.disabled = false;
    }
  };
}
async function loadDashboard() {
  const data = await api("/admin/dashboard", { admin: true });
  state.offers = data.offers;
  if (!state.offers.some((o) => o.id === state.selected))
    state.selected = state.offers[0]?.id || null;
}
const selectedOffer = () => state.offers.find((o) => o.id === state.selected);
function renderAdmin() {
  const offer = selectedOffer();
  const sold = offer?.items.reduce((sum, p) => sum + p.sold, 0) || 0;
  const stock = offer?.items.reduce((sum, p) => sum + p.stock, 0) || 0;
  app.innerHTML = `${header()}<main class="admin-page"><div class="page-intro"><div><span class="eyebrow">VAŠE PEČENIE POD KONTROLOU</span><h1>Ahoj, Ika. Čo napečieme?</h1><p>Pripravte ponuku, zdieľajte odkaz a sledujte objednávky.</p></div><button class="button" id="new-offer">+ Nová ponuka</button></div><div class="admin-toolbar"><label class="offer-select">Ponuka<select id="offer-select" ${!state.offers.length ? "disabled" : ""}>${state.offers.length ? state.offers.map((o) => `<option value="${o.id}" ${o.id === state.selected ? "selected" : ""}>${esc(o.title)} · ${esc(o.date)} · ${statusLabel(o.status)}</option>`).join("") : "<option>Zatiaľ žiadna ponuka</option>"}</select></label><div class="toolbar-actions"><button class="text-button" id="members-button">Členovia a heslá</button><button class="text-button" id="refresh-admin">Obnoviť ↻</button><button class="text-button" id="admin-logout">Odhlásiť</button></div></div>${offer ? `<section class="admin-offer"><div class="offer-title-row"><div><span class="status ${offer.status}">${statusLabel(offer.status)}</span><h2>${esc(offer.title)}</h2><p>Odber: ${esc(dateLabel(offer.date))}</p></div><div class="toolbar-actions">${offer.status === "draft" ? '<button class="button secondary" id="edit-offer">Upraviť ponuku</button><button class="button" id="publish-offer">Zverejniť a získať odkaz ' + icons.arrow + "</button>" : `<button class="button secondary" id="copy-offer">Použiť na ďalší týždeň</button>${offer.status === "published" ? '<button class="button secondary" id="close-offer">Uzavrieť objednávanie</button>' : ""}`}</div></div>${offer.status !== "draft" ? `<div class="share-panel"><div>${icons.arrow}<div><strong>${offer.status === "published" ? "Odkaz pre WhatsApp skupinu" : "Odkaz na archivovanú ponuku"}</strong><p>${offer.status === "published" ? "Členovia sa cez tento odkaz prihlásia a objednajú. Staršie ponuky sú uzavreté." : "Táto ponuka už neprijíma nové objednávky."}</p></div></div><label class="sr-only" for="share-link">Odkaz na ponuku</label><input id="share-link" readonly value="${esc(location.origin + "/ponuka/" + offer.slug)}"><button class="button secondary" id="copy-link">Kopírovať odkaz</button>${offer.status === "published" ? '<button class="button" id="share-whatsapp">Správa do WhatsApp ${icons.arrow}</button>' : ""}</div>` : '<div class="notice">Toto je rozpracovaná ponuka. Zákazníci ju uvidia až po zverejnení. Skontrolujte názvy, ceny a dostupné počty nižšie.</div>'}<div class="stats"><article><span>Objednávky</span><strong>${offer.orders.length}</strong><small>ľudí si už vybralo</small></article><article><span>Objednané kusy</span><strong>${sold}</strong><small>z ${stock} ponúkaných</small></article><article><span>Zostáva v ponuke</span><strong>${stock - sold}</strong><small>kusov chleba a pečiva</small></article><article><span>Hodnota objednávok</span><strong>${euro(offer.items.reduce((sum, p) => sum + p.sold * p.price, 0))}</strong><small>bez online platieb</small></article></div><section class="table-section"><div class="table-heading"><div><span class="eyebrow">PREHĽAD PEČENIA</span><h2>Čo sa objednalo a čo zostáva</h2></div><button class="text-button" id="export-summary">Stiahnuť CSV ↓</button></div><p class="scroll-hint">Na mobile potiahnite tabuľku do strany →</p><div class="table-scroll" tabindex="0" aria-label="Tabuľka výrobkov"><table><thead><tr><th scope="col">Chlieb / pečivo</th><th scope="col">Cena / ks</th><th scope="col">V ponuke</th><th scope="col">Objednané</th><th scope="col">Zostáva</th><th scope="col">Hodnota</th></tr></thead><tbody>${offer.items.map((p) => `<tr><th scope="row">${esc(p.name)}<span class="table-description">${esc(p.description)}</span></th><td>${euro(p.price)}</td><td>${p.stock} ks</td><td><b>${p.sold} ks</b></td><td><span class="stock-pill ${p.available === 0 ? "empty" : ""}">${p.available} ks</span></td><td>${euro(p.sold * p.price)}</td></tr>`).join("")}</tbody><tfoot><tr><th scope="row">Spolu</th><td>—</td><td>${stock} ks</td><td>${sold} ks</td><td>${stock - sold} ks</td><td>${euro(offer.items.reduce((sum, p) => sum + p.sold * p.price, 0))}</td></tr></tfoot></table></div></section><section class="table-section"><div class="table-heading"><div><span class="eyebrow">PREHĽAD ODBERU</span><h2>Kto si čo objednal</h2></div><div class="toolbar-actions"><button class="text-button" id="print-orders">Vytlačiť</button><button class="text-button" id="export-orders">Stiahnuť CSV ↓</button></div></div><label class="search-label"><span class="sr-only">Hľadať zákazníka</span><input id="order-search" type="search" placeholder="Hľadať podľa mena alebo telefónu…"></label><p class="scroll-hint">Na mobile potiahnite tabuľku do strany →</p><div class="table-scroll" tabindex="0" aria-label="Tabuľka objednávok"><table><thead><tr><th scope="col">Meno</th><th scope="col">Telefón</th>${offer.items.map((p) => `<th scope="col">${esc(p.name)}</th>`).join("")}<th scope="col">Spolu ks</th><th scope="col">Suma</th></tr></thead><tbody id="orders-body">${orderRows(offer)}</tbody></table></div><p class="small-text muted table-footnote">Každý člen má pre túto ponuku jednu objednávku. Úpravou sa nahradí jeho predchádzajúci výber.</p></section></section>` : `<section class="admin-empty"><div class="invitation-icon">${icons.wheat}</div><h2>Prvá ponuka začína tu.</h2><p>Pridajte chlebíky a pečivo, ceny a počet kusov.<br>Potom už len zdieľajte jeden odkaz do skupiny.</p><button class="button" id="first-offer">Vytvoriť prvú ponuku ${icons.arrow}</button></section>`}</main>${footer()}<dialog id="editor-dialog" class="modal editor-modal"></dialog><dialog id="confirm-dialog" class="modal compact"></dialog><dialog id="members-dialog" class="modal members-modal"></dialog><dialog id="share-dialog" class="modal"></dialog>`;
  document.querySelector("#new-offer").onclick = () => showEditor();
  document
    .querySelector("#first-offer")
    ?.addEventListener("click", () => showEditor());
  document.querySelector("#offer-select").onchange = (event) => {
    state.selected = Number(event.target.value);
    renderAdmin();
  };
  document.querySelector("#admin-logout").onclick = () => {
    state.adminKey = "";
    state.offers = [];
    adminLogin();
  };
  document.querySelector("#refresh-admin").onclick = async () => {
    try {
      await loadDashboard();
      renderAdmin();
      toast("Prehľad je aktuálny.");
    } catch (error) {
      toast(error.message, true);
    }
  };
  document.querySelector("#members-button").onclick = showMembers;
  if (!offer) return;
  document
    .querySelector("#edit-offer")
    ?.addEventListener("click", () => showEditor(offer));
  document
    .querySelector("#copy-offer")
    ?.addEventListener("click", () => showEditor(offer, true));
  document.querySelector("#publish-offer")?.addEventListener("click", () =>
    confirmAction(
      "Zverejniť túto ponuku?",
      "Členovia budú môcť objednávať. Predchádzajúca otvorená ponuka sa uzavrie. Ceny a počty tejto ponuky sa po zverejnení uzamknú.",
      async () => {
        await api(`/admin/offers/${offer.id}/publish`, {
          method: "POST",
          body: {},
          admin: true,
        });
        await loadDashboard();
        renderAdmin();
        toast("Ponuka je zverejnená. Odkaz je pripravený pre skupinu.");
      },
      "Zverejniť ponuku",
    ),
  );
  document.querySelector("#close-offer")?.addEventListener("click", () =>
    confirmAction(
      "Uzavrieť objednávanie?",
      "Členovia už nebudú môcť meniť objednávky. Prehľady zostanú zachované.",
      async () => {
        await api(`/admin/offers/${offer.id}/close`, {
          method: "POST",
          body: {},
          admin: true,
        });
        await loadDashboard();
        renderAdmin();
        toast("Objednávanie je uzavreté.");
      },
      "Uzavrieť ponuku",
    ),
  );
  document.querySelector("#copy-link")?.addEventListener("click", async () => {
    const input = document.querySelector("#share-link");
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Odkaz je skopírovaný. Vložte ho do skupiny.");
    } catch {
      input.select();
      toast("Odkaz je označený. Skopírujte ho ručne.");
    }
  });
  document
    .querySelector("#share-whatsapp")
    ?.addEventListener("click", () => showShare(offer));
  document.querySelector("#order-search").oninput = (event) => {
    document.querySelector("#orders-body").innerHTML = orderRows(
      offer,
      event.target.value,
    );
  };
  document.querySelector("#print-orders").onclick = () => window.print();
  document.querySelector("#export-summary").onclick = () =>
    downloadCsv("prehlad-pecenia-" + offer.date, [
      [
        "Výrobok",
        "Cena / ks (€)",
        "Ponuka ks",
        "Objednané ks",
        "Zostáva ks",
        "Hodnota (€)",
      ],
      ...offer.items.map((p) => [
        p.name,
        (p.price / 100).toFixed(2),
        p.stock,
        p.sold,
        p.available,
        ((p.price * p.sold) / 100).toFixed(2),
      ]),
    ]);
  document.querySelector("#export-orders").onclick = () =>
    downloadCsv("objednavky-" + offer.date, [
      [
        "Meno",
        "Telefón",
        ...offer.items.map((p) => p.name),
        "Spolu ks",
        "Suma (€)",
      ],
      ...offer.orders.map((o) => [
        o.name,
        o.phone,
        ...offer.items.map(
          (p) => o.items.find((i) => i.id === p.id)?.quantity || 0,
        ),
        o.items.reduce((sum, p) => sum + p.quantity, 0),
        (orderTotal(o, offer) / 100).toFixed(2),
      ]),
    ]);
}
function orderTotal(order, offer) {
  return order.items.reduce(
    (sum, item) =>
      sum +
      item.quantity * (offer.items.find((p) => p.id === item.id)?.price || 0),
    0,
  );
}
function orderRows(offer, search = "") {
  const orders = offer.orders.filter((o) =>
    (o.name + " " + o.phone)
      .toLocaleLowerCase("sk")
      .includes(search.toLocaleLowerCase("sk")),
  );
  return orders.length
    ? orders
        .map(
          (o) =>
            `<tr><th scope="row">${esc(o.name)}</th><td>${esc(o.phone)}</td>${offer.items.map((p) => `<td class="quantity-cell">${o.items.find((i) => i.id === p.id)?.quantity || "—"}</td>`).join("")}<td><b>${o.items.reduce((sum, p) => sum + p.quantity, 0)}</b></td><td>${euro(orderTotal(o, offer))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="${offer.items.length + 4}" class="empty-cell">${search ? "Žiadna objednávka nezodpovedá hľadaniu." : "Zatiaľ žiadne objednávky. Po zverejnení pošlite odkaz do skupiny."}</td></tr>`;
}
function nextWednesday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((p) => p.type === type).value;
  const d = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  const offset = (3 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function editorRow(item = {}, index = 0) {
  return `<fieldset class="editor-row"><legend>Výrobok ${index + 1}</legend><div class="editor-product-header"><strong>Chlieb alebo pečivo</strong><button type="button" class="text-button remove-product" aria-label="Odstrániť výrobok ${index + 1}">Odstrániť ×</button></div><label>Názov<input name="product-name" value="${esc(item.name)}" placeholder="Napr. Pšenično-ražný chlebík" minlength="2" maxlength="100" required></label><label>Popis, zloženie a alergény<textarea name="description" rows="2" maxlength="1500" placeholder="Čo by mali zákazníci vedieť…">${esc(item.description)}</textarea></label><div class="form-columns"><label>Cena za kus (€)<input name="price" type="number" min="0.01" max="1000" step="0.01" value="${item.price ? (item.price / 100).toFixed(2) : ""}" placeholder="5,50" required></label><label>Počet kusov v ponuke<input name="stock" type="number" min="1" max="10000" step="1" value="${item.stock || ""}" placeholder="20" required></label></div></fieldset>`;
}
function showEditor(offer = null, copy = false) {
  const edit = !!offer && !copy;
  const dialog = document.querySelector("#editor-dialog");
  dialog.innerHTML = `<button class="modal-close" aria-label="Zavrieť">×</button><span class="eyebrow">PRÍPRAVA TÝŽDENNEJ PONUKY</span><h2>${edit ? "Upraviť ponuku" : copy ? "Ponuka na ďalší týždeň" : "Čo bude voňať v stredu?"}</h2><p>${copy ? "Výrobky sme skopírovali. Upravte dátum, ceny a počty podľa nového pečenia." : "Vyplňte výrobky a dostupné počty. Najprv sa uloží rozpracovaná ponuka."}</p><form id="offer-form"><div class="form-columns"><label>Názov ponuky<input name="title" value="${esc(edit ? offer.title : "Stredajšie pečenie")}" minlength="2" maxlength="100" required></label><label>Dátum odberu<input name="date" type="date" value="${edit ? offer.date : nextWednesday()}" required></label></div><div id="editor-products">${(offer?.items || [{}]).map(editorRow).join("")}</div><button class="button secondary wide" type="button" id="add-product">+ Pridať chlieb alebo pečivo</button><div class="form-error" id="editor-error" role="alert"></div><div class="editor-footer"><button type="button" class="button secondary" id="discard-editor">Späť</button><button class="button" type="submit">Uložiť rozpracovanú ponuku ${icons.check}</button></div></form>`;
  const closeEditor = () => {
    if (dialog.dataset.dirty === "true") {
      if (!window.confirm("Zavrieť bez uloženia zmien?")) return;
    }
    dialog.close();
  };
  dialog.dataset.dirty = "false";
  dialog.querySelector("form").oninput = () => {
    dialog.dataset.dirty = "true";
  };
  dialog.oncancel = (event) => {
    event.preventDefault();
    closeEditor();
  };
  dialog.querySelector(".modal-close").onclick = closeEditor;
  dialog.querySelector("#discard-editor").onclick = closeEditor;
  const bindRemove = () =>
    dialog.querySelectorAll(".remove-product").forEach(
      (button) =>
        (button.onclick = () => {
          if (dialog.querySelectorAll(".editor-row").length === 1)
            return toast("Ponuka musí mať aspoň jeden výrobok.", true);
          button.closest(".editor-row").remove();
          dialog.dataset.dirty = "true";
        }),
    );
  bindRemove();
  dialog.querySelector("#add-product").onclick = () => {
    const count = dialog.querySelectorAll(".editor-row").length;
    if (count >= 40) return toast("Najviac 40 výrobkov v jednej ponuke.", true);
    dialog
      .querySelector("#editor-products")
      .insertAdjacentHTML("beforeend", editorRow({}, count));
    bindRemove();
    dialog.dataset.dirty = "true";
    dialog.querySelector(".editor-row:last-child input").focus();
  };
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("[type=submit]");
    button.disabled = true;
    const data = new FormData(event.currentTarget);
    const items = [...dialog.querySelectorAll(".editor-row")].map((row) => ({
      name: row.querySelector("[name=product-name]").value,
      description: row.querySelector("[name=description]").value,
      price: Math.round(Number(row.querySelector("[name=price]").value) * 100),
      stock: Number(row.querySelector("[name=stock]").value),
    }));
    try {
      const result = await api(
        edit ? `/admin/offers/${offer.id}` : "/admin/offers",
        {
          method: edit ? "PUT" : "POST",
          admin: true,
          body: { title: data.get("title"), date: data.get("date"), items },
        },
      );
      state.selected = edit ? offer.id : result.id;
      dialog.dataset.dirty = "false";
      dialog.close();
      await loadDashboard();
      renderAdmin();
      toast("Rozpracovaná ponuka je uložená. Teraz ju môžete zverejniť.");
    } catch (error) {
      dialog.querySelector("#editor-error").textContent = error.message;
      button.disabled = false;
    }
  };
  dialog.showModal();
}
function downloadCsv(name, rows) {
  const csv =
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const raw = String(value);
            const safe = /^[=+@\-\t\r\n]/.test(raw) ? "'" + raw : raw;
            return '"' + safe.replace(/"/g, '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showShare(offer) {
  const message = `Ahojte! 🍞 Ponuka Chlebíky od Iky na ${dateLabel(offer.date)} je pripravená. Vyberte si chlebík alebo pečivo a uložte svoju objednávku tu:\n${location.origin}/ponuka/${offer.slug}\nPočet kusov je obmedzený. Teším sa na vás! Ika`;
  const dialog = document.querySelector("#share-dialog");
  dialog.innerHTML = `<button class="modal-close" aria-label="Zavrieť">×</button><span class="eyebrow">HOTOVÁ SPRÁVA PRE SKUPINU</span><h2>Už len poslať.</h2><p>Správu skopírujte do svojej skupiny alebo otvorte WhatsApp a vyberte skupinu Chlebíky od Iky.</p><label for="whatsapp-message">Správa</label><textarea rows="7" id="whatsapp-message" readonly>${esc(message)}</textarea><div class="dialog-actions"><button class="button secondary" id="copy-message">Kopírovať správu</button><a class="button" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Otvoriť WhatsApp ${icons.arrow}</a></div>`;
  dialog.querySelector(".modal-close").onclick = () => dialog.close();
  dialog.querySelector("#copy-message").onclick = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast("Správa je skopírovaná.");
    } catch {
      dialog.querySelector("textarea").select();
      toast("Správu skopírujte ručne.");
    }
  };
  dialog.showModal();
}
async function showMembers() {
  try {
    const { members } = await api("/admin/members", { admin: true });
    state.members = members;
    const dialog = document.querySelector("#members-dialog");
    dialog.innerHTML = `<button class="modal-close" aria-label="Zavrieť">×</button><span class="eyebrow">NAŠA MALÁ KOMUNITA</span><h2>Členovia a prístup</h2><p>Ak člen zabudne heslo, overte si jeho totožnosť priamo v skupine a nastavte mu nové. Všetky jeho predchádzajúce prihlásenia sa zrušia.</p><div class="table-scroll"><table><thead><tr><th>Meno</th><th>Telefón</th><th>Prístup</th></tr></thead><tbody>${members.map((m) => `<tr><th>${esc(m.name)}</th><td>${esc(m.phone)}</td><td><button class="text-button" data-reset="${m.id}">Nové heslo</button></td></tr>`).join("") || '<tr><td colspan="3">Zatiaľ žiadni členovia.</td></tr>'}</tbody></table></div><form id="reset-form" hidden><h3 id="reset-name"></h3><input type="hidden" name="memberId"><label>Nové heslo<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><p class="small-text muted">Nové heslo odovzdajte iba tomuto členovi cez súkromnú správu.</p><div class="form-error" role="alert"></div><button class="button">Nastaviť nové heslo</button></form>`;
    dialog.querySelector(".modal-close").onclick = () => dialog.close();
    dialog.querySelectorAll("[data-reset]").forEach(
      (button) =>
        (button.onclick = () => {
          const form = dialog.querySelector("#reset-form");
          form.hidden = false;
          form.reset();
          form.querySelector("[name=memberId]").value = button.dataset.reset;
          dialog.querySelector("#reset-name").textContent =
            "Nové heslo pre " +
            members.find((m) => m.id === Number(button.dataset.reset)).name;
          form.querySelector("[name=password]").focus();
        }),
    );
    dialog.querySelector("#reset-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      button.disabled = true;
      const data = new FormData(form);
      try {
        await api("/admin/members/" + data.get("memberId") + "/password", {
          method: "POST",
          admin: true,
          body: { password: data.get("password") },
        });
        form.reset();
        form.hidden = true;
        toast("Heslo je zmenené. Odovzdajte ho súkromne členovi.");
      } catch (error) {
        form.querySelector(".form-error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    dialog.showModal();
  } catch (error) {
    toast(error.message, true);
  }
}

async function start() {
  app.innerHTML =
    '<main class="loading" role="status">Chlebíky od Iky <span>Pripravujeme váš stôl…</span></main>';
  try {
    if (adminPage) return adminLogin();
    state.member = (await api("/session")).member;
    if (slug) {
      await loadOffer();
      renderOffer();
      polling = setInterval(async () => {
        if (document.hidden || document.querySelector("dialog[open]")) return;
        try {
          const { offer } = await api("/offers/" + slug);
          if (JSON.stringify(offer) !== JSON.stringify(state.offer)) {
            const quantities = { ...state.quantities };
            state.offer = offer;
            state.quantities = quantities;
            const focused = document.activeElement?.id;
            renderOffer();
            if (focused) document.getElementById(focused)?.focus();
          }
        } catch {
          /* Ručné obnovenie ukáže prípadnú chybu pripojenia. */
        }
      }, 20000);
    } else home();
  } catch (error) {
    app.innerHTML = `${header()}<main class="error-page"><span class="eyebrow">CHLEBÍKY OD IKY</span><h1>Táto ponuka sa nedá otvoriť.</h1><p>${esc(error.message)}</p><p>Skontrolujte odkaz vo WhatsApp skupine alebo to skúste znova.</p><button class="button" id="retry">Skúsiť znova</button></main>${footer()}`;
    document.querySelector("#retry").onclick = start;
  }
}
window.addEventListener("pagehide", () => clearInterval(polling));
start();
