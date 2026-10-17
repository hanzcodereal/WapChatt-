const $ = (s) => document.querySelector(s);
const getToken = () => localStorage.getItem("nova_token");

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (getToken()) headers.Authorization = "Bearer " + getToken();
  const res = await fetch("/api" + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 && data.banned) {  // akun diblokir owner: keluar dan tampilkan alasannya di halaman masuk
      localStorage.removeItem("nova_token"); try { sessionStorage.setItem("nova_notice", data.error); } catch {}
      if (!/login/.test(location.pathname)) location.href = "login.html";
    }
    throw new Error(data.error || "Terjadi kesalahan");
  }
  return data;
}

function logout() {
  localStorage.removeItem("nova_token");
  location.href = "login.html";
}

/* ---------- Login / Register ---------- */
function initLogin() {
  if (getToken()) { location.href = "dashboard.html"; return; }
  const msg = $("#msg");
  try { const note = sessionStorage.getItem("nova_notice"); if (note) { msg.textContent = note; sessionStorage.removeItem("nova_notice"); } } catch {}
  const lv = $("#lv");
  if (lv) { if (matchMedia("(prefers-reduced-motion: reduce)").matches) lv.pause(); else lv.play().catch(() => {}); }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $("#login-form").hidden = t.dataset.tab !== "login";
      $("#register-form").hidden = t.dataset.tab !== "register";
      msg.textContent = "";
    })
  );
  const submit = (form, path) =>
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true; msg.textContent = "";
      try {
        const body = Object.fromEntries(new FormData(form));
        const data = await api(path, { method: "POST", body: JSON.stringify(body) });
        localStorage.setItem("nova_token", data.token);
        location.href = "dashboard.html";
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    });
  submit($("#login-form"), "/login");
  submit($("#register-form"), "/register");
}

/* ---------- Dashboard: chat, grup, saluran, story, panggilan, profil ---------- */
async function initDashboard() {
  if (!getToken()) return logout();
  let me;
  try { me = (await api("/me")).user; } catch { return logout(); }
  const st = { contacts: [], rooms: [], stories: [], calls: [], cur: null, unread: {}, last: {}, lastT: {}, seen: {}, filter: "all", tab: "home", byId: {}, reply: null, mem: {}, memTry: {}, memList: [], cs: {}, blocked: new Set() };
  const mk = (tag, txt, cls) => { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; };
  const hue = (n) => [...n].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
  const av = (n, img) => { const e = mk("div", img ? "" : (n[0] || "?").toUpperCase(), "av"); e.style.background = img ? "url(" + img + ") center/cover" : "hsl(" + hue(n) + ",85%,78%)"; return e; };
  const toast = (msg) => {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = mk("div", msg, "toast"); t.setAttribute("role", "status"); document.body.append(t);
    setTimeout(() => t.remove(), 3600);
  };
  const X = {};  // fitur dari extras.js (foto/video, sematan pesan, bintang); diisi sebelum dashboard ditampilkan
  const STK = /^(?:\[re:\d+\])?\[stk:([0-9a-f]{24})\]$/;  // stiker, boleh sebagai balasan
  const stkId = (b) => { const m = STK.exec(b || ""); return m && m[1]; };
  const RE = /^\[re:(\d+)\]([\s\S]*)$/;
  const FWD = /^\[fwd\]([\s\S]*)$/, STR = /^\[st:([^\]]*)\]([\s\S]*)$/;  // diteruskan / balasan untuk status
  const parseRe = (b) => {
    let m = RE.exec(b || ""); if (m) return { id: +m[1], text: m[2] };
    if ((m = FWD.exec(b || ""))) return { id: 0, text: m[1], fwd: true };
    if ((m = STR.exec(b || ""))) return { id: 0, text: m[2], st: m[1] };
    return { id: 0, text: b || "" };
  };
  const plain = (t) => t.replace(/@\[([^|\]]+)\|([^\]]*)\]/g, "@$2");  // @[ID|Nama] -> @Nama
  const lastText = (b) => (X.preview && X.preview(b)) || (stkId(b) ? "Stiker" : plain(parseRe(b).text));
  const sha24 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
  /* Kotak dialog bergaya WapChatt, pengganti prompt() bawaan browser. Hasil: objek isian, atau null kalau dibatalkan. */
  function dialog({ title, desc, fields = [], contacts = null, contactsLabel = "", ok = "Simpan", actions = [] }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const back = mk("div", null, "dlg-back"), box = mk("div", null, "dlg"), form = mk("form");
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "dlg-t");
      const h = mk("h2", title); h.id = "dlg-t"; form.append(h);
      if (desc) form.append(mk("p", desc, "dlg-d"));
      actions.forEach((a) => { const b = mk("button", a.label, "btn full" + (a.danger ? "" : " ghost")); b.type = "button"; b.onclick = () => done({ action: a.key }); form.append(b); });
      const els = {};
      fields.forEach((f) => {
        const lab = mk("label"), inp = mk(f.multiline ? "textarea" : "input");
        inp.value = f.value || ""; inp.placeholder = f.placeholder || ""; inp.autocomplete = "off";
        if (f.max) inp.maxLength = f.max;
        if (f.multiline) inp.rows = 4;
        if (f.inputmode) inp.inputMode = f.inputmode;
        if (f.type) inp.type = f.type;
        lab.append(mk("span", f.label), inp);
        if (f.multiline && f.max) { const c = mk("small", inp.value.length + "/" + f.max, "dlg-c"); inp.addEventListener("input", () => (c.textContent = inp.value.length + "/" + f.max)); lab.append(c); }
        form.append(lab); els[f.name] = inp;
      });
      const checks = [];
      if (contacts) {
        form.append(mk("span", contactsLabel || "Tambah anggota dari teman tersimpan", "dlg-l"));
        if (!contacts.length) form.append(mk("p", "Belum ada teman tersimpan. Simpan ID teman dulu, atau isi ID lain di atas.", "dlg-d"));
        else {
          const list = mk("div", null, "dlg-pick");
          contacts.forEach((c) => { const l = mk("label", null, "pk"), cb = mk("input"); cb.type = "checkbox"; cb.value = c.player_id; checks.push(cb); l.append(cb, av(c.full_name, c.avatar), mk("span", c.full_name)); list.append(l); });
          form.append(list);
        }
      }
      const err = mk("p", "", "dlg-e"); err.setAttribute("role", "alert"); form.append(err);
      const row = mk("div", null, "dlg-b"), no = mk("button", "Batal", "btn ghost"), yes = mk("button", ok, "btn");
      no.type = "button"; yes.type = "submit"; if (ok === null) { no.textContent = "Tutup"; row.append(no); } else row.append(no, yes); form.append(row);
      box.append(form); back.append(box); document.body.append(back);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); back.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done(null); }
        if (e.key === "Tab") {
          const f = [...box.querySelectorAll("input,textarea,button")], a = f[0], z = f[f.length - 1];
          if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
          else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
        }
      };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      back.addEventListener("pointerdown", (e) => { if (e.target === back) done(null); });
      form.onsubmit = (e) => {
        e.preventDefault();
        const out = {};
        for (const f of fields) {
          out[f.name] = els[f.name].value.trim();
          if (f.required && !out[f.name]) { err.textContent = f.label + " wajib diisi."; els[f.name].focus(); return; }
        }
        out.members = checks.filter((c) => c.checked).map((c) => c.value);
        done(out);
      };
      const first = form.querySelector("input,textarea,button"); if (first) first.focus();
    });
  }
  const isRoom = (p) => p.startsWith("R-");
  const roomOf = (p) => st.rooms.find((r) => "R-" + r.id === p);
  const contact = (p) => st.contacts.find((c) => c.player_id === p);
  const saved = (p) => !!contact(p);
  const OFFICIAL = "NOVA";
  const nameOf = (p) => (p === me.player_id ? me.full_name : p === OFFICIAL ? "WapChatt" : isRoom(p) ? (roomOf(p) || { name: "Grup" }).name : (contact(p) || { full_name: p }).full_name);
  const imgOf = (p) => (p === me.player_id ? me.avatar : p === OFFICIAL ? "logo.png" : isRoom(p) ? (roomOf(p) || {}).avatar : (contact(p) || {}).avatar);
  const fmt = (t) => new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const NS = "http://www.w3.org/2000/svg";
  const ic = (n, cls) => { const s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use"); s.setAttribute("class", "ic" + (cls ? " " + cls : "")); u.setAttribute("href", "#i-" + n); s.append(u); return s; };
  const tm = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const short = (t) => (new Date(t).toDateString() === new Date().toDateString() ? tm(t) : new Date(t).toLocaleDateString([], { day: "numeric", month: "short" }));
  const hasStory = (p) => st.stories.some((s) => s.owner === p);
  const send = (to, kind, body) => api("/send", { method: "POST", body: JSON.stringify({ to, kind, body }) });
  const chAv = (k) => { const e = mk("div", null, "av ico " + k); e.append(ic(k === "group" ? "users" : "channel")); return e; };
  const row = (img, name, sub, onclick, o = {}) => {
    const li = mk("li", null, "item"), box = mk("div", null, "txt"), w = mk("div", null, "avw");
    const nb = mk("b", name);
    if (o.verified) nb.append(ic("seal"));
    if (o.tag) nb.append(mk("i", o.tag, "own"));
    box.append(nb, mk("small", sub));
    w.append(o.avEl || av(name, img));
    if (o.online) w.append(mk("i", null, "on-dot"));
    li.append(w, box);
    if (o.time || o.badge || o.icon) {
      const m = mk("div", null, "meta");
      if (o.time) m.append(mk("span", o.time));
      if (o.icon) m.append(o.icon);
      if (o.badge) {
        const n = typeof o.badge === "number", b = mk("i", n ? (o.badge > 99 ? "99+" : String(o.badge)) : o.badge, "dot" + (n ? " cnt" : ""));
        if (n) { b.setAttribute("aria-label", o.badge + " pesan belum dibaca"); li.classList.add("unread"); }
        m.append(b);
      }
      li.append(m);
    }
    li.tabIndex = 0; li.onclick = onclick; li.onkeydown = (e) => e.key === "Enter" && onclick();
    return li;
  };
  const resize = (file, max, q, lim) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); let out = c.toDataURL("image/jpeg", q); while (lim && out.length > lim && q > 0.25) { q -= 0.1; out = c.toDataURL("image/jpeg", q); } res(out); };
    im.src = URL.createObjectURL(file);
  });
  const pick = (max, q, lim) => new Promise((res) => { const f = $("#pick"); f.value = ""; f.onchange = () => f.files[0] && resize(f.files[0], max, q, lim).then(res); f.click(); });

  const SCREENS = ["home", "upd", "calls", "profile", "room", "explore", "admin"];
  const loaders = { upd: () => { loadStories(); loadRooms(); }, calls: loadCalls, explore: loadRooms, admin: () => { $("#abanner").value = me.announce || ""; loadAdmin(); } };
  const TITLES = { home: "WapChatt", upd: "Pembaruan", calls: "Panggilan", profile: "Profil", explore: "Cari Saluran", admin: "Panel Owner" };
  function show(id) {
    st.screen = id; if (id !== "room" && id !== "explore" && id !== "admin") st.tab = id;
    SCREENS.forEach((s) => ($("#" + s).hidden = s !== id));
    if (TITLES[id]) {
      $("#htitle").textContent = TITLES[id]; $("#top").classList.toggle("c", id !== "home");
      $("#clock").hidden = id !== "home"; $("#hback").hidden = !["explore", "admin"].includes(id); $("#hnew").hidden = id !== "upd";
    }
    $("#fab").hidden = !["home", "upd"].includes(id); $("#fabt").hidden = id !== "upd";
    $(".nav").hidden = id === "room" || id === "explore";
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.s === (id === "explore" ? "upd" : id === "admin" ? "profile" : id)));
    if (loaders[id]) loaders[id]();
    render();
  }
  function render() {
    const q = $("#search").value.trim().toLowerCase();
    const ring = (el, on) => { const g = mk("div", null, "rg" + (on ? " on" : "")); g.append(el); return g; };
    const mine = mk("button", null, "story plus");
    mine.append(ring(av(me.full_name, me.avatar), hasStory(me.player_id)), mk("span", "Story saya"));
    mine.onclick = () => (hasStory(me.player_id) ? viewStories(me.player_id) : storyText());
    $("#stories").replaceChildren(mine, ...st.contacts.map((c) => {
      const b = mk("button", null, "story");
      b.append(ring(av(c.full_name, c.avatar), hasStory(c.player_id)), mk("span", c.full_name));
      b.onclick = () => (hasStory(c.player_id) ? viewStories(c.player_id) : open(c.player_id));
      return b;
    }));
    const E = st.contacts.map((c) => ({ p: c.player_id, n: c.full_name, i: c.avatar, k: "dm", v: c.verified, tag: c.owner ? "OWNER" : "" }));
    st.rooms.filter((r) => r.kind === "group").forEach((r) => E.push({ p: "R-" + r.id, n: r.name, k: r.kind, i: r.avatar, v: !!r.verified }));
    E.push({ p: me.player_id, n: me.player_id + " (Anda)", i: me.avatar, k: "dm", sub: "Kirim pesan ke diri sendiri" });
    Object.keys(st.last).forEach((k) => { if (!isRoom(k) && !saved(k) && k !== me.player_id) E.push({ p: k, n: nameOf(k), i: imgOf(k), k: "dm", v: k === OFFICIAL, tag: k === OFFICIAL ? "RESMI" : "" }); });
    const flt = { all: () => true, unread: (e) => (st.unread[e.p] || 0) > 0, fav: (e) => isPinned(e.p), group: (e) => e.k === "group" };
    document.querySelectorAll("#chips button").forEach((b) => {  // jumlah di Belum dibaca, Favorit, Grup
      const n = flt[b.dataset.f] && b.dataset.f !== "all" ? E.filter(flt[b.dataset.f]).length : 0, cn = b.querySelector(".cn");
      if (cn) { cn.hidden = !n; cn.textContent = n; }
    });
    const F = E.filter((e) => (flt[st.filter] || flt.all)(e) && (e.n + e.p).toLowerCase().includes(q))
      .sort((a, b) => (isPinned(b.p) - isPinned(a.p)) || ((Date.parse(st.lastT[b.p]) || 0) - (Date.parse(st.lastT[a.p]) || 0)));
    $("#empty-list").hidden = F.length > 0;
    $("#empty-list").textContent = E.length ? "Tidak ada chat yang cocok." : "Belum ada chat. Tap + lalu masukkan ID temanmu untuk menyimpannya.";
    $("#list").replaceChildren(...F.map((e) => row(e.i, e.n, e.sub || lastText(st.last[e.p]) || (e.k === "dm" ? e.p : e.k === "group" ? "Grup" : "Saluran"), () => open(e.p),
      { time: st.lastT[e.p] ? short(st.lastT[e.p]) : "", badge: st.unread[e.p] || "", verified: e.v, tag: e.tag, avEl: e.k === "dm" || e.i ? null : chAv(e.k), online: e.k === "dm" && !!(st.seen[e.p] && st.seen[e.p].online) })));
    [...$("#list").children].forEach((li, i) => { if (F[i] && isPinned(F[i].p)) { li.classList.add("pinned"); li.append(mk("small", "Disematkan", "pinmark")); } });

    /* lingkaran di navigasi: Chat = jumlah pesan belum dibaca (tanpa saluran), Pembaruan = titik tanpa angka */
    const setNb = (id, n, num, name) => {
      const el = $(id), b = el.closest("button"); el.hidden = !n; if (num) el.textContent = n > 99 ? "99+" : n;
      b.setAttribute("aria-label", name + (n ? (num ? ", " + n + " pesan belum dibaca" : ", ada pembaruan baru") : ""));
    };
    const chatUnread = Object.entries(st.unread).reduce((s, [k, v]) => s + (v > 0 && !(isRoom(k) && (roomOf(k) || {}).kind === "channel") ? v : 0), 0);
    setNb("#nbchat", chatUnread, true, "Chat");
    setNb("#nbupd", st.stories.some((s) => s.owner !== me.player_id && !s.seen) || st.rooms.some((r) => r.kind === "channel" && r.joined && !r.is_admin && (st.unread["R-" + r.id] || 0) > 0) ? 1 : 0, false, "Pembaruan");

    /* Pembaruan: kartu status */
    const card = (o, label, onclick) => {
      const l = st.stories.filter((s) => s.owner === o), s = l[l.length - 1], b = mk("button", null, "sc");
      if (!s) b.classList.add("empty");
      else if (s.kind === "img") b.style.backgroundImage = 'url("' + s.body + '")';
      else { b.style.background = "linear-gradient(160deg,hsl(" + hue(s.body) + ",85%,62%),hsl(" + ((hue(s.body) + 50) % 360) + ",80%,48%))"; b.append(mk("p", s.body, "sct")); }
      b.append(av(nameOf(o), imgOf(o)), mk("span", label, "scn"));
      b.onclick = onclick;
      return b;
    };
    const others = [...new Set(st.stories.map((s) => s.owner))].filter((o) => o !== me.player_id);
    $("#sgrid").replaceChildren(card(me.player_id, "Status saya", () => (hasStory(me.player_id) ? viewStories(me.player_id) : storyText())), ...others.map((o) => card(o, nameOf(o), () => viewStories(o))));

    /* Saluran */
    const chs = st.rooms.filter((r) => r.kind === "channel");
    const chRow = (r) => row(r.avatar || null, r.name, (r.joined && st.last["R-" + r.id] ? lastText(st.last["R-" + r.id]) : r.count + " pengikut" + (r.about ? " · " + r.about : "")), () => (r.joined ? open("R-" + r.id) : joinCh(r.id)),
      { time: r.joined && st.lastT["R-" + r.id] ? short(st.lastT["R-" + r.id]) : "", verified: r.verified, avEl: r.avatar ? null : chAv("channel"), tag: r.is_admin ? "ADMIN" : "", badge: r.joined && !r.is_admin ? st.unread["R-" + r.id] || "" : "", icon: r.joined ? null : ic("plus", "pbtn") });
    const mineCh = chs.filter((r) => r.joined).sort((a, b) => (Date.parse(st.lastT["R-" + b.id]) || 0) - (Date.parse(st.lastT["R-" + a.id]) || 0)), finds = chs.filter((r) => !r.joined);
    $("#mych").replaceChildren(...mineCh.map(chRow));
    $("#find-h").hidden = !finds.length;
    $("#finds").replaceChildren(...finds.slice(0, 5).map(chRow));
    const xq = $("#xsearch").value.trim().toLowerCase(), X = chs.filter((r) => r.name.toLowerCase().includes(xq));
    $("#xlist").replaceChildren(...X.map(chRow));
    $("#empty-x").hidden = X.length > 0;

    const ST = { answered: "Terjawab", missed: "Tidak terjawab", rejected: "Ditolak" };
    const dur = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = (n) => String(n).padStart(2, "0"); return h ? h + ":" + p(m) + ":" + p(x) : p(m) + ":" + p(x); };  // lama panggilan
    $("#calllist").replaceChildren(...st.calls.map((c) => row(imgOf(c.peer), nameOf(c.peer), (c.out ? "Keluar" : "Masuk") + " · " + (c.video ? "Video" : "Suara") + " · " + ST[c.status] + (c.status === "answered" && c.secs != null ? " · " + dur(c.secs) : ""), () => open(c.peer), { time: short(c.t), icon: ic(c.video ? "video" : "phone", c.status !== "answered" && !c.out ? "miss" : "") })));
    $("#empty-calls").hidden = st.calls.length > 0;
    $("#callclear").hidden = !st.calls.length;
    [...$("#calllist").children].forEach((li, i) => {
      const c = st.calls[i]; if (!c || !c.id) return;
      const x = mk("button", "\u00d7", "callx"); x.type = "button"; x.setAttribute("aria-label", "Hapus log panggilan");
      x.onclick = (e) => { e.stopPropagation(); hideCalls([c.id]); }; x.onkeydown = (e) => e.stopPropagation();
      li.append(x);
    });
    $("#pav").replaceChildren(av(me.full_name, me.avatar));
    $("#pname").textContent = me.full_name; $("#pstat").textContent = me.status || "Belum ada bio";
    $("#pid").textContent = me.player_id;
    $("#pcover").style.backgroundImage = me.cover ? 'url("' + me.cover + '")' : "";
    $("#pver").toggleAttribute("hidden", !me.verified); $("#pown").hidden = !me.owner; $("#admbtn").hidden = $("#owlab").hidden = !me.is_owner; $("#pvb").toggleAttribute("hidden", !me.verified); $("#copysub").textContent = me.player_id;
    $("#swpub").setAttribute("aria-checked", String(me.public !== false)); $("#swseen").setAttribute("aria-checked", String(me.show_seen !== false));
  }
  async function loadContacts() { st.contacts = (await api("/contacts")).contacts; render(); }
  async function loadStories() { try { st.stories = (await api("/stories")).stories; render(); } catch {} }
  async function loadCalls() { try { st.calls = (await api("/calls")).calls; render(); } catch {} }
  async function loadChats() {
    try {
      (await api("/chats")).chats.forEach((c) => {
        if (c.key === me.player_id || (st.lastT[c.key] && Date.parse(st.lastT[c.key]) > Date.parse(c.t))) return;
        st.last[c.key] = c.body; st.lastT[c.key] = c.t;
      });
      render();
    } catch {}
  }
  async function loadPresence() {
    try {
      const r = await api("/presence"); st.seen = r.presence;
      if (r.announce && r.announce !== me.announce) { me.announce = r.announce; $("#annt").textContent = $("#annt2").textContent = r.announce; }
      refreshTicks(); roomSub(); render();
    } catch {}
  }
  async function loadRooms() { try { st.rooms = (await api("/rooms")).rooms; render(); } catch {} }
  const joinCh = (id) => api("/rooms/" + id + "/join", { method: "POST" }).then(loadRooms);
  $("#search").oninput = render;
  document.querySelectorAll("#chips button").forEach((b) => (b.onclick = () => {
    st.filter = b.dataset.f;
    document.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  }));
  const clock = () => ($("#clock span").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }));
  clock(); setInterval(clock, 1000);
  $("#annt").textContent = $("#annt2").textContent = me.announce || "Selamat datang di WapChatt";
  document.querySelectorAll(".nav button").forEach((b) => (b.onclick = () => show(b.dataset.s)));
  $("#logout").onclick = logout;
  $("#copy").onclick = () => navigator.clipboard.writeText(me.player_id).then(() => ($("#copysub").textContent = "Tersalin"));

  const tick = (m) => {
    if (m.pending) return ic("clock", "tk");
    if (isRoom(m.to)) return ic("check", "tk");
    if (m.to === me.player_id) return ic("check2", "tk seen");   // chat ke diri sendiri: langsung dua centang biru
    const cs = st.cs[m.to] || {};
    if (cs.blocked) return ic("check", "tk");                     // diblokir (oleh kontak atau owner): satu centang
    const replied = !!m.id && (cs.last || 0) > m.id;              // sudah dibalas: dua centang biru
    return ic("check2", "tk " + (replied ? "seen" : "dlv"));      // belum dibalas: dua centang putih
  };
  function refreshTicks() {
    document.querySelectorAll("#msgs .bub.out").forEach((d) => { const t = d.querySelector(".tk"); if (t) t.replaceWith(tick({ to: d.dataset.to, t: d.dataset.t, id: +d.dataset.mid || 0 })); });
  }
  function roomSub() {
    if (!st.cur || isRoom(st.cur)) return;
    if (st.cur === me.player_id) { $("#rid").className = ""; $("#rid").textContent = "Kirim pesan ke diri sendiri"; return; }
    if (st.cur === OFFICIAL) { $("#rid").className = ""; $("#rid").textContent = "Akun resmi · hanya pengumuman"; return; }
    const s = st.seen[st.cur], el = $("#rid");
    el.className = s && s.online ? "on" : "";
    el.textContent = s ? (s.online ? "online" : "terakhir dilihat " + fmt(s.seen)) : st.cur;
  }
  const quote = (id) => {
    const o = st.byId[id], q = mk("div", null, "quote");
    q.append(mk("b", o ? (o.sender === me.player_id ? "Kamu" : nameOf(o.sender)) : "Pesan"), mk("span", o ? lastText(o.body).slice(0, 80) : "Pesan tidak ditemukan"));
    q.onclick = () => { const t = document.querySelector('#msgs .bub[data-mid="' + id + '"]'); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1200); } };
    return q;
  };
  function startReply(id) {
    const o = st.byId[id]; if (!o) return;
    st.reply = id;
    $("#rpname").textContent = o.sender === me.player_id ? "Kamu" : nameOf(o.sender);
    $("#rptext").textContent = lastText(o.body).slice(0, 80);
    $("#replybar").hidden = false; $("#text").focus();
  }
  const stopReply = () => { st.reply = null; $("#replybar").hidden = true; };
  $("#rpx").onclick = stopReply;
  /* anggota grup: foto profil + nama untuk pengirim yang belum disimpan sebagai kontak */
  const gName = (p) => (p === me.player_id ? me.full_name : contact(p) ? contact(p).full_name : (st.mem[p] && st.mem[p].full_name) || p);
  const gImg = (p) => (p === me.player_id ? me.avatar : (contact(p) && contact(p).avatar) || (st.mem[p] && st.mem[p].avatar) || "");
  function paintMem() {
    document.querySelectorAll("#msgs .gav").forEach((a) => { const p = a.dataset.pid, n = gName(p), i = gImg(p); a.textContent = i ? "" : (n[0] || "?").toUpperCase(); a.style.background = i ? "url(" + i + ") center/cover" : "hsl(" + hue(n) + ",85%,78%)"; });
    document.querySelectorAll("#msgs .who").forEach((w) => { if (w.dataset.pid) w.textContent = gName(w.dataset.pid); });
  }
  async function loadMem(r) {
    st.memBusy = true;
    try { st.memList = (await api("/rooms/" + r.id + "/members")).members; st.memList.forEach((x) => (st.mem[x.player_id] = { full_name: x.full_name, avatar: x.avatar })); paintMem(); } catch {}
    st.memBusy = false;
  }
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
  const dayLabel = (t) => {  // Hari ini / Kemarin / tanggal lengkap
    const n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); const k = dayKey(t);
    return k === dayKey(n) ? "Hari ini" : k === dayKey(y) ? "Kemarin" : new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  };
  function addMsg(m) {
    if (m.t && dayKey(m.t) !== st.day) {
      st.day = dayKey(m.t);
      const s = mk("div", dayLabel(m.t), "dsep"); s.setAttribute("role", "separator"); $("#msgs").append(s);
    }
    const mine = m.sender === me.player_id, key = isRoom(m.to) || mine ? m.to : m.sender;
    st.last[key] = m.body; st.lastT[key] = m.t;
    const r = roomOf(st.cur || ""), sid = stkId(m.body), d = mk("div", null, "bub " + (mine ? "out" : "in") + (sid && !parseRe(m.body).id ? " sticker" : "")), box = mk("div"), mt = mk("div", null, "mt");
    const grp = !mine && r && r.kind === "group";
    if (grp) {
      if (!st.mem[m.sender] && !contact(m.sender) && !st.memBusy && !st.memTry[m.sender]) { st.memTry[m.sender] = 1; loadMem(r); }  // anggota baru: muat ulang daftar
      const w = mk("small", gName(m.sender), "who"); w.dataset.pid = m.sender; w.style.cursor = "pointer"; w.onclick = () => showProfile(m.sender); box.append(w);
    }
    const rp = parseRe(m.body);
    if (m.id) st.byId[m.id] = m;
    d.dataset.mid = m.id || "";
    if (sid) { if (rp.id) box.append(quote(rp.id)); const im = mk("img", null, "smsg"); im.src = m.local || "/api/stickers/" + sid; im.alt = "Stiker"; box.append(im); }
    else if (X.fill && X.fill(box, m, d)) { /* polling / pertanyaan */ }
    else {
      if (rp.fwd) box.append(mk("small", "Diteruskan", "fwdl"));
      if (rp.st != null) box.append(mk("small", "Membalas status" + (rp.st ? ": " + rp.st : ""), "stq"));
      if (rp.id) box.append(quote(rp.id));
      box.append(X.rich ? X.rich(rp.text, d) : mk("span", rp.text));
    }
    if (X.menuBtn) X.menuBtn(mt, d, m, mine, sid);  // Balas, bintang, sematkan, salin, hapus: semuanya di titik tiga
    mt.append(mk("time", tm(m.t)));
    if (mine) { d.dataset.to = m.to; d.dataset.t = m.t; mt.append(tick(m)); }
    d.append(box, mt);
    if (grp) {  // pesan grup dari orang lain: foto profil di samping gelembung
      const a = av(gName(m.sender), gImg(m.sender)), wrap = mk("div", null, "grow");
      a.classList.add("gav"); a.dataset.pid = m.sender; a.title = gName(m.sender); a.onclick = () => showProfile(m.sender);
      wrap.append(a, d); $("#msgs").append(wrap);
    } else $("#msgs").append(d);
    $("#msgs").scrollTop = 1e9;
    return d;
  }
  async function open(p) {
    st.cur = p; st.unread[p] = 0;
    if (X.opened) X.opened();
    if (X.markRead) X.markRead(p);
    const r = roomOf(p);
    $("#rtitle").textContent = p === me.player_id ? me.player_id + " (Anda)" : nameOf(p);
    const ct = contact(p); if (ct && ct.owner) $("#rtitle").append(mk("i", "OWNER", "own")); if (p === OFFICIAL) $("#rtitle").append(mk("i", "RESMI", "own"));
    if (r && r.kind === "channel" && r.verified) $("#rtitle").append(ic("seal"));
    $("#rav").replaceChildren(av(nameOf(p), imgOf(p)));
    $("#rid").className = ""; $("#rid").textContent = r ? (r.kind === "group" ? "Grup" : "Saluran · " + r.count + " pengikut") : p === me.player_id ? "Kirim pesan ke diri sendiri" : p;
    roomSub(); $("#tray").hidden = true;
    $("#vbtn").hidden = $("#abtn").hidden = !!r || p === OFFICIAL || p === me.player_id;
    $("#form").hidden = (!!r && r.kind === "channel" && !r.is_admin) || p === OFFICIAL;
    st.byId = {}; st.day = ""; stopReply(); $("#msgs").replaceChildren(); show("room");
    st.memList = [];
    const memP = r && r.kind === "group" ? loadMem(r) : null;
    (await api("/history?peer=" + encodeURIComponent(p))).messages.forEach(addMsg);
    if (memP) await memP;
    if (X.historyLoaded) X.historyLoaded();
    render();
  }
  $("#back").onclick = () => { st.cur = null; show(st.tab); };
  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const t0 = X.encodeMentions ? X.encodeMentions($("#text").value.trim()) : $("#text").value.trim();
    if (!t0 || !st.cur) return;
    const v = st.reply ? "[re:" + st.reply + "]" + t0 : t0;
    $("#text").value = ""; upd(); stopReply();
    const to = st.cur, el = addMsg({ sender: me.player_id, to, kind: "text", body: v, t: new Date().toISOString(), pending: true });
    try {
      const m = await send(to, "text", v);
      st.last[to] = m.body; st.lastT[to] = m.t; el.dataset.t = m.t; el.dataset.mid = m.id; st.byId[m.id] = m;
      el.querySelector("time").textContent = tm(m.t); el.querySelector(".tk").replaceWith(tick(m)); render();
    } catch (err) { el.querySelector(".tk").replaceWith(ic("x", "tk fail")); toast("Pesan gagal terkirim: " + err.message); }
  };
  const upd = () => { const has = $("#text").value.trim().length > 0; $("#sendb").hidden = !has; $("#mic").hidden = has; };
  $("#text").oninput = upd;
  const EMO = "😀😃😄😁😆😅😂🤣🙂😉😊😇🥰😍😘😋😎🤩🥳😏😒😞😔😢😭😤😠🤯😱😳🤔🙄😴🤒🤢🙏👍👎👏🙌💪👀🔥✨🎉💯❤️💔💙💚💛🧡💜🖤".match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu) || [];
  let trayTab = "emoji";
  const UPK = "nova_stk_up";
  const upGet = () => { try { return new Set(JSON.parse(localStorage.getItem(UPK) || "[]")); } catch { return new Set(); } };
  async function ensureSticker(src, force) {  // unggah stiker ke server sekali saja (id = hash isinya)
    const id = await sha24(src), up = upGet();
    if (force || !up.has(id)) {
      await api("/stickers", { method: "POST", body: JSON.stringify({ data: src }) });
      up.add(id); try { localStorage.setItem(UPK, JSON.stringify([...up].slice(-300))); } catch {}
    }
    return id;
  }
  async function sendSticker(src) {
    if (!st.cur) return;
    const to = st.cur; $("#tray").hidden = true;
    let id; try { id = await sha24(src); } catch { return toast("Browser ini belum mendukung kirim stiker."); }
    const body = (st.reply ? "[re:" + st.reply + "]" : "") + "[stk:" + id + "]";  // stiker bisa dikirim sebagai balasan
    stopReply();
    const el = addMsg({ sender: me.player_id, to, kind: "text", body, local: src, t: new Date().toISOString(), pending: true });
    try {
      await ensureSticker(src);
      let m;
      try { m = await send(to, "text", body); }
      catch (e) { if (!/Stiker/.test(e.message)) throw e; await ensureSticker(src, true); m = await send(to, "text", body); }
      st.last[to] = m.body; st.lastT[to] = m.t; el.dataset.t = m.t; el.dataset.mid = m.id; st.byId[m.id] = m;
      el.querySelector("time").textContent = tm(m.t); el.querySelector(".tk").replaceWith(tick(m)); render();
    } catch (err) { el.querySelector(".tk").replaceWith(ic("x", "tk fail")); toast("Stiker gagal terkirim: " + err.message); }
  }
  function renderPanel() {
    const t = $("#tray"), tabs = mk("div", null, "tp-tabs"), tg = mk("div", null, trayTab === "emoji" ? "emo" : "sc-grid");
    [["emoji", "😀 Emoji"], ["stiker", "Stiker"]].forEach(([k, label]) => {
      const b = mk("button", label, "pill" + (trayTab === k ? " on" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(trayTab === k));
      b.onclick = () => { trayTab = k; renderPanel(); }; tabs.append(b);
    });
    if (trayTab === "emoji") EMO.forEach((em) => { const b = mk("button", em); b.type = "button"; b.setAttribute("aria-label", "Emoji " + em); b.onclick = () => { $("#text").value += em; upd(); $("#text").focus(); }; tg.append(b); });
    else {
      const nb = mk("button", null, "cell addn"); nb.type = "button"; nb.append(ic("edit"), mk("span", "Buat stiker"));
      nb.onclick = async () => { await stickerMaker(); renderPanel(); };
      tg.append(nb);
      mySt().forEach((src, i) => {
        const cell = mk("div", null, "cell"), b = mk("button"), im = mk("img"); b.type = "button"; b.setAttribute("aria-label", "Kirim stiker " + (i + 1)); im.src = src; im.alt = ""; b.append(im); b.onclick = () => sendSticker(src);
        const x = mk("button", "×", "rm"); x.type = "button"; x.setAttribute("aria-label", "Hapus stiker " + (i + 1));
        x.onclick = () => { const a = mySt(); a.splice(i, 1); saveMySt(a); renderPanel(); };
        cell.append(b, x); tg.append(cell);
      });
    }
    t.replaceChildren(tabs, tg);
    if (trayTab === "stiker" && !mySt().length) t.append(mk("p", "Belum ada stiker. Tap Buat stiker untuk membuatnya dari fotomu.", "hint"));
  }
  $("#plus").onclick = () => { const t = $("#tray"); t.hidden = !t.hidden; if (!t.hidden) renderPanel(); };
  async function saveId(id) {
    try {
      await api("/contacts", { method: "POST", body: JSON.stringify({ player_id: id }) });
      await loadContacts();
      if (st.cur) { $("#rtitle").textContent = nameOf(st.cur); }
    } catch (e) { toast(e.message); }
  }
  $("#menubtn").onclick = () => chatMenu();
  async function mkRoom(body) { try { await api("/rooms", { method: "POST", body: JSON.stringify(body) }); loadRooms(); } catch (e) { toast(e.message); } }
  $("#newgrp").onclick = async () => {
    const r = await dialog({ title: "Buat grup", fields: [
      { name: "name", label: "Nama grup", placeholder: "Contoh: Squad Mabar", max: 60, required: true },
      { name: "extra", label: "ID lain (opsional, pisah koma)", placeholder: "48210377, 63915204", inputmode: "numeric" }], contacts: st.contacts, ok: "Buat grup" });
    if (!r) return;
    const members = [...new Set([...r.members, ...r.extra.split(",").map((x) => x.trim()).filter(Boolean)])];
    mkRoom({ kind: "group", name: r.name, members });
  };
  const newChannel = async () => {
    const r = await dialog({ title: "Buat saluran", desc: "Hanya kamu yang bisa posting. Orang lain mengikuti dan membaca.", fields: [
      { name: "name", label: "Nama saluran", max: 60, required: true },
      { name: "about", label: "Deskripsi singkat (opsional)", max: 200 }], ok: "Buat saluran" });
    if (r) mkRoom({ kind: "channel", name: r.name, about: r.about });
  };
  $("#fab").onclick = () => ({
    home: async () => {
      const r = await dialog({ title: "Simpan ID teman", desc: "Masukkan ID angka temanmu. Setelah disimpan, dia tampil dengan namanya.", fields: [
        { name: "id", label: "ID teman", placeholder: "contoh 48210377", inputmode: "numeric", max: 12, required: true }], ok: "Simpan" });
      if (r) saveId(r.id);
    },
    upd: () => storyImg(),
  }[st.tab] || (() => {}))();
  $("#fabt").onclick = () => storyText();
  $("#hnew").onclick = () => newChannel();
  $("#newch-btn").onclick = () => newChannel();
  $("#hback").onclick = () => show(st.screen === "admin" ? "profile" : "upd");
  $("#explore-btn").onclick = () => show("explore");
  $("#xsearch").oninput = render;

  /* ----- story ----- */
  const postStory = (kind, body) => api("/stories", { method: "POST", body: JSON.stringify({ kind, body }) }).then(loadStories).catch((e) => toast(e.message));
  const storyText = async () => {
    const r = await dialog({ title: "Tulis story", desc: "Hilang otomatis setelah 24 jam.", fields: [{ name: "t", label: "Isi story", multiline: true, max: 300, required: true }], ok: "Posting" });
    if (r) postStory("text", r.t);
  };
  const storyImg = async () => {
    const photo = await pick(720, 0.85);
    const out = await storyComposer(photo);
    if (out) postStory("img", out);
  };

  /* ----- penyusun story foto: caption + stiker ----- */
  const svgS = (inner) => "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 120 120" stroke="#111" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">' + inner + "</svg>");
  const TX = (t, y, sz, fill, len) => '<text x="60" y="' + y + '" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="' + sz + '" text-anchor="middle" fill="' + fill + '" stroke="none" textLength="' + len + '" lengthAdjust="spacingAndGlyphs">' + t + "</text>";
  const BUILTIN = [
    ['Hati', '<path d="M60 104C20 74 10 48 28 32C42 20 56 28 60 40C64 28 78 20 92 32C110 48 100 74 60 104Z" fill="#FF4757"/><path d="M34 40c4-6 10-6 14-2" fill="none" stroke="#fff" stroke-width="5"/>'],
    ['Bintang', '<polygon points="60,10 74,44 110,46 82,68 92,104 60,84 28,104 38,68 10,46 46,44" fill="#FFD93D"/>'],
    ['Api', '<path d="M60 8C64 34 92 46 92 74C92 94 78 108 60 108C42 108 28 94 28 74C28 58 38 52 42 40C48 50 54 50 56 44C58 32 58 20 60 8Z" fill="#FF8A1F"/><path d="M60 62C66 74 76 78 76 90C76 99 69 104 60 104C51 104 44 99 44 90C44 80 56 74 60 62Z" fill="#FFD93D" stroke-width="4"/>'],
    ['Petir', '<polygon points="70,8 24,68 54,68 44,112 96,46 66,46" fill="#FFD93D"/>'],
    ['Mahkota', '<path d="M16 92L12 38L40 60L60 22L80 60L108 38L104 92Z" fill="#FFD93D"/><circle cx="60" cy="74" r="6" fill="#FF4757" stroke-width="4"/>'],
    ['Keren', '<circle cx="60" cy="60" r="48" fill="#FFD93D"/><rect x="22" y="44" width="34" height="22" rx="6" fill="#111"/><rect x="64" y="44" width="34" height="22" rx="6" fill="#111"/><path d="M38 82q22 18 44 0" fill="none"/>'],
    ['Sedih', '<circle cx="60" cy="60" r="48" fill="#7CC6FF"/><circle cx="42" cy="52" r="5" fill="#111"/><circle cx="78" cy="52" r="5" fill="#111"/><path d="M40 90q20-18 40 0" fill="none"/><path d="M84 62q8 12 0 20q-8-8 0-20Z" fill="#fff" stroke-width="4"/>'],
    ['Oke', '<circle cx="60" cy="60" r="48" fill="#2ED573"/><path d="M34 62l18 18 34-38" fill="none" stroke="#111" stroke-width="20"/><path d="M34 62l18 18 34-38" fill="none" stroke="#fff" stroke-width="10"/>'],
    ['WKWK', '<path d="M14 24Q14 12 26 12H94Q106 12 106 24V68Q106 80 94 80H62L40 106L44 80H26Q14 80 14 68Z" fill="#fff"/>' + TX("WKWK", 58, 26, "#FF4757", 76)],
    ['MANTAP', '<rect x="6" y="36" width="108" height="48" rx="8" fill="#FFD93D"/>' + TX("MANTAP", 70, 24, "#111", 92)],
    ['GAS', '<polygon points="60,6 72,26 96,18 92,42 114,54 92,66 98,92 72,86 60,110 48,86 22,92 28,66 6,54 28,42 24,18 48,26" fill="#FF4757"/>' + TX("GAS!", 68, 28, "#fff", 56)],
    ['WapChatt', '<rect x="6" y="34" width="108" height="52" rx="10" fill="#111"/>' + TX("WapChatt", 68, 26, "#FFD93D", 92)],
    ['SIAP', '<rect x="6" y="36" width="108" height="48" rx="8" fill="#fff"/>' + TX("SIAP", 70, 28, "#111", 72)],
    ['KUY', '<rect x="14" y="34" width="92" height="52" rx="26" fill="#FF8AD8"/>' + TX("KUY", 70, 28, "#111", 52)],
    ['Kilau', '<path d="M60 8Q64 52 112 60Q64 68 60 112Q56 68 8 60Q56 52 60 8Z" fill="#7CF2FF"/>'],
  ].map(([name, inner]) => ({ name, src: svgS(inner) }));
  const SK = "nova_stickers";
  const mySt = () => { try { return JSON.parse(localStorage.getItem(SK) || "[]"); } catch { return []; } };
  const saveMySt = (a) => { try { localStorage.setItem(SK, JSON.stringify(a.slice(0, 30))); return true; } catch { toast("Penyimpanan penuh. Hapus stiker lama dulu."); return false; } };
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const pickFile = () => new Promise((res) => { const f = $("#pick"); f.value = ""; f.onchange = () => f.files[0] && res(f.files[0]); f.click(); });
  const exportJpg = (c, lim) => {
    let q = 0.85, out = c.toDataURL("image/jpeg", q);
    while (out.length > lim && c.width > 200) {
      if (q > 0.4) q -= 0.1;
      else { const n = document.createElement("canvas"); n.width = Math.round(c.width * 0.85); n.height = Math.round(c.height * 0.85); n.getContext("2d").drawImage(c, 0, 0, n.width, n.height); c = n; q = 0.7; }
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  async function stickerMaker() {
    const file = await pickFile(), url = URL.createObjectURL(file); let im;
    try { im = await loadImg(url); } catch { URL.revokeObjectURL(url); toast("Gambar tidak bisa dibuka."); return null; }
    URL.revokeObjectURL(url);
    return new Promise((resolve) => {
      const prev = document.activeElement; let shape = "square", border = true, zoom = 1, ox = 0, oy = 0;
      const back = mk("div", null, "sc-back"), box = mk("div", null, "scmp");
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Buat stiker");
      const bar = mk("div", null, "sc-bar"), no = mk("button", null, "hb"), go = mk("button", "Simpan", "btn");
      no.type = go.type = "button"; no.setAttribute("aria-label", "Batal"); no.append(ic("x")); bar.append(no, mk("b", "Buat stiker"), go);
      const wrap = mk("div", null, "sc-wrap"), cv = mk("canvas", null, "mk-cv"); cv.tabIndex = 0; cv.setAttribute("aria-label", "Pratinjau stiker. Geser untuk memosisikan foto."); wrap.append(cv);
      const ctl = mk("div", null, "mk-ctl");
      const zl = mk("label"), zr = mk("input"); zr.type = "range"; zr.min = 1; zr.max = 4; zr.step = 0.05; zr.value = 1; zl.append(mk("span", "Zoom (atau cubit layar)"), zr);
      const row = mk("div", null, "sc-tabs"), bsq = mk("button", "Kotak", "pill on"), bro = mk("button", "Tumpul", "pill"), bci = mk("button", "Bulat", "pill"), bfu = mk("button", "Utuh", "pill"), bbo = mk("button", "Garis putih", "pill on");
      [bsq, bro, bci, bfu, bbo].forEach((b) => (b.type = "button")); bbo.setAttribute("aria-pressed", "true"); row.append(bsq, bro, bci, bfu, bbo);
      const tl = mk("label"), tin = mk("input"), bl = mk("label"), bin = mk("input");
      tin.maxLength = bin.maxLength = 24; tin.autocomplete = bin.autocomplete = "off"; tin.placeholder = bin.placeholder = "Opsional";
      tl.append(mk("span", "Teks atas"), tin); bl.append(mk("span", "Teks bawah"), bin);
      ctl.append(zl, row, tl, bl); box.append(bar, wrap, ctl); back.append(box); document.body.append(back);

      const rr = (g, x, y, w, h, r) => { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
      const dims = (z) => { if (shape !== "full") return [z, z]; const r = im.naturalWidth / im.naturalHeight; return r >= 1 ? [z, Math.max(40, Math.round(z / r))] : [Math.max(40, Math.round(z * r)), z]; };
      const shp = (g, W, H, inset) => {
        g.beginPath();
        if (shape === "circle") g.arc(W / 2, H / 2, Math.min(W, H) / 2 - inset, 0, Math.PI * 2);
        else if (shape === "rounded") rr(g, inset, inset, W - 2 * inset, H - 2 * inset, Math.min(W, H) * 0.14);
        else g.rect(inset, inset, W - 2 * inset, H - 2 * inset);
      };
      const limit = () => {
        const [W, H] = dims(256), ins = border ? 12 : 3, iw = W - 2 * ins, ih = H - 2 * ins, k = Math.max(iw / im.naturalWidth, ih / im.naturalHeight) * zoom;
        const mx = Math.max(0, (im.naturalWidth * k - iw) / 2), my = Math.max(0, (im.naturalHeight * k - ih) / 2);
        ox = clamp(ox, -mx, mx); oy = clamp(oy, -my, my);
      };
      const draw = (c, z) => {
        const k = z / 256, g = c.getContext("2d"), [W, H] = dims(z); c.width = W; c.height = H; g.clearRect(0, 0, W, H);
        const ins = (border ? 12 : 3) * k, inner = W - 2 * ins, innerH = H - 2 * ins;
        if (border) { shp(g, W, H, 3 * k); g.fillStyle = "#fff"; g.fill(); }
        g.save(); shp(g, W, H, ins); g.clip();
        const sc = Math.max(inner / im.naturalWidth, innerH / im.naturalHeight) * zoom, w = im.naturalWidth * sc, h = im.naturalHeight * sc;
        g.drawImage(im, W / 2 - w / 2 + ox * k, H / 2 - h / 2 + oy * k, w, h); g.restore();
        const txt = (t, top) => {
          if (!t) return; t = t.toUpperCase(); let f = 38 * k; const F = () => (g.font = "900 " + f + 'px Impact,"Arial Black",Arial,sans-serif'); F();
          while (g.measureText(t).width > inner * 0.9 && f > 10) { f -= 2; F(); }
          g.textAlign = "center"; g.textBaseline = top ? "top" : "bottom"; g.lineJoin = "round"; g.lineWidth = Math.max(3, f / 5); g.strokeStyle = "#111"; g.fillStyle = "#fff";
          const y = top ? ins + 8 * k : H - ins - 8 * k; g.strokeText(t, W / 2, y); g.fillText(t, W / 2, y);
        };
        txt(tin.value.trim(), true); txt(bin.value.trim(), false);
      };
      const redraw = () => { limit(); draw(cv, 256); };
      const exportSt = () => {
        const c = document.createElement("canvas"); let z = 256, u = "";
        for (let i = 0; i < 3; i++) { draw(c, z); u = c.toDataURL("image/webp", 0.85); if (!u.startsWith("data:image/webp")) u = c.toDataURL("image/png"); if (u.length <= 100000) break; z = Math.round(z * 0.8); }
        return u;
      };
      redraw();
      const ptr = new Map(), dist = () => { if (ptr.size < 2) return 0; const [a, b] = [...ptr.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }; let pd = 0;
      cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); pd = dist(); };
      cv.onpointermove = (e) => {
        if (!ptr.has(e.pointerId)) return; const old = ptr.get(e.pointerId), f = cv.width / cv.getBoundingClientRect().width; ptr.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptr.size === 1) { ox += (e.clientX - old[0]) * f; oy += (e.clientY - old[1]) * f; }
        else { const d = dist(); if (pd) zoom = clamp(zoom * d / pd, 1, 4); pd = d; zr.value = zoom; }
        redraw();
      };
      cv.onpointerup = cv.onpointercancel = (e) => { ptr.delete(e.pointerId); pd = dist(); };
      cv.onkeydown = (e) => { const m = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key]; if (m) { e.preventDefault(); ox += m[0]; oy += m[1]; redraw(); } };
      zr.oninput = () => { zoom = +zr.value; redraw(); };
      tin.oninput = bin.oninput = redraw;
      const setShape = (v) => { shape = v; bsq.classList.toggle("on", v === "square"); bro.classList.toggle("on", v === "rounded"); bci.classList.toggle("on", v === "circle"); bfu.classList.toggle("on", v === "full"); ox = oy = 0; redraw(); };
      bsq.onclick = () => setShape("square"); bro.onclick = () => setShape("rounded"); bci.onclick = () => setShape("circle"); bfu.onclick = () => setShape("full");
      bbo.onclick = () => { border = !border; bbo.classList.toggle("on", border); bbo.setAttribute("aria-pressed", String(border)); redraw(); };
      const done = (v) => { document.removeEventListener("keydown", onKey, true); back.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done(null); }
        if (e.key === "Tab") {
          const f = [...box.querySelectorAll("button:not([disabled]),input,canvas")], a = f[0], z = f[f.length - 1];
          if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
        }
      };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      go.onclick = () => { const u = exportSt(), a = mySt(); a.unshift(u); if (saveMySt(a)) { toast("Stiker disimpan"); done(u); } };
      cv.focus();
    });
  }

  function storyComposer(photo) {
    return new Promise((resolve) => {
      const prev = document.activeElement, items = []; let sel = null, tab = "builtin";
      const back = mk("div", null, "sc-back"), box = mk("div", null, "scmp");
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Story foto");
      const bar = mk("div", null, "sc-bar"), no = mk("button", null, "hb"), go = mk("button", "Posting", "btn");
      no.type = "button"; no.setAttribute("aria-label", "Batal"); no.append(ic("x")); go.type = "button";
      bar.append(no, mk("b", "Story foto"), go);
      const wrap = mk("div", null, "sc-wrap"), stage = mk("div", null, "sc-stage"), img = mk("img"), cap = mk("div", null, "sc-cap");
      img.src = photo; img.alt = "Foto story"; img.draggable = false; cap.hidden = true;
      stage.append(img, cap); wrap.append(stage);
      const tools = mk("div", null, "sc-tools"), bm = mk("button", "−", "pill"), bp = mk("button", "+", "pill"), bd = mk("button", "Hapus", "pill"), bs = mk("button", "Stiker", "pill on");
      [bm, bp, bd, bs].forEach((b) => (b.type = "button"));
      bm.setAttribute("aria-label", "Kecilkan stiker"); bp.setAttribute("aria-label", "Besarkan stiker"); bd.setAttribute("aria-label", "Hapus stiker terpilih");
      const sp = mk("span", null, "sp"); tools.append(bm, bp, bd, sp, bs);
      const input = mk("input"); input.placeholder = "Tulis caption..."; input.maxLength = 120; input.autocomplete = "off"; input.setAttribute("aria-label", "Caption");
      const capRow = mk("div", null, "sc-capin"); capRow.append(input);
      const tray = mk("div", null, "sc-tray"), tabs = mk("div", null, "sc-tabs"), t1 = mk("button", "Bawaan", "pill on"), t2 = mk("button", "Stiker saya", "pill"), grid = mk("div", null, "sc-grid");
      t1.type = t2.type = "button"; tabs.append(t1, t2); tray.append(tabs, grid);
      box.append(bar, wrap, tools, capRow, tray); back.append(box); document.body.append(back);

      const fit = () => (cap.style.fontSize = stage.clientWidth * 0.055 + "px");
      const ro = window.ResizeObserver ? new ResizeObserver(fit) : null; if (ro) ro.observe(stage); img.onload = fit;
      const place = (it) => { it.el.style.left = it.x * 100 + "%"; it.el.style.top = it.y * 100 + "%"; it.el.style.width = it.w * 100 + "%"; };
      const select = (it) => { sel = it; items.forEach((x) => x.el.classList.toggle("sel", x === it)); bm.disabled = bp.disabled = bd.disabled = !it; };
      const remove = (it) => { it.el.remove(); items.splice(items.indexOf(it), 1); select(null); };
      function add(src) {
        const n = items.length, el = mk("img", null, "stk"), it = { src, x: 0.3 + (n % 5) * 0.1, y: 0.35 + (n % 4) * 0.1, w: 0.3, el };
        el.src = src; el.alt = "Stiker"; el.draggable = false; el.tabIndex = 0;
        let drag = false;
        el.onpointerdown = (e) => { e.preventDefault(); select(it); drag = true; el.setPointerCapture(e.pointerId); };
        el.onpointermove = (e) => { if (!drag) return; const r = stage.getBoundingClientRect(); it.x = clamp((e.clientX - r.left) / r.width, 0, 1); it.y = clamp((e.clientY - r.top) / r.height, 0, 1); place(it); };
        el.onpointerup = el.onpointercancel = () => (drag = false);
        el.onfocus = () => select(it);
        el.onkeydown = (e) => {
          const st = 0.02, m = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
          if (m) { e.preventDefault(); it.x = clamp(it.x + m[0], 0, 1); it.y = clamp(it.y + m[1], 0, 1); place(it); }
          else if (e.key === "+" || e.key === "=") { it.w = clamp(it.w + 0.05, 0.08, 0.9); place(it); }
          else if (e.key === "-") { it.w = clamp(it.w - 0.05, 0.08, 0.9); place(it); }
          else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(it); }
        };
        items.push(it); stage.append(el); place(it); select(it);
      }
      bm.onclick = () => { if (sel) { sel.w = clamp(sel.w - 0.05, 0.08, 0.9); place(sel); } };
      bp.onclick = () => { if (sel) { sel.w = clamp(sel.w + 0.05, 0.08, 0.9); place(sel); } };
      bd.onclick = () => sel && remove(sel);
      stage.addEventListener("pointerdown", (e) => { if (e.target === img) select(null); });
      select(null);

      function renderTray() {
        grid.replaceChildren();
        t1.classList.toggle("on", tab === "builtin"); t2.classList.toggle("on", tab === "mine");
        if (tab === "mine") {
          const addb = mk("button", null, "cell addn"); addb.type = "button"; addb.setAttribute("aria-label", "Tambah stiker dari gambarmu"); addb.append(ic("plus"), mk("span", "Buat"));
          addb.onclick = async () => { if (await stickerMaker()) renderTray(); };
          grid.append(addb);
        }
        const list = tab === "builtin" ? BUILTIN : mySt().map((src, i) => ({ name: "Stiker saya " + (i + 1), src, mine: i }));
        list.forEach((s) => {
          const cell = mk("div", null, "cell"), b = mk("button"); b.type = "button"; b.setAttribute("aria-label", "Tambah stiker " + s.name);
          const im = mk("img"); im.src = s.src; im.alt = ""; b.append(im); b.onclick = () => add(s.src); cell.append(b);
          if (s.mine !== undefined) { const x = mk("button", "×", "rm"); x.type = "button"; x.setAttribute("aria-label", "Hapus " + s.name); x.onclick = () => { const a = mySt(); a.splice(s.mine, 1); saveMySt(a); renderTray(); }; cell.append(x); }
          grid.append(cell);
        });
        if (tab === "mine" && !mySt().length) grid.append(mk("p", "Belum ada stiker. Tap Tambah untuk membuat stiker dari fotomu.", "hint"));
      }
      t1.onclick = () => { tab = "builtin"; renderTray(); };
      t2.onclick = () => { tab = "mine"; renderTray(); };
      bs.onclick = () => { tray.hidden = !tray.hidden; bs.classList.toggle("on", !tray.hidden); };
      renderTray();

      input.oninput = () => { const v = input.value.trim(); cap.textContent = v; cap.hidden = !v; fit(); };
      async function flatten() {
        const base = await loadImg(photo), W = base.naturalWidth, H = base.naturalHeight;
        const c = document.createElement("canvas"); c.width = W; c.height = H;
        const g = c.getContext("2d"); g.drawImage(base, 0, 0);
        for (const it of items) { const im = await loadImg(it.src), w = it.w * W, h = (w * im.naturalHeight) / im.naturalWidth; g.drawImage(im, it.x * W - w / 2, it.y * H - h / 2, w, h); }
        const text = input.value.trim();
        if (text) {
          const f = Math.round(W * 0.055), lh = f * 1.3, lines = []; let cur = "";
          g.font = "700 " + f + 'px "Space Grotesk", Arial, sans-serif';
          text.split(/\s+/).forEach((w) => { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > W * 0.92 && cur) { lines.push(cur); cur = w; } else cur = t; });
          if (cur) lines.push(cur);
          const bh = lines.length * lh + f * 0.8;
          g.fillStyle = "rgba(17,17,17,.75)"; g.fillRect(0, H - bh, W, bh);
          g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
          lines.forEach((l, i) => g.fillText(l, W / 2, H - bh + f * 0.4 + lh * (i + 0.5)));
        }
        return exportJpg(c, 190000);
      }
      const done = (v) => { document.removeEventListener("keydown", onKey, true); if (ro) ro.disconnect(); back.remove(); if (prev && prev.focus) prev.focus(); resolve(v); };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done(null); }
        if (e.key === "Tab") {
          const f = [...box.querySelectorAll("button:not([disabled]),input,img.stk")].filter((x) => !x.closest("[hidden]")), a = f[0], z = f[f.length - 1];
          if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
        }
      };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      go.onclick = async () => { go.disabled = true; go.textContent = "Memproses..."; try { done(await flatten()); } catch { go.disabled = false; go.textContent = "Posting"; toast("Gagal memproses gambar."); } };
      input.focus();
    });
  }
  const seenSt = new Set();
  function sheet(title, build) {
    const back = mk("div", null, "dlg-back"), box = mk("div", null, "dlg sh");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const close = () => { document.removeEventListener("keydown", onKey, true); back.remove(); };
    document.addEventListener("keydown", onKey, true);
    if (title) box.append(mk("h2", title));
    build(box, close);
    const b = mk("button", "Tutup", "btn full ghost"); b.type = "button"; b.onclick = close; box.append(b);
    back.onclick = (e) => { if (e.target === back) close(); };
    back.append(box); document.body.append(back);
  }
  const irow = (k, v) => { const d = mk("div", null, "irow"); d.append(mk("small", k), mk("b", v)); return d; };
  async function showViewers(s) {
    let v; try { v = (await api("/stories/" + s.id + "/views")).views; } catch (e) { return toast(e.message); }
    sheet("Dilihat oleh " + v.length + " orang", (box, close) => {
      if (!v.length) box.append(mk("p", "Belum ada yang melihat status ini.", "dlg-d"));
      const ul = mk("ul", null, "list");
      v.forEach((x) => ul.append(row(x.avatar, x.full_name, fmt(x.t), () => { close(); showProfile(x.player_id); })));
      box.append(ul);
    });
  }
  async function showProfile(pid) {
    let u; try { u = (await api("/users/" + encodeURIComponent(pid))).user; } catch (e) { return toast(e.message); }
    const off = pid === OFFICIAL;
    sheet("Detail profil", (box, close) => {
      const cv = mk("div", null, "pcover"); if (u.cover) { cv.style.backgroundImage = 'url("' + u.cover + '")'; cv.style.cursor = "zoom-in"; cv.onclick = () => zoom(u.cover, "Banner"); }
      const top = mk("div", null, "ptop"), nm = mk("b", u.nick || u.full_name, "pname");
      if (u.verified) nm.append(ic("seal"));
      if (off) nm.append(mk("i", "RESMI", "own")); else if (u.owner) nm.append(mk("i", "OWNER", "own"));
      const pimg = off ? "logo.png" : u.avatar, pa = av(u.nick || u.full_name, pimg);
      if (pimg) { pa.style.cursor = "zoom-in"; pa.title = "Perbesar foto"; pa.onclick = () => zoom(pimg, u.nick || u.full_name); }
      top.append(pa, nm); if (u.nick) top.append(mk("small", "Nama asli: " + u.full_name));
      box.append(cv, top, irow("ID", u.player_id));
      if (!off) {
        box.append(irow("Bio", u.status || (u.private ? "Profil privat" : "-")), irow("Bergabung", dshort(u.joined)),
          irow("Terakhir dilihat", u.online ? "online" : u.seen ? ago(u.seen) : "disembunyikan"));
        { const b = mk("button", "Salin link profil", "btn full ghost"); b.type = "button"; b.onclick = () => X.shareLink("u", pid); box.append(b); }
        if (!u.me && !u.saved) { const b = mk("button", "Simpan ID", "btn full ghost"); b.type = "button"; b.onclick = () => saveId(pid).then(close); box.append(b); }
        if (!u.me && st.cur !== pid) { const b = mk("button", "Kirim pesan", "btn full"); b.type = "button"; b.onclick = () => { close(); open(pid); }; box.append(b); }
        if (!u.me && X.blockToggle) { const b = mk("button", st.blocked.has(pid) ? "Buka blokir" : "Blokir kontak", "btn full ghost"); b.type = "button"; b.onclick = () => { close(); X.blockToggle(pid); }; box.append(b); }
        if (hasStory(pid)) { const b = mk("button", "Lihat status", "btn full ghost"); b.type = "button"; b.onclick = () => { close(); viewStories(pid); }; box.append(b); }
        if (u.me) { const b = mk("button", "Ubah nama", "btn full ghost"); b.type = "button"; b.onclick = () => { close(); renameMe(); }; box.append(b); }
        else { const b = mk("button", "Ubah nama kontak", "btn full ghost"); b.type = "button"; b.onclick = () => { close(); renameContact(pid, u.nick); }; box.append(b); }
        if (me.is_owner) {
          const b = mk("button", u.verified ? "Cabut centang biru" : "Beri centang biru", "btn full ghost"); b.type = "button";
          b.onclick = async () => {
            try { await api("/admin/users/" + pid + "/verify", { method: "POST", body: JSON.stringify({ value: !u.verified }) }); toast("Berhasil"); close(); loadContacts(); }
            catch (e) { toast(e.message); }
          };
          box.append(b);
        }
      }
      if (!u.me) box.append(clearBtn(pid, close));
    });
  }
  const PK = "wc_pins_" + me.player_id;
  const pins = () => { try { return JSON.parse(localStorage.getItem(PK)) || []; } catch { return []; } };
  const isPinned = (k) => pins().includes(k);
  function togglePin(k) {
    let a = pins(), on = !a.includes(k);
    if (on) { if (a.length >= 5) return toast("Maksimal 5 chat disematkan"); a.unshift(k); } else a = a.filter((x) => x !== k);
    try { localStorage.setItem(PK, JSON.stringify(a)); } catch {}
    render(); toast(on ? "Chat disematkan" : "Sematan dilepas");
  }
  async function chatMenu() {
    const p = st.cur; if (!p) return;
    const r = roomOf(p), self = p === me.player_id, off = p === OFFICIAL, acts = [];
    if (r) acts.push({ key: "info", label: r.kind === "group" ? "Info grup" : "Info saluran" }, { key: "members", label: r.kind === "group" ? "Anggota grup" : "Pengikut saluran" });
    else if (!self) {
      acts.push({ key: "profile", label: "Lihat profil" });
      if (!off && !saved(p)) acts.push({ key: "save", label: "Simpan ID" });
      if (!off) acts.push({ key: "nick", label: "Ubah nama kontak" }, { key: "vcall", label: "Video call" }, { key: "acall", label: "Telepon" });
    }
    if (!r && !self && hasStory(p)) acts.push({ key: "story", label: "Lihat status" });
    if (r && (r.kind === "channel" || r.owner === me.player_id)) acts.push({ key: "link", label: r.kind === "group" ? "Link grup" : "Salin link saluran" });
    else if (!r && !off) acts.push({ key: "link", label: self ? "Salin link profilku" : "Salin link profil" });
    acts.push({ key: "wp", label: "Wallpaper chat" });
    if (!r && !self && p !== OFFICIAL) acts.push({ key: "block", label: st.blocked.has(p) ? "Buka blokir kontak" : "Blokir kontak" });
    acts.push({ key: "pins", label: "Pesan disematkan" }, { key: "stars", label: "Pesan berbintang" },
      { key: "pin", label: isPinned(p) ? "Lepas sematan chat" : "Sematkan chat" }, { key: "clear", label: "Hapus chat", danger: true });
    const x = await dialog({ title: r ? r.name : self ? me.player_id + " (Anda)" : nameOf(p), ok: null, actions: acts });
    if (!x) return;
    ({ info: () => showRoomInfo(r), members: () => showMembers(r), profile: () => showProfile(p), save: () => saveId(p),
      nick: () => renameContact(p, (contact(p) || {}).nick), vcall: () => call(true), acall: () => call(false),
      link: () => X.shareLink(r ? (r.kind === "group" ? "g" : "c") : "u", r || p),
      wp: () => X.wallpaperFor(p), block: () => X.blockToggle(p),
      story: () => viewStories(p), pins: () => X.showPins(), stars: () => X.showStars(),
      pin: () => togglePin(p), clear: () => clearChat(p) })[x.action]();
  }
  async function clearChat(key) {
    if (!(await dialog({ title: "Hapus chat?", desc: "Seluruh isi chat ini dihapus dari akunmu saja. Lawan bicara tetap menyimpannya, dan pesan baru akan muncul lagi.", ok: "Hapus chat" }))) return;
    try { await api("/chats/clear", { method: "POST", body: JSON.stringify({ peer: key }) }); } catch (e) { return toast(e.message); }
    delete st.last[key]; delete st.lastT[key];
    if (st.cur === key) { $("#msgs").replaceChildren(); st.day = ""; }
    render(); toast("Chat dihapus");
  }
  const clearBtn = (key, close) => { const b = mk("button", "Hapus chat", "btn full"); b.type = "button"; b.onclick = () => { close(); clearChat(key); }; return b; };
  function zoom(src, cap) {
    const b = mk("div", null, "zoom"), im = mk("img");
    im.src = src; im.alt = cap || "";
    const k = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const close = () => { document.removeEventListener("keydown", k, true); b.remove(); };
    document.addEventListener("keydown", k, true);
    b.onclick = close; b.append(im, mk("b", cap || "", "zcap")); document.body.append(b);
  }
  async function renameMe() {
    const r = await dialog({ title: "Ubah nama", desc: "Nama ini terlihat oleh semua orang.", fields: [{ name: "n", label: "Nama", value: me.full_name, max: 100, required: true }], ok: "Simpan" });
    if (r && r.n.trim()) saveProfile({ full_name: r.n.trim() });
  }
  async function renameContact(pid, cur) {
    const r = await dialog({ title: "Nama kontak", desc: "Nama ini hanya terlihat olehmu. Kosongkan untuk memakai nama asli.", fields: [{ name: "n", label: "Nama", value: cur || "", max: 100 }], ok: "Simpan" });
    if (!r) return;
    try { await api("/contacts/name", { method: "POST", body: JSON.stringify({ player_id: pid, name: r.n }) }); await loadContacts(); if (st.cur === pid) $("#rtitle").textContent = nameOf(pid); }
    catch (e) { toast(e.message); }
  }
  async function hideCalls(ids) {
    try { await api("/calls/hide", { method: "POST", body: JSON.stringify(ids ? { ids } : { all: true }) }); await loadCalls(); } catch (e) { toast(e.message); }
  }
  async function saveSticker(sid) {
    try {
      const r = await fetch("/api/stickers/" + sid); if (!r.ok) throw new Error("x");
      const blob = await r.blob();
      const src = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
      const a = mySt(); if (a.includes(src)) return toast("Stiker sudah ada di koleksimu");
      a.unshift(src); if (saveMySt(a)) toast("Stiker disimpan");
    } catch { toast("Gagal menyimpan stiker."); }
  }
  function refreshRoomHead() {
    const r = st.cur && roomOf(st.cur); if (!r) return;
    $("#rtitle").textContent = r.name; $("#rav").replaceChildren(av(r.name, r.avatar));
    $("#rid").textContent = r.kind === "group" ? "Grup" : "Saluran · " + r.count + " pengikut";
    if (r.kind === "channel" && r.verified) $("#rtitle").append(ic("seal"));
  }
  async function roomCall(r, path, body, msg) {
    try { await api("/rooms/" + r.id + "/" + path, { method: "POST", body: JSON.stringify(body || {}) }); await loadRooms(); refreshRoomHead(); if (msg) toast(msg); return true; }
    catch (e) { toast(e.message); return false; }
  }
  async function showMembers(r) {
    let v; try { v = (await api("/rooms/" + r.id + "/members")).members; } catch (e) { return toast(e.message); }
    sheet((r.kind === "group" ? "Anggota grup" : "Pengikut saluran") + " (" + v.length + ")", (box, close) => {
      const ul = mk("ul", null, "list");
      v.forEach((x) => ul.append(row(x.avatar, x.player_id === me.player_id ? "Kamu" : nameOf(x.player_id) === x.player_id ? x.full_name : nameOf(x.player_id), x.room_owner ? "Pemilik" : x.player_id,
        () => { close(); if (X.memberMenu) X.memberMenu(r, x); else showProfile(x.player_id); }, { verified: x.verified, tag: x.admin ? "ADMIN" : "" })));
      box.append(ul);
    });
  }
  function showRoomInfo(r) {
    const key = "R-" + r.id, group = r.kind === "group", owner = r.owner === me.player_id, kindName = group ? "grup" : "saluran";
    sheet(r.name, (box, close) => {
      const top = mk("div", null, "ptop"), pa = av(r.name, r.avatar);
      if (r.avatar) { pa.style.cursor = "zoom-in"; pa.title = "Perbesar foto"; pa.onclick = () => zoom(r.avatar, r.name); }
      top.style.marginTop = "0"; top.append(pa); box.append(top, mk("p", r.about || "Belum ada deskripsi.", "dlg-d"), irow("Jenis", group ? "Grup" : "Saluran"), irow(group ? "Anggota" : "Pengikut", String(r.count)));
      if (r.verified) box.append(irow("Status", "Terverifikasi (centang biru)"));
      const act = (label, fn, ghost = true) => { const b = mk("button", label, "btn full" + (ghost ? " ghost" : "")); b.type = "button"; b.onclick = () => { close(); fn(); }; box.append(b); };
      act(group ? "Lihat anggota" : "Lihat pengikut", () => showMembers(r));
      if (!group) act("Salin link saluran", () => X.shareLink("c", r)); else if (owner) act("Link grup", () => X.shareLink("g", r));
      act("Pemilik: " + nameOf(r.owner), () => showProfile(r.owner));
      if (owner) {
        act("Edit nama dan deskripsi", async () => {
          const x = await dialog({ title: "Edit " + kindName, fields: [{ name: "name", label: "Nama", value: r.name, max: 60, required: true }, { name: "about", label: "Deskripsi", value: r.about || "", max: 200, multiline: true }], ok: "Simpan" });
          if (x) roomCall(r, "edit", { name: x.name, about: x.about }, "Info diperbarui");
        });
        act("Ganti foto " + kindName, async () => { const img = await pick(320, 0.8, 110000); if (img) roomCall(r, "edit", { avatar: img }, "Foto diperbarui"); });
        if (r.avatar) act("Hapus foto " + kindName, () => roomCall(r, "edit", { avatar: "" }, "Foto dihapus"));
        if (group) act("Tambah anggota", async () => {
          const x = await dialog({ title: "Tambah anggota", fields: [{ name: "extra", label: "ID lain (opsional, pisah koma)", placeholder: "48210377, 63915204", inputmode: "numeric" }], contacts: st.contacts, ok: "Tambahkan" });
          if (!x) return;
          const ids = [...new Set([...x.members, ...x.extra.split(",").map((i) => i.trim()).filter(Boolean)])];
          if (!ids.length) return toast("Pilih atau isi ID dulu.");
          try { const res = await api("/rooms/" + r.id + "/members", { method: "POST", body: JSON.stringify({ ids }) }); await loadRooms(); refreshRoomHead(); toast(res.added ? res.added + " anggota ditambahkan" : "Semuanya sudah jadi anggota"); } catch (e) { toast(e.message); }
        });
      }
      if (group || !owner) act(group ? "Keluar grup" : "Berhenti mengikuti", async () => {
        if (!(await dialog({ title: group ? "Keluar dari grup?" : "Berhenti mengikuti?", desc: group && owner ? "Kepemilikan grup akan pindah ke anggota lain." : "Kamu tidak akan menerima pesan dari " + r.name + " lagi.", ok: group ? "Keluar" : "Berhenti" }))) return;
        if (await roomCall(r, "leave")) { delete st.last[key]; delete st.lastT[key]; if (st.cur === key) { st.cur = null; show(st.tab); } render(); }
      }, false);
      box.append(clearBtn(key, close));
    });
  }
  function viewStories(p) {
    const list = st.stories.filter((s) => s.owner === p);
    if (!list.length) return;
    let i = 0;
    const draw = () => {
      const s = list[i], b = $("#svbody"); b.replaceChildren();
      const mineS = s.owner === me.player_id;
      if (!mineS && !seenSt.has(s.id)) { seenSt.add(s.id); s.seen = true; render(); api("/stories/" + s.id + "/view", { method: "POST" }).catch(() => {}); }
      $("#svviews").hidden = $("#svdel").hidden = !mineS;
      $("#svreply").hidden = mineS; $("#svin").value = "";
      if (mineS) {
        $("#svvn").textContent = "...";
        api("/stories/" + s.id + "/views").then((r) => { if (list[i] === s) $("#svvn").textContent = r.views.length; }).catch(() => {});
        $("#svviews").onclick = () => showViewers(s);
        $("#svdel").onclick = async () => {
          if (!(await dialog({ title: "Hapus status ini?", desc: "Status dihapus dan tidak bisa dilihat lagi.", ok: "Hapus" }))) return;
          try {
            await api("/stories/" + s.id, { method: "DELETE" });
            list.splice(i, 1); await loadStories();
            if (!list.length) $("#sv").hidden = true; else { if (i >= list.length) i = list.length - 1; draw(); }
          } catch (e) { toast(e.message); }
        };
      }
      if (s.kind === "img") { const im = mk("img"); im.src = s.body; b.append(im); b.style.background = "#000"; }
      else { b.append(mk("p", s.body)); b.style.background = "hsl(" + hue(s.body) + ",85%,78%)"; }
      $("#svwho").textContent = nameOf(p) + " · " + fmt(s.t) + " (" + (i + 1) + "/" + list.length + ")";
    };
    $("#svreply").onsubmit = async (e) => {  // komentar status masuk ke chat pribadi, seperti WhatsApp
      e.preventDefault();
      const t = $("#svin").value.trim(), s = list[i]; if (!t || !s) return;
      const snip = (s.kind === "img" ? "Foto" : s.body).replace(/[\[\]\r\n]+/g, " ").trim().slice(0, 40);
      $("#svin").value = "";
      try {
        const m = await send(p, "text", "[st:" + snip + "]" + t);
        st.last[p] = m.body; st.lastT[p] = m.t; render(); toast("Balasan dikirim ke chat pribadi dengan " + nameOf(p));
      } catch (err) { $("#svin").value = t; toast(err.message); }
    };
    $("#sv").hidden = false; draw();
    $("#svbody").onclick = () => (++i >= list.length ? ($("#sv").hidden = true) : draw());
  }
  $("#svclose").onclick = () => ($("#sv").hidden = true);

  /* ----- profil ----- */
  async function saveProfile(patch) { try { me = (await api("/profile", { method: "POST", body: JSON.stringify(patch) })).user; render(); } catch (e) { toast(e.message); } }
  $("#pphoto").onclick = async () => saveProfile({ avatar: await pick(320, 0.8, 140000) });
  $("#pcovbtn").onclick = async () => saveProfile({ cover: await pick(720, 0.6, 190000) });
  $("#pcover").onclick = () => me.cover && zoom(me.cover, "Banner");                      // banner bisa diketuk untuk diperbesar
  $("#pcover").onkeydown = (e) => e.key === "Enter" && $("#pcover").click();
  $("#swpub").onclick = () => saveProfile({ public: me.public === false });
  $("#swseen").onclick = () => saveProfile({ show_seen: me.show_seen === false });
  $("#pavb").onclick = () => (me.avatar ? zoom(me.avatar, me.full_name) : toast("Belum ada foto profil"));  // foto profil bisa diketuk untuk diperbesar
  $("#pdel").onclick = () => saveProfile({ avatar: "" });
  $("#pnamebtn").onclick = () => renameMe();
  $("#ppwbtn").onclick = async () => {
    const r = await dialog({ title: "Ubah password", fields: [{ name: "n", label: "Password baru (min. 6 karakter)", type: "password", required: true }, { name: "n2", label: "Ulangi password baru", type: "password", required: true }], ok: "Ganti" });
    if (!r) return;
    if (r.n !== r.n2) return toast("Kedua password tidak sama.");
    try { await api("/password", { method: "POST", body: JSON.stringify({ new: r.n }) }); toast("Password diganti"); } catch (e) { toast(e.message); }
  };
  $("#callclear").onclick = async () => { if (await dialog({ title: "Hapus log panggilan?", desc: "Semua riwayat panggilan dihapus dari akunmu saja.", ok: "Hapus semua" })) hideCalls(); };
  $("#pedit").onclick = async () => {
    const r = await dialog({ title: "Ubah bio", fields: [{ name: "s", label: "Bio kamu", value: me.status || "", max: 80, placeholder: "Ceritakan tentang dirimu" }], ok: "Simpan" });
    if (r) saveProfile({ status: r.s });
  };

  /* ----- WebRTC native (mesh, sampai 4 orang): STUN/TURN dari /api/ice, signaling lewat /api/send + /api/poll ----- */
  let ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  api("/ice").then((r) => r.iceServers && (ICE = { iceServers: r.iceServers })).catch(() => {});
  const MAXP = 4;
  const peers = {};              // ID teman -> { pc, pend, sdpSent, up, tile, conT }
  const expected = new Map();    // peserta yang diundang anggota panggilan lain (ID -> kadaluarsa): offer-nya diterima otomatis
  const expect = (id) => expected.set(id, Date.now() + 120000);
  const isExpected = (id) => (expected.get(id) || 0) > Date.now();
  const callInfo = {};           // nama + foto orang yang belum disimpan sebagai kontak (diambil dari server)
  const pname = (p) => { const n = nameOf(p); return n && n !== p ? n : (callInfo[p] && callInfo[p].full_name) || n || p; };
  const pimg = (p) => imgOf(p) || (callInfo[p] && callInfo[p].avatar) || "";
  async function learn(pid) {  // tampilkan nama asli, bukan ID, untuk peserta yang bukan kontakmu
    if (!pid || pid === me.player_id || pid === OFFICIAL || nameOf(pid) !== pid || callInfo[pid]) return;
    callInfo[pid] = { full_name: pid, avatar: "" };
    try { callInfo[pid] = (await api("/users/" + pid)).user; } catch {}
    const p = peers[pid];
    if (p) { p.tile.nm.textContent = pname(pid); p.tile.ov.replaceChildren(av(pname(pid), pimg(pid))); layout(); }
    if (incoming && incoming.from === pid) { $("#iav").replaceChildren(av(pname(pid), pimg(pid))); $("#inwho").textContent = pname(pid); }
    if (inCall() && !t0) showHead(pid, $("#cstat").textContent);
  }
  let stream, incoming = null, video = true, facing = "user", t0 = 0, tmr, ringT, ringCtx;
  const peerIds = () => Object.keys(peers);
  const inCall = () => !$("#call").hidden;
  const sigTo = (to, type, data) => send(to, "sig", JSON.stringify({ type, data })).catch(() => {});
  const fmtT = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  function showHead(p, label) {  // layar sebelum tersambung
    $("#cav").replaceChildren(av(pname(p), pimg(p))); $("#cname").textContent = $("#ctopn").textContent = pname(p);
    $("#cstat").textContent = label; $("#ctime").textContent = "";
  }
  function started() {  // dipanggil saat sambungan pertama benar-benar tersambung
    if (t0) return;
    t0 = Date.now(); stopRing(); $("#call").classList.add("on");
    const upd = () => { const t = fmtT(Math.floor((Date.now() - t0) / 1000)); $("#cstat").textContent = t; $("#ctime").textContent = t; };
    upd(); tmr = setInterval(upd, 1000);
  }
  function startRing() {
    try { navigator.vibrate && navigator.vibrate([500, 300, 500]); } catch {}
    try {
      ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)(); ringCtx.resume();
      const beep = () => { const o = ringCtx.createOscillator(), g = ringCtx.createGain(); o.frequency.value = 440; g.gain.value = 0.08; o.connect(g); g.connect(ringCtx.destination); o.start(); o.stop(ringCtx.currentTime + 0.4); };
      const cycle = () => { beep(); setTimeout(beep, 600); try { navigator.vibrate && navigator.vibrate([500, 300, 500]); } catch {} };
      cycle(); ringT = setInterval(cycle, 3000);
    } catch {}
  }
  function stopRing() { clearInterval(ringT); ringT = null; try { navigator.vibrate && navigator.vibrate(0); } catch {} }
  const gathered = (p) => new Promise((res) => {  // tunggu kandidat jaringan terkumpul (maks 3 dtk) supaya sambungan lebih cepat dan andal
    if (!p || p.iceGatheringState === "complete") return res();
    const t = setTimeout(done, 3000);
    function chk() { if (p.iceGatheringState === "complete") done(); }
    function done() { clearTimeout(t); p.removeEventListener("icegatheringstatechange", chk); res(); }
    p.addEventListener("icegatheringstatechange", chk);
  });
  async function media() {
    $("#mute").classList.remove("off"); $("#cam").classList.remove("off");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video && { facingMode: facing } });
    $("#local").srcObject = stream; $("#local").play().catch(() => {});
    $("#local").hidden = $("#cam").hidden = $("#flip").hidden = !video; $("#lav").hidden = true;
    $("#lav").replaceChildren(av(me.full_name, me.avatar));
    $("#call").classList.toggle("vid", video); $("#call").classList.remove("on");
  }
  // tampilkan foto profil kalau kamera mati / tidak ada gambar
  const paint = (p) => { p.tile.ov.hidden = !(!video || p.tile.camOff || !p.tile.hasVid); };
  function layout() {
    const ids = peerIds();
    $("#tiles").className = "tiles n" + Math.min(Math.max(ids.length, 1), 4);
    $("#ctopn").textContent = ids.map((i) => pname(i)).join(", ");
  }
  function mkTile(pid) {
    const el = mk("div", null, "tile"), v = mk("video"), a = mk("audio"), ov = mk("div", null, "tav"), stt = mk("small", "Menghubungkan...", "tstat");
    v.autoplay = v.playsInline = true; v.muted = true; a.autoplay = true;
    ov.append(av(pname(pid), pimg(pid)));
    const nm = mk("b", pname(pid), "tname"); el.append(v, a, ov, nm, stt); $("#tiles").append(el);
    return { el, v, a, ov, stt, nm, camOff: false, hasVid: false };
  }
  function dropPeer(id) {
    const p = peers[id]; if (!p) return;
    clearTimeout(p.conT); p.pc.onconnectionstatechange = p.pc.onicecandidate = p.pc.ontrack = null; p.pc.close();
    p.tile.el.remove(); delete peers[id]; layout();
  }
  function lost(id, msg) {
    sigTo(id, "end"); dropPeer(id);
    if (!peerIds().length) hang(false, msg); else toast(pname(id) + ": terputus");
  }
  function newPeer(pid) {
    learn(pid);
    const pc = new RTCPeerConnection(ICE);
    const p = (peers[pid] = { pc, pend: [], sdpSent: false, up: false, tile: mkTile(pid), conT: 0 });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = (e) => {
      const s = e.streams[0] || new MediaStream([e.track]), t = p.tile;
      if (t.a.srcObject !== s) { t.a.srcObject = s; t.v.srcObject = s; }  // suara lewat <audio>, gambar lewat <video>
      t.a.play().catch(() => { $("#unmute").hidden = false; }); t.v.play().catch(() => {});
    };
    const seeVid = () => { if (p.tile.v.videoWidth) { p.tile.hasVid = true; paint(p); } };
    p.tile.v.addEventListener("playing", seeVid); p.tile.v.addEventListener("resize", seeVid);
    pc.onicecandidate = (e) => e.candidate && p.sdpSent && sigTo(pid, "ice", e.candidate);
    pc.onconnectionstatechange = () => {
      if (peers[pid] !== p) return;
      const c = pc.connectionState;
      if (c === "connected") {
        p.up = true; clearTimeout(p.conT); p.tile.stt.hidden = true; started();
        const vt = stream && stream.getVideoTracks()[0]; if (vt && !vt.enabled) sigTo(pid, "cam", { on: false });
      } else if (c === "disconnected") { p.tile.stt.hidden = false; p.tile.stt.textContent = "Koneksi tidak stabil..."; }
      else if (c === "failed") lost(pid, "Panggilan gagal tersambung. Jaringan kalian mungkin memblokir panggilan langsung (butuh server TURN).");
    };
    p.conT = setTimeout(() => { if (peers[pid] === p && !p.up) lost(pid, "Tidak bisa tersambung. Coba lagi sebentar lagi."); }, 35000);
    paint(p); layout();
    return p;
  }
  function hang(notify, msg) {
    if (notify) peerIds().forEach((id) => sigTo(id, "end"));
    stopRing(); clearInterval(tmr); tmr = null; t0 = 0;
    peerIds().forEach(dropPeer); expected.clear(); incoming = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; $("#local").srcObject = null; $("#unmute").hidden = true; $("#lav").hidden = true; $("#tiles").replaceChildren();
    $("#call").hidden = true; $("#incoming").hidden = true; $("#call").classList.remove("on", "vid");
    if (msg) toast(msg);
  }
  async function dial(to, group) {  // sambungan keluar ke satu orang
    const p = newPeer(to); p.tile.stt.textContent = "Memanggil...";
    const pc = p.pc;
    try {
      await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
      if (peers[to] !== p) return;
      p.sdpSent = true; await sigTo(to, "offer", { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, video, group });
    } catch { lost(to, "Tidak bisa memulai panggilan"); }
  }
  async function answer(from, data, pend) {  // jawab offer dari satu orang
    const p = newPeer(from); p.pend = pend || []; p.tile.stt.textContent = "Menyambung...";
    const pc = p.pc;
    try {
      await pc.setRemoteDescription(data.sdp);
      p.pend.forEach((c) => pc.addIceCandidate(c).catch(() => {})); p.pend = [];
      await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
      if (peers[from] !== p) return;
      p.sdpSent = true; sigTo(from, "answer", { type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch { lost(from, "Tidak bisa menyambung panggilan"); }
  }
  async function call(v) {
    if (inCall() || incoming || !st.cur || isRoom(st.cur) || st.cur === me.player_id) return;
    const to = st.cur; video = v; t0 = 0; $("#call").hidden = false; showHead(to, "Memanggil...");
    try { await media(); } catch { return hang(false, "Izin kamera/mikrofon ditolak"); }
    if ($("#call").hidden) return hang(false);  // dibatalkan saat menunggu izin
    dial(to, []);
  }
  $("#vbtn").onclick = () => call(true);
  $("#abtn").onclick = () => call(false);
  const waitUp = (id) => new Promise((res) => {  // tunggu sampai orang itu menjawab / gagal, supaya undangan berikutnya tidak bertabrakan
    const s = Date.now(), iv = setInterval(() => { const p = peers[id]; if (!p || p.up || !stream || Date.now() - s > 45000) { clearInterval(iv); res(); } }, 500);
  });
  async function addPeople() {
    if (!stream || !t0) return toast("Tunggu panggilan tersambung dulu");
    if (peerIds().some((id) => !peers[id].up)) return toast("Tunggu undangan sebelumnya dijawab dulu");
    const room = MAXP - 1 - peerIds().length;
    if (room <= 0) return toast("Panggilan penuh (maksimal " + MAXP + " orang)");
    const cur = new Set([...peerIds(), me.player_id, OFFICIAL]);
    const x = await dialog({ title: "Tambah orang ke panggilan", desc: "Bisa lebih dari satu (maksimal " + room + " lagi). Mereka diundang satu per satu.",
      fields: [{ name: "extra", label: "ID lain (opsional, pisah koma)", placeholder: "48210377, 63915204", inputmode: "numeric" }],
      contacts: st.contacts.filter((c) => !cur.has(c.player_id)), contactsLabel: "Teman tersimpan", ok: "Undang" });
    if (!x) return;
    let ids = [...new Set([...(x.members || []), ...String(x.extra || "").split(/[\s,]+/).filter(Boolean)])].filter((id) => !cur.has(id));
    if (!ids.length) return;
    if (ids.length > room) { toast("Hanya muat " + room + " orang lagi, sisanya tidak diundang"); ids = ids.slice(0, room); }
    for (const id of ids) {
      if (!stream || !inCall()) return;
      if (peerIds().length + 1 >= MAXP) return toast("Panggilan penuh (maksimal " + MAXP + " orang)");
      if (peerIds().some((k) => !peers[k].up)) await Promise.all(peerIds().map(waitUp));
      try { const u = (await api("/users/" + id)).user; if (!contact(id)) callInfo[id] = u; } catch { toast("ID " + id + " tidak ditemukan"); continue; }
      const group = peerIds();
      toast("Memanggil " + pname(id) + "...");
      await dial(id, group);  // offer terkirim dulu, baru peserta lain diberi tahu (urutan pesan terjamin)
      await Promise.all(group.map((o) => sigTo(o, "join", { pid: id })));
      await waitUp(id);
    }
  }
  $("#addbtn").onclick = addPeople;
  async function signal(from, { type, data }) {
    const p = peers[from];
    if (type === "ice") {
      if (p) (p.pc.remoteDescription ? p.pc.addIceCandidate(data).catch(() => {}) : p.pend.push(data));
      else if (incoming && incoming.from === from) incoming.pend.push(data);
      return;
    }
    if (type === "offer") {
      if (isExpected(from) && stream && !p) { expected.delete(from); return answer(from, data); }  // anggota panggilan: otomatis
      if (incoming || inCall()) return sigTo(from, "reject");
      incoming = { from, offer: data, pend: [] }; video = !!data.video; t0 = 0; learn(from);
      if (X.notifyCall && (document.hidden || !document.hasFocus())) X.notifyCall(pname(from), from, video);
      const n = ((data.group || []).length) + 2;
      $("#iav").replaceChildren(av(pname(from), pimg(from))); $("#inwho").textContent = pname(from);
      $("#inkind").textContent = (n > 2 ? "Panggilan grup " : "Panggilan ") + (video ? "video" : "suara") + " masuk" + (n > 2 ? " (" + n + " orang)" : "");
      $("#incoming").hidden = false; startRing(); return;
    }
    if (type === "join") {  // hanya dari peserta panggilan atau penelepon yang sedang berdering (cegah orang asing masuk diam-diam)
      if ((p || (incoming && incoming.from === from)) && data && /^[A-Za-z0-9]{1,12}$/.test(data.pid || "")) { expect(data.pid); learn(data.pid); }
      return;
    }
    if (type === "cam") { if (p) { p.tile.camOff = !(data && data.on); paint(p); } return; }
    if (type === "answer") {
      if (!p || p.pc.signalingState !== "have-local-offer") return;
      await p.pc.setRemoteDescription(data);
      p.pend.forEach((c) => p.pc.addIceCandidate(c).catch(() => {})); p.pend = [];
      if (!p.up) p.tile.stt.textContent = "Menyambung...";
      return;
    }
    if (type === "reject" || type === "end") {
      if (p) {
        const msg = type === "reject" ? "Panggilan ditolak" : t0 ? "Panggilan berakhir" : "Panggilan dibatalkan";
        dropPeer(from);
        if (!peerIds().length) hang(false, msg); else toast(pname(from) + (type === "reject" ? " menolak panggilan" : " keluar dari panggilan"));
      } else if (incoming && incoming.from === from) {  // penelepon membatalkan saat masih berdering
        incoming = null; expected.clear(); stopRing(); $("#incoming").hidden = true; toast("Panggilan dibatalkan");
      }
    }
  }
  $("#accept").onclick = async () => {
    const inc = incoming; if (!inc) return;
    stopRing(); $("#incoming").hidden = true; $("#call").hidden = false; showHead(inc.from, "Menyambung...");
    try { await media(); } catch { sigTo(inc.from, "reject"); incoming = null; return hang(false, "Izin kamera/mikrofon ditolak"); }
    if (incoming !== inc) return hang(false);  // dibatalkan penelepon saat menunggu izin
    incoming = null;
    await answer(inc.from, inc.offer, inc.pend);
    (inc.offer.group || []).forEach((id) => { if (id !== me.player_id && !peers[id]) { learn(id); dial(id, []); } });  // sambungkan juga ke peserta lain
  };
  $("#reject").onclick = () => { const inc = incoming; incoming = null; expected.clear(); stopRing(); $("#incoming").hidden = true; if (inc) sigTo(inc.from, "reject"); };
  $("#end").onclick = () => hang(true);
  $("#unmute").onclick = () => { Object.values(peers).forEach((p) => { p.tile.a.play().catch(() => {}); p.tile.v.play().catch(() => {}); }); $("#unmute").hidden = true; };
  $("#mute").onclick = (e) => {
    const t = stream && stream.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; e.currentTarget.classList.toggle("off", !t.enabled);
  };
  $("#cam").onclick = (e) => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; e.currentTarget.classList.toggle("off", !t.enabled);
    $("#lav").hidden = t.enabled;  // kamera mati: tampilkan fotomu sendiri
    peerIds().forEach((id) => sigTo(id, "cam", { on: t.enabled }));  // lawan bicara menampilkan fotomu, bukan layar hitam
  };
  $("#flip").onclick = async () => {
    try {
      facing = facing === "user" ? "environment" : "user";
      stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
      const nt = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })).getVideoTracks()[0];
      stream.addTrack(nt);
      Object.values(peers).forEach((p) => { const s = p.pc.getSenders().find((x) => x.track && x.track.kind === "video"); if (s) s.replaceTrack(nt); });
      $("#local").srcObject = stream; $("#cam").classList.remove("off"); $("#lav").hidden = true;
    } catch { toast("Tidak bisa ganti kamera"); }
  };
  const L = $("#local"), LA = $("#lav"); let dx = 0, dy = 0, drag = false;
  L.onpointerdown = (e) => { drag = true; dx = e.clientX - L.offsetLeft; dy = e.clientY - L.offsetTop; L.setPointerCapture(e.pointerId); };
  L.onpointermove = (e) => { if (drag) { L.style.left = LA.style.left = e.clientX - dx + "px"; L.style.top = LA.style.top = e.clientY - dy + "px"; L.style.right = LA.style.right = "auto"; } };
  L.onpointerup = () => (drag = false);

  try { localStorage.removeItem("nova_lock"); } catch {}  // sisa kunci aplikasi lama

  /* ----- polling pesan + sinyal ----- */
  if (window.WCX) Object.assign(X, window.WCX({ mk, ic, api, dialog, sheet, toast, st, me: () => me, nameOf, isRoom, roomOf, open, zoom, tm, short, row, lastText, parseRe, addMsg, tick, render, startReply, saveSticker, showProfile, loadRooms, irow, av, gName, OFFICIAL, showMembers, refreshTicks, pick, plain, send }));
  await Promise.all([loadContacts(), loadRooms(), loadStories(), loadChats(), loadPresence()]);
  if (X.loadUnread) await X.loadUnread();
  if (X.loadBlocks) X.loadBlocks();
  show("home");
  if (X.consumeLink) X.consumeLink();
  /* ----- panel owner ----- */
  const ago = (t) => { if (!t) return "belum pernah"; const d = (Date.now() - Date.parse(t)) / 1000; if (d < 90) return "baru saja"; if (d < 3600) return Math.round(d / 60) + " mnt lalu"; if (d < 86400) return Math.round(d / 3600) + " jam lalu"; return Math.round(d / 86400) + " hari lalu"; };
  const dshort = (t) => (t ? new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "-");
  const adm = { stats: null };
  const emptyLi = (t) => { const li = mk("li", t, "hint"); return li; };
  async function loadAdmin() {
    try {
      const q = $("#ausearch").value.trim();
      const [s, u, r] = await Promise.all([api("/admin/stats"), api("/admin/users?q=" + encodeURIComponent(q)), api("/admin/rooms")]);
      adm.stats = s;
      $("#astats").replaceChildren(...[["users", "Pengguna"], ["online", "Online"], ["new24", "Baru 24 jam"], ["msgs24", "Pesan 24 jam"], ["groups", "Grup"], ["channels", "Saluran"]].map(([k, l]) => { const c = mk("div", null, "astat"); c.append(mk("b", String(s[k])), mk("small", l)); return c; }));
      $("#ausers").replaceChildren(...(u.users.length ? u.users.map((x) => row(null, x.full_name, x.player_id + " · daftar " + dshort(x.created_at) + " · " + (x.online ? "online" : ago(x.last_seen)),
        () => userActions(x), { verified: x.verified, tag: x.owner ? "OWNER" : "", badge: x.banned ? "BLOKIR" : "", online: x.online })) : [emptyLi("Tidak ada pengguna yang cocok.")]));
      $("#arooms").replaceChildren(...(r.rooms.length ? r.rooms.map((x) => row(null, x.name, (x.kind === "group" ? "Grup" : "Saluran") + " · " + x.count + " anggota · oleh " + x.owner, () => roomActions(x), { avEl: chAv(x.kind), verified: x.verified })) : [emptyLi("Belum ada grup atau saluran.")]));
    } catch (e) { toast(e.message); }
  }
  async function userActions(x) {
    const r = await dialog({ title: x.full_name, desc: "ID " + x.player_id + (x.banned ? " · sedang diblokir" : ""), ok: null, actions: [
      { key: "detail", label: "Lihat detail" },
      { key: "verify", label: x.verified ? "Cabut centang biru" : "Beri centang biru" },
      ...(x.owner ? [] : [{ key: "resetpw", label: "Reset password" }, { key: "block", label: x.banned ? "Buka blokir" : "Blokir akun" }, { key: "delete", label: "Hapus akun", danger: true }])] });
    if (!r) return;
    if (r.action === "detail") return X.userDetail(x.player_id);
    try {
      if (r.action === "verify") await api("/admin/users/" + x.player_id + "/verify", { method: "POST", body: JSON.stringify({ value: !x.verified }) });
      else if (r.action === "resetpw") {
        if (!(await dialog({ title: "Reset password " + x.full_name + "?", desc: "Dibuatkan password sementara. Berikan ke pemiliknya, lalu minta dia menggantinya di Profil.", ok: "Reset" }))) return;
        const res = await api("/admin/users/" + x.player_id + "/resetpw", { method: "POST" });
        await dialog({ title: "Password sementara", desc: x.full_name + ": " + res.password, ok: null }); return;
      } else if (r.action === "block") {
        if (!x.banned && !(await dialog({ title: "Blokir " + x.full_name + "?", desc: "Dia langsung tidak bisa masuk atau memakai aplikasi sampai blokirnya dibuka.", ok: "Blokir" }))) return;
        await api("/admin/users/" + x.player_id + "/block", { method: "POST", body: JSON.stringify({ value: !x.banned }) });
      } else if (r.action === "delete") {
        if (!(await dialog({ title: "Hapus akun " + x.full_name + "?", desc: "Akun, semua pesan, kontak, story, serta grup dan saluran miliknya dihapus permanen. Tidak bisa dibatalkan.", ok: "Hapus permanen" }))) return;
        await api("/admin/users/" + x.player_id, { method: "DELETE" });
      }
      toast("Berhasil"); loadAdmin();
    } catch (e) { toast(e.message); }
  }
  async function roomActions(x) {
    const jenis = x.kind === "group" ? "grup" : "saluran";
    const r = await dialog({ title: x.name, desc: jenis + " · " + x.count + " anggota" + (x.kind === "channel" ? " · centang biru otomatis di 1000 pengikut" : ""), ok: null, actions: [
      ...(x.kind === "channel" ? [{ key: "verify", label: x.verified ? "Cabut centang biru" : "Beri centang biru" }] : []),
      { key: "delete", label: "Hapus " + jenis, danger: true }] });
    if (!r) return;
    if (r.action === "verify") {
      try { await api("/admin/rooms/" + x.id + "/verify", { method: "POST", body: JSON.stringify({ value: !x.verified }) }); toast("Berhasil"); loadAdmin(); loadRooms(); } catch (e) { toast(e.message); }
      return;
    }
    if (!(await dialog({ title: "Hapus " + x.name + "?", desc: "Semua pesan di dalamnya ikut terhapus permanen.", ok: "Hapus permanen" }))) return;
    try { await api("/admin/rooms/" + x.id, { method: "DELETE" }); toast("Dihapus"); loadAdmin(); loadRooms(); } catch (e) { toast(e.message); }
  }
  $("#abset").onclick = async () => {
    try {
      const r = await api("/admin/banner", { method: "POST", body: JSON.stringify({ text: $("#abanner").value.trim() }) });
      me.announce = r.announce; $("#annt").textContent = $("#annt2").textContent = r.announce; $("#abanner").value = r.announce; toast("Banner diperbarui");
    } catch (e) { toast(e.message); }
  };
  $("#abreset").onclick = () => { $("#abanner").value = ""; $("#abset").click(); };
  $("#acastgo").onclick = async () => {
    const text = $("#acast").value.trim();
    if (!text) return toast("Tulis isi pengumuman dulu.");
    if (!(await dialog({ title: "Kirim ke " + (adm.stats ? adm.stats.users : "semua") + " pengguna?", desc: "Pesan ini muncul di chat setiap pengguna sebagai pesan dari WapChatt (akun resmi).", ok: "Kirim" }))) return;
    try { const r = await api("/admin/announce", { method: "POST", body: JSON.stringify({ text }) }); $("#acast").value = ""; toast("Terkirim ke " + r.sent + " pengguna"); } catch (e) { toast(e.message); }
  };
  let adT; $("#ausearch").oninput = () => { clearTimeout(adT); adT = setTimeout(loadAdmin, 350); };
  $("#admbtn").onclick = () => show("admin");

  let last = (await api("/poll")).last, t1 = Date.now(), t2 = Date.now();
  (async function tick() {
    let wait = 50;
    const started = Date.now();
    try {
      const r = await api("/poll?after=" + last + "&wait=1", { signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
      last = r.last;
      r.events.forEach((m) => {
        if (m.kind === "sig") return signal(m.sender, JSON.parse(m.body));
        if (m.sender === me.player_id) return;  // chat ke diri sendiri: sudah tampil saat dikirim
        const key = isRoom(m.to) ? m.to : m.sender;
        if (!isRoom(key)) { const cs = st.cs[key] || (st.cs[key] = { blocked: false, last: 0 }); cs.last = Math.max(cs.last || 0, m.id); if (st.cur === key) refreshTicks(); }  // dibalas: centang jadi biru
        if (X.notify && (document.hidden || !document.hasFocus())) X.notify(m, key);
        if (isRoom(key) && !roomOf(key)) loadRooms();
        if (st.cur === key && !$("#room").hidden) { addMsg(m); if (X.markRead) X.markRead(key); }
        else { st.last[key] = m.body; st.lastT[key] = m.t; st.unread[key] = (st.unread[key] || 0) + 1; }
        render();
      });
      if (!r.events.length && Date.now() - started < 1500) wait = 1200;  // server lama tanpa long-poll: jangan membanjiri
      const now = Date.now();
      if (now - t1 > 60000) { t1 = now; loadStories(); loadContacts(); loadChats(); if (X.loadUnread) X.loadUnread(); }
      if (now - t2 > 15000) { t2 = now; loadPresence(); }
    } catch (e) { wait = 2500; }
    setTimeout(tick, wait);
  })();
}

function splash() {
  try { if (sessionStorage.getItem("nova_splash")) return; sessionStorage.setItem("nova_splash", "1"); } catch {}
  const d = document.createElement("div"), im = document.createElement("img"), t = document.createElement("b");
  d.className = "splash"; im.src = "logo.png"; im.alt = ""; im.onerror = () => im.remove(); t.textContent = "WapChatt";
  d.append(im, t); document.body.append(d);
  setTimeout(() => d.classList.add("out"), 1100); setTimeout(() => d.remove(), 1500);
}

function initLanding() {
  try { if (getToken() && localStorage.getItem("wc_link")) { location.replace("dashboard.html"); return; } } catch {}
  const panel = $("#panel"), v = $("#bg");
  if (v) { if (matchMedia("(prefers-reduced-motion: reduce)").matches) v.pause(); else v.play().catch(() => {}); }
  if (getToken()) { const e = $("#enter"); e.href = "dashboard.html"; e.textContent = "BUKA APLIKASI"; }
  let on = false, last = 0, lx = 0, ly = 0;
  const reveal = (x, y) => {
    if (on) return; on = true;
    if (x != null) { const r = document.createElement("div"); r.className = "ripple"; r.style.left = x + "px"; r.style.top = y + "px"; document.body.append(r); setTimeout(() => r.remove(), 800); }
    document.body.classList.add("show");
    panel.removeAttribute("inert"); panel.setAttribute("aria-hidden", "false");
  };
  document.addEventListener("pointerup", (e) => {
    if (on) return;
    if (e.timeStamp - last < 350 && Math.hypot(e.clientX - lx, e.clientY - ly) < 60) reveal(e.clientX, e.clientY);
    last = e.timeStamp; lx = e.clientX; ly = e.clientY;
  });
  $("#hint").onclick = (e) => { if (e.detail === 0) reveal(); };  // tombol ini untuk pengguna keyboard / pembaca layar
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === document.body) reveal(); });
}

/* Link berbagi: /?u=ID (profil), /?c=ID (saluran), /?g=KODE (grup). Disimpan dulu supaya tetap terbuka setelah login. */
try {
  const q = new URLSearchParams(location.search), k = ["u", "c", "g", "o"].find((x) => q.get(x));
  if (k) { localStorage.setItem("wc_link", k + ":" + q.get(k)); history.replaceState(null, "", location.pathname); }
} catch {}
const page = document.body.dataset.page;
if (page === "dashboard") splash();
if (page === "landing") initLanding();
if (page === "login") initLogin();
if (page === "dashboard") initDashboard();
