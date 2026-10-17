/* Fitur tambahan WapChatt. Dimuat SEBELUM script.js; script.js memanggil window.WCX(ctx) sekali setelah dashboard siap.
   Isi: sematkan pesan (24 jam / 7 hari / 30 hari / tanpa batas), bintang pesan, menu titik tiga di tiap pesan. */
/* Tutup layar secepatnya kalau kunci aplikasi aktif, sebelum data apa pun tampil. Kunci aslinya dibuat setelah dashboard siap. */
(function () { try { if (localStorage.getItem("wc_lock")) { const s = document.createElement("div"); s.id = "lockshade"; s.className = "lockscr"; document.body.append(s); } } catch {} })();

window.WCX = function (c) {
  const { mk, ic, api, dialog, sheet, toast, st, nameOf, isRoom } = c;
  const $ = (s) => document.querySelector(s);
  const stars = new Set();
  let pins = [], canPin = false, pinIdx = 0;

  const bubbleOf = (id) => document.querySelector('#msgs .bub[data-mid="' + id + '"]');
  function jump(id) {
    const t = bubbleOf(id);
    if (!t) return toast("Pesan ini ada di bagian chat yang lebih lama.");
    t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1200);
  }

  /* ---------- polling & pertanyaan (tampil di gelembung) ---------- */
  const POLL = /^\[poll:(\d+)\]([\s\S]*)$/, QNA = /^\[qna:(\d+)\]([\s\S]*)$/;
  const preview = (b) => { let m = POLL.exec(b || ""); if (m) return "Polling: " + m[2]; m = QNA.exec(b || ""); return m ? "Pertanyaan: " + m[2] : null; };
  const label = (icon, text) => { const h = mk("div", null, "ph"); h.append(ic(icon), mk("span", text)); return h; };
  function fill(box, m, d) {
    const pm = POLL.exec(m.body), qm = QNA.exec(m.body);
    if (!pm && !qm) return false;
    const w = mk("div", null, pm ? "pollw" : "qnaw"), id = (pm || qm)[1];
    w.dataset[pm ? "poll" : "qna"] = id;
    w.append(label(pm ? "pin" : "more", pm ? "POLLING" : "PERTANYAAN"), mk("h4", (pm || qm)[2]), mk("div", null, "pbody"));
    w.querySelector(".pbody").append(mk("small", "Memuat..."));
    box.append(w); d.classList.add("rich");
    pm ? loadPoll(w) : loadQna(w);
    return true;
  }
  const names = (ids) => ids.map((p) => (p === c.me().player_id ? "Kamu" : c.gName(p))).join(", ");
  async function loadPoll(w) {
    try { renderPoll(w, (await api("/polls/" + w.dataset.poll)).poll); } catch (e) { w.querySelector(".pbody").replaceChildren(mk("small", e.message)); }
  }
  function renderPoll(w, p) {
    const body = w.querySelector(".pbody"), top = Math.max(1, p.total);
    body.replaceChildren(mk("small", p.multi ? "Pilih satu atau lebih jawaban" : "Pilih satu jawaban"));
    p.options.forEach((o) => {
      const b = mk("button", null, "popt" + (p.mine.includes(o.i) ? " on" : "")); b.type = "button";
      const bar = mk("i", null, "bar"); bar.style.width = Math.round((o.n / top) * 100) + "%";
      b.append(bar, mk("span", o.text), mk("span", String(o.n), "pn"));
      b.onclick = async () => {
        const sel = p.multi ? (p.mine.includes(o.i) ? p.mine.filter((x) => x !== o.i) : [...p.mine, o.i]) : (p.mine.includes(o.i) ? [] : [o.i]);
        try { renderPoll(w, (await api("/polls/" + p.id + "/vote", { method: "POST", body: JSON.stringify({ options: sel }) })).poll); } catch (e) { toast(e.message); }
      };
      body.append(b);
    });
    const f = mk("div", null, "pfoot"); f.append(mk("small", p.total + " suara" + (p.anon ? " · anonim" : "")));
    if (!p.anon && p.total) {
      const l = mk("button", "Lihat pemilih", "plink"); l.type = "button";
      l.onclick = () => c.sheet("Pemilih polling", (box) => p.options.forEach((o) => {
        const ul = mk("ul", null, "list"); box.append(mk("p", o.text + " (" + o.n + ")", "dlg-l"));
        if (!o.voters.length) box.append(mk("p", "Belum ada suara.", "dlg-d")); else o.voters.forEach((v) => ul.append(c.row(null, v === c.me().player_id ? "Kamu" : c.gName(v), "", () => {}, {}))); box.append(ul);
      }));
      f.append(l);
    }
    body.append(f);
  }
  async function loadQna(w) {
    try { renderQna(w, (await api("/questions/" + w.dataset.qna)).q); } catch (e) { w.querySelector(".pbody").replaceChildren(mk("small", e.message)); }
  }
  function renderQna(w, q) {
    const body = w.querySelector(".pbody"), mine = q.answers.find((a) => a.mine);
    body.replaceChildren(mk("small", q.count + " jawaban"));
    if (mine && (mine.replies || []).some((r) => r.who === "admin")) body.append(mk("small", "Admin membalas jawabanmu"));
    const row = mk("div", null, "qbtns"), ans = mk("button", mine ? "Ubah jawabanku" : "Jawab", "btn"), see = mk("button", "Lihat jawaban (" + q.count + ")", "btn ghost");
    ans.type = see.type = "button";
    ans.onclick = async () => {
      const x = await dialog({ title: "Jawab pertanyaan", fields: [{ name: "t", label: "Jawabanmu", multiline: true, max: 500, value: mine ? mine.text : "", required: true }], ok: "Kirim" });
      if (!x) return;
      try { renderQna(w, (await api("/questions/" + q.id + "/answer", { method: "POST", body: JSON.stringify({ text: x.t }) })).q); toast("Jawaban terkirim"); } catch (e) { toast(e.message); }
    };
    see.onclick = () => showAnswers(w, q);
    if (!q.is_owner) row.append(ans);  // admin saluran tidak bisa menjawab
    row.append(see); body.append(row);
  }
  function showAnswers(w, q) {
    c.sheet("Jawaban (" + q.count + ")", (box, close) => {
      if (!q.answers.length) box.append(mk("p", "Belum ada jawaban.", "dlg-d"));
      const reopen = (nq) => { close(); renderQna(w, nq); showAnswers(w, nq); };
      const ul = mk("ul", null, "list");
      q.answers.forEach((a) => {
        const li = q.is_owner ? c.row(null, a.name, "ID " + a.by + " · " + a.text, () => {}, { time: c.short(a.t) })
          : c.row(null, a.mine ? "Anonim (jawabanmu)" : "Anonim", a.text, () => {}, { time: c.short(a.t) });
        li.style.flexWrap = "wrap";
        (a.replies || []).forEach((r) => {
          const rp = mk("div", null, "qrep"); rp.append(mk("b", r.who === "admin" ? "Admin saluran" : "Penjawab"), mk("span", r.text));
          if (r.mine || q.is_owner) {
            const x = mk("button", "hapus", "plink"); x.type = "button";
            x.onclick = async (ev) => { ev.stopPropagation(); try { await api("/replies/" + r.id, { method: "DELETE" }); reopen((await api("/questions/" + q.id)).q); } catch (err) { toast(err.message); } };
            rp.append(x);
          }
          li.append(rp);
        });
        const acts = mk("div", null, "qact");
        if (q.is_owner || a.mine) {  // admin membalas penjawab, penjawab membalas admin
          const rb = mk("button", "Balas", "plink"); rb.type = "button";
          rb.onclick = async (ev) => {
            ev.stopPropagation();
            const x = await dialog({ title: q.is_owner ? "Balas jawaban" : "Balas admin", fields: [{ name: "t", label: "Balasanmu", multiline: true, max: 300, required: true }], ok: "Kirim" });
            if (!x) return;
            try { reopen((await api("/answers/" + a.id + "/reply", { method: "POST", body: JSON.stringify({ text: x.t }) })).q); } catch (err) { toast(err.message); }
          };
          acts.append(rb);
        }
        if (a.mine || q.is_owner) {
          const x = mk("button", "Hapus jawaban", "plink"); x.type = "button";
          x.onclick = async (ev) => { ev.stopPropagation(); try { await api("/answers/" + a.id, { method: "DELETE" }); reopen((await api("/questions/" + q.id)).q); } catch (err) { toast(err.message); } };
          acts.append(x);
        }
        if (acts.children.length) li.append(acts);
        ul.append(li);
      });
      box.append(ul);
    });
  }
  function refreshWidgets() {  // suara dan jawaban baru dari orang lain ikut muncul
    [...document.querySelectorAll("#msgs [data-poll]")].slice(-15).forEach(loadPoll);
    [...document.querySelectorAll("#msgs [data-qna]")].slice(-15).forEach(loadQna);
  }

  /* ---------- buat polling / pertanyaan ---------- */
  function pollDialog() {
    return new Promise((resolve) => {
      const back = mk("div", null, "dlg-back"), box = mk("div", null, "dlg sh");
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      const q = mk("input"); q.placeholder = "Tanyakan sesuatu"; q.maxLength = 200; q.autocomplete = "off"; q.setAttribute("aria-label", "Pertanyaan polling");
      const list = mk("div"), add = mk("button", "+ Tambah pilihan", "btn ghost"), multi = mk("input"), ml = mk("label", null, "pk");
      multi.type = "checkbox"; ml.append(multi, mk("span", "Boleh pilih lebih dari satu jawaban"));
      const addOpt = () => {
        const n = list.children.length; if (n >= 12) return;
        const r = mk("div", null, "pollrow"), i = mk("input"); i.placeholder = "Pilihan " + (n + 1); i.maxLength = 100; i.autocomplete = "off"; i.setAttribute("aria-label", "Pilihan " + (n + 1));
        r.append(i); list.append(r); add.hidden = list.children.length >= 12; return i;
      };
      addOpt(); addOpt(); add.type = "button"; add.onclick = () => addOpt().focus();
      const err = mk("p", "", "dlg-e"); err.setAttribute("role", "alert");
      const row = mk("div", null, "dlg-b"), no = mk("button", "Batal", "btn ghost"), yes = mk("button", "Kirim", "btn"); no.type = yes.type = "button"; row.append(no, yes);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); back.remove(); resolve(v); };
      const onKey = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(null); } };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      yes.onclick = () => {
        const opts = [...list.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
        if (!q.value.trim()) return (err.textContent = "Isi pertanyaannya dulu.");
        if (new Set(opts).size < 2) return (err.textContent = "Isi minimal 2 pilihan yang berbeda.");
        done({ question: q.value.trim(), options: [...new Set(opts)], multi: multi.checked });
      };
      back.addEventListener("pointerdown", (ev) => { if (ev.target === back) done(null); });
      box.append(mk("h2", "Buat polling"), q, list, add, ml, err, row); back.append(box); document.body.append(back); q.focus();
    });
  }
  function posted(m) {  // pesan baru buatan kita sendiri: tampilkan di chat dan perbarui daftar
    c.st.byId[m.id] = m;
    if (c.st.cur === m.to) c.addMsg(m); else { c.st.last[m.to] = m.body; c.st.lastT[m.to] = m.t; }
    c.st.last[m.to] = m.body; c.st.lastT[m.to] = m.t; c.render();
  }
  $("#attach").onclick = async () => {
    const to = st.cur; if (!to) return;
    const r = c.roomOf(to), acts = [{ key: "poll", label: "Polling" }];
    if (r && r.kind === "channel" && r.is_admin) acts.push({ key: "qna", label: "Pertanyaan" });
    const x = await dialog({ title: "Buat", ok: null, actions: acts }); if (!x) return;
    try {
      if (x.action === "poll") { const p = await pollDialog(); if (p) posted(await api("/polls", { method: "POST", body: JSON.stringify({ to, ...p }) })); }
      else {
        const q = await dialog({ title: "Pertanyaan untuk pengikut", fields: [{ name: "q", label: "Pertanyaan", multiline: true, max: 300, required: true }], ok: "Kirim" });
        if (q) posted(await api("/questions", { method: "POST", body: JSON.stringify({ to, question: q.q }) }));
      }
    } catch (err) { toast(err.message); }
  };

  /* ---------- teruskan pesan ---------- */
  async function forwardMsg(m) {
    if (POLL.test(m.body) || QNA.test(m.body)) return toast("Polling dan pertanyaan tidak bisa diteruskan.");
    const me = c.me(), t = [
      ...st.contacts.filter((x) => x.player_id !== c.OFFICIAL).map((x) => ({ player_id: x.player_id, full_name: x.full_name, avatar: x.avatar })),
      ...st.rooms.filter((r) => r.joined && (r.kind === "group" || r.is_admin)).map((r) => ({ player_id: "R-" + r.id, full_name: r.name + (r.kind === "group" ? " (grup)" : " (saluran)"), avatar: r.avatar })),
      { player_id: me.player_id, full_name: me.player_id + " (Anda)", avatar: me.avatar }];
    const x = await dialog({ title: "Teruskan ke...", desc: "Pilih maksimal 5 tujuan.", contacts: t, contactsLabel: "Pilih tujuan", ok: "Teruskan" });
    if (!x || !x.members.length) return;
    if (x.members.length > 5) return toast("Maksimal 5 tujuan sekali teruskan.");
    try {
      (await api("/forward", { method: "POST", body: JSON.stringify({ msg_id: m.id, to: x.members }) })).messages.forEach(posted);
      toast("Pesan diteruskan ke " + x.members.length + " chat");
    } catch (err) { toast(err.message); }
  }

  /* ---------- bintang ---------- */
  function mark(d, on) {
    const mt = d.querySelector(".mt"); let s = d.querySelector(".stm");
    if (on && !s && mt) { s = mk("span", null, "stm"); s.append(ic("star")); mt.prepend(s); }
    else if (!on && s) s.remove();
  }
  async function setStar(id, on) {
    try { await api("/stars", { method: "POST", body: JSON.stringify({ msg_id: id, value: on }) }); }
    catch (e) { toast(e.message); return false; }
    if (on) stars.add(id); else stars.delete(id);
    const b = bubbleOf(id); if (b) mark(b, on);
    return true;
  }
  async function loadStars() { try { (await api("/stars")).stars.forEach((s) => stars.add(s.msg.id)); } catch {} }
  async function showStars() {
    let v; try { v = (await api("/stars")).stars; } catch (e) { return toast(e.message); }
    v.forEach((s) => stars.add(s.msg.id));
    sheet("Pesan berbintang (" + v.length + ")", (box, close) => {
      if (!v.length) box.append(mk("p", "Belum ada pesan berbintang. Buka titik tiga di sebuah pesan lalu pilih Beri bintang.", "dlg-d"));
      const ul = mk("ul", null, "list");
      v.forEach((s) => {
        const mine = s.msg.sender === c.me().player_id, who = mine ? "Kamu" : nameOf(s.msg.sender);
        const li = c.row(null, who + (isRoom(s.key) ? " di " + nameOf(s.key) : ""), c.lastText(s.msg.body), async () => { close(); await c.open(s.key); jump(s.msg.id); }, { time: c.short(s.msg.t) });
        const x = mk("button", null, "pinx"); x.type = "button"; x.setAttribute("aria-label", "Hapus bintang"); x.append(ic("star"));
        x.onclick = async (e) => { e.stopPropagation(); if (await setStar(s.msg.id, false)) li.remove(); };
        li.append(x); ul.append(li);
      });
      box.append(ul);
    });
  }

  /* ---------- sematkan pesan ---------- */
  const expLabel = (e) => {
    if (!e) return "Tanpa batas";
    const h = Math.max(0, (Date.parse(e) - Date.now()) / 3600000);
    return h < 1 ? "< 1 jam" : h < 48 ? Math.round(h) + " jam" : Math.round(h / 24) + " hari";
  };
  function paintBar() {
    const bar = $("#pinbar"), n = pins.length; bar.hidden = !n;
    if (!n) return;
    $("#pintext").textContent = c.lastText(pins[pinIdx].msg.body);
    $("#pincount").textContent = n > 1 ? pinIdx + 1 + "/" + n : "";
  }
  async function loadPins() {
    const p = st.cur; if (!p) return;
    try {
      const r = await api("/pins?peer=" + encodeURIComponent(p));
      if (st.cur !== p) return;
      pins = r.pins; canPin = !!r.can_pin; if (pinIdx >= pins.length) pinIdx = 0; paintBar();
    } catch {}
  }
  async function pinMsg(m) {
    const x = await dialog({ title: "Sematkan pesan", desc: "Pilih berapa lama pesan ini disematkan di bagian atas chat.", ok: null, actions: [
      { key: "24", label: "24 jam" }, { key: "168", label: "7 hari" }, { key: "720", label: "30 hari" }, { key: "0", label: "Tanpa batas" }] });
    if (!x) return;
    try { await api("/pins", { method: "POST", body: JSON.stringify({ peer: st.cur, msg_id: m.id, hours: +x.action }) }); await loadPins(); toast("Pesan disematkan"); }
    catch (e) { toast(e.message); }
  }
  async function unpin(pid) {
    try { await api("/pins/" + pid, { method: "DELETE" }); await loadPins(); toast("Sematan dilepas"); return true; }
    catch (e) { toast(e.message); return false; }
  }
  function showPins() {
    if (!pins.length) return toast("Belum ada pesan yang disematkan di chat ini.");
    sheet("Pesan disematkan (" + pins.length + ")", (box, close) => {
      const ul = mk("ul", null, "list");
      pins.forEach((p) => {
        const li = c.row(null, p.msg.sender === c.me().player_id ? "Kamu" : nameOf(p.msg.sender), c.lastText(p.msg.body), () => { close(); jump(p.msg.id); }, { time: expLabel(p.exp) });
        if (canPin) {
          const x = mk("button", "Lepas", "pinx"); x.type = "button";
          x.onclick = async (e) => { e.stopPropagation(); if (await unpin(p.id)) close(); };
          li.append(x);
        }
        ul.append(li);
      });
      box.append(ul);
    });
  }
  $("#pinbar").onclick = () => {
    const p = pins[pinIdx]; if (!p) return;
    if (bubbleOf(p.msg.id)) jump(p.msg.id); else showPins();
    pinIdx = (pinIdx + 1) % pins.length; paintBar();
  };
  setInterval(() => { if (st.cur && !$("#room").hidden) { loadPins(); refreshWidgets(); loadChatState(st.cur); } }, 15000);  // sematan dari lawan bicara ikut muncul

  /* ---------- menu titik tiga di tiap pesan ---------- */
  function menuBtn(mt, d, m, mine, sid) {
    const b = mk("button", null, "rpl mdot"); b.type = "button"; b.title = "Menu pesan"; b.setAttribute("aria-label", "Menu pesan"); b.append(ic("more"));
    b.onclick = (e) => { e.stopPropagation(); bubbleMenu(d, mine, sid); };
    mt.append(b);
    if (m.id && stars.has(m.id)) { const s = mk("span", null, "stm"); s.append(ic("star")); mt.prepend(s); }  // mt belum dipasang ke d
  }
  async function bubbleMenu(d, mine, sid) {
    const id = +d.dataset.mid, m = st.byId[id];
    if (!id || !m) return toast("Tunggu pesan terkirim dulu");
    const txt = c.parseRe(m.body).text, acts = [], pinned = pins.find((p) => p.msg.id === id);
    if (!$("#form").hidden) acts.push({ key: "reply", label: "Balas" });
    if (!POLL.test(m.body) && !QNA.test(m.body)) acts.push({ key: "fwd", label: "Teruskan" });
    acts.push({ key: "star", label: stars.has(id) ? "Hapus bintang" : "Beri bintang" });
    if (canPin) acts.push({ key: "pin", label: pinned ? "Lepas sematan pesan" : "Sematkan pesan" });
    if (!sid && txt) acts.push({ key: "copy", label: "Salin teks" });
    if (sid && !mine) acts.push({ key: "stk", label: "Simpan stiker" });
    if (mine) acts.push({ key: "del", label: "Hapus pesan", danger: true });
    const x = await dialog({ title: "Pesan", ok: null, actions: acts });
    if (!x) return;
    if (x.action === "reply") c.startReply(id);
    else if (x.action === "fwd") forwardMsg(m);
    else if (x.action === "star") { const on = !stars.has(id); if (await setStar(id, on)) toast(on ? "Diberi bintang" : "Bintang dihapus"); }
    else if (x.action === "pin") { if (pinned) unpin(pinned.id); else pinMsg(m); }
    else if (x.action === "copy") navigator.clipboard.writeText(c.plain(txt)).then(() => toast("Teks disalin"), () => toast("Gagal menyalin"));
    else if (x.action === "stk") c.saveSticker(sid);
    else if (x.action === "del") {
      if (!(await dialog({ title: "Hapus pesan?", desc: "Pesan dihapus untuk semua orang. Lawan bicara yang sedang membuka chat ini baru melihatnya hilang setelah membuka ulang.", ok: "Hapus" }))) return;
      try { await api("/messages/" + id, { method: "DELETE" }); d.remove(); delete st.byId[id]; stars.delete(id); loadPins(); } catch (err) { toast(err.message); }
    }
  }

  /* ---------- link profil / saluran / grup ---------- */
  const ORIGIN = location.origin;
  const copyText = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch { await dialog({ title: "Salin link ini", desc: text, ok: null }); }
  };
  async function groupLink(r, reset) {
    try { return ORIGIN + "/?g=" + (await api("/rooms/" + r.id + "/invite", { method: "POST", body: JSON.stringify({ reset: !!reset }) })).code; }
    catch (e) { toast(e.message); return null; }
  }
  /* kind: u = profil (target = ID), c = saluran (target = objek room), g = grup (target = objek room, hanya pemilik) */
  async function shareLink(kind, target) {
    if (kind === "u") return copyText(ORIGIN + "/?u=" + encodeURIComponent(target), "Link profil disalin");
    if (kind === "c") return copyText(ORIGIN + "/?c=" + target.id, "Link saluran disalin");
    let link = await groupLink(target, false); if (!link) return;
    for (;;) {
      const x = await dialog({ title: "Link grup", desc: link + "\n\nSiapa pun yang membuka link ini bisa bergabung ke grup. Buat link baru kalau link lama sudah tersebar ke orang yang tidak diinginkan.", ok: null, actions: [
        { key: "copy", label: "Salin link" }, { key: "reset", label: "Buat link baru (link lama mati)" }] });
      if (!x) return;
      if (x.action === "copy") return copyText(link, "Link grup disalin");
      const nl = await groupLink(target, true); if (!nl) return; link = nl; toast("Link baru dibuat");
    }
  }
  function roomCard(r, kind, go) {
    c.sheet(r.name, (box, close) => {
      const top = mk("div", null, "ptop"); top.style.marginTop = "0"; top.append(c.av(r.name, r.avatar)); box.append(top);
      box.append(mk("p", r.about || "Belum ada deskripsi.", "dlg-d"), c.irow(kind === "g" ? "Anggota" : "Pengikut", String(r.count)));
      if (r.verified) box.append(c.irow("Status", "Terverifikasi (centang biru)"));
      const b = mk("button", r.joined ? "Buka" : kind === "g" ? "Gabung grup" : "Ikuti saluran", "btn full"); b.type = "button";
      b.onclick = async () => { close(); try { await go(); } catch (e) { toast(e.message); } }; box.append(b);
    });
  }
  /* membuka link yang disimpan script.js (?u= profil, ?c= saluran, ?g= grup) */
  async function consumeLink() {
    let v = null; try { v = localStorage.getItem("wc_link"); localStorage.removeItem("wc_link"); } catch {}
    const m = /^([ucgo]):(.+)$/.exec(v || ""); if (!m) return;
    const k = m[1], val = m[2];
    try {
      if (k === "u" && /^[A-Za-z0-9]{1,12}$/.test(val)) return c.showProfile(val);
      if (k === "o" && /^(R-\d{1,9}|[A-Za-z0-9]{1,12})$/.test(val)) return c.open(val);
      if (k === "c" && /^\d{1,9}$/.test(val)) {
        await c.loadRooms();
        const r = st.rooms.find((x) => x.id === +val && x.kind === "channel");
        if (!r) return toast("Saluran tidak ditemukan.");
        return roomCard(r, "c", async () => { if (!r.joined) await api("/rooms/" + r.id + "/join", { method: "POST" }); await c.loadRooms(); c.open("R-" + r.id); });
      }
      if (k === "g" && /^[0-9a-f]{16}$/.test(val)) {
        const r = (await api("/invite/" + val)).room;
        return roomCard(r, "g", async () => { if (!r.joined) await api("/invite/" + val + "/join", { method: "POST" }); await c.loadRooms(); c.open("R-" + r.id); });
      }
    } catch (err) { toast(err.message); }
  }
  const lb = $("#linkbtn"); if (lb) lb.onclick = () => shareLink("u", c.me().player_id);

  /* ---------- tag anggota grup (@nama, @semua) ---------- */
  const MENT = /@\[([^|\]]+)\|([^\]]*)\]/g;
  function rich(text, d) {  // @[ID|Nama] tampil sebagai @Nama yang disorot
    MENT.lastIndex = 0;
    const sp = mk("span"); let last = 0, m, tagged = false; const me = c.me().player_id;
    while ((m = MENT.exec(text))) {
      if (m.index > last) sp.append(text.slice(last, m.index));
      const t = mk("b", "@" + m[2], "ment" + (m[1] === me ? " me" : "")), pid = m[1];
      if (pid !== "all") { t.style.cursor = "pointer"; t.onclick = () => c.showProfile(pid); }
      if (pid === me || pid === "all") tagged = true;
      sp.append(t); last = MENT.lastIndex;
    }
    if (!last) { sp.textContent = text; return sp; }
    if (last < text.length) sp.append(text.slice(last));
    if (tagged && d) d.classList.add("tagged");
    return sp;
  }
  const picked = new Map();  // "@Nama" -> ID, diubah jadi tag saat pesan dikirim
  const safeName = (n) => String(n).replace(/[\[\]|]/g, "").trim() || "anggota";
  function encodeMentions(t) {
    [...picked.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([k, [pid, nm]]) => { if (t.includes(k)) t = t.split(k).join("@[" + pid + "|" + nm + "]"); });
    picked.clear(); return t;
  }
  const mpop = mk("div", null, "mpop"); mpop.hidden = true; mpop.setAttribute("role", "listbox"); $("#form").append(mpop);
  $("#text").addEventListener("input", () => {
    const r = c.roomOf(st.cur || ""), txt = $("#text");
    if (!r || r.kind !== "group") return (mpop.hidden = true);
    const pos = txt.selectionStart, m = /(^|\s)@([^\s@]*)$/.exec(txt.value.slice(0, pos));
    if (!m) return (mpop.hidden = true);
    const q = m[2].toLowerCase(), me = c.me().player_id;
    const list = [{ player_id: "all", full_name: "Semua" }, ...st.memList.filter((x) => x.player_id !== me)]
      .filter((x) => x.full_name.toLowerCase().includes(q) || x.player_id.toLowerCase().includes(q)).slice(0, 6);
    if (!list.length) return (mpop.hidden = true);
    mpop.replaceChildren(...list.map((x) => {
      const b = mk("button", null, "mopt"); b.type = "button"; b.setAttribute("role", "option");
      b.append(x.player_id === "all" ? mk("b", "@", "mall") : c.av(x.full_name, x.avatar), mk("span", x.player_id === "all" ? "Semua anggota" : x.full_name));
      b.onmousedown = (e) => e.preventDefault();  // jaga fokus kolom ketik
      b.onclick = () => {
        const nm = safeName(x.full_name), key = "@" + (x.player_id === "all" ? "semua" : nm), start = pos - m[2].length - 1;
        txt.value = txt.value.slice(0, start) + key + " " + txt.value.slice(pos); picked.set(key, [x.player_id, x.player_id === "all" ? "Semua" : nm]);
        mpop.hidden = true; txt.focus(); txt.dispatchEvent(new Event("input"));
      };
      return b;
    }));
    mpop.hidden = false;
  });

  /* ---------- admin grup / saluran ---------- */
  async function memberMenu(r, x) {
    const me = c.me().player_id, mine = x.player_id === me, iOwner = r.owner === me, acts = [{ key: "profile", label: "Lihat profil" }];
    if (r.is_admin && !mine && !x.room_owner) {
      if (!x.admin) acts.push({ key: "mk", label: "Jadikan admin" }); else if (iOwner) acts.push({ key: "rm", label: "Cabut status admin" });
      if (r.kind === "group" && (!x.admin || iOwner)) acts.push({ key: "kick", label: "Keluarkan dari grup", danger: true });
    }
    const a = await dialog({ title: x.full_name, desc: x.player_id + (x.admin ? " · admin" : ""), ok: null, actions: acts });
    if (!a) return;
    if (a.action === "profile") return c.showProfile(x.player_id);
    if (a.action === "kick" && !(await dialog({ title: "Keluarkan " + x.full_name + "?", desc: "Dia tidak lagi menjadi anggota grup ini.", ok: "Keluarkan" }))) return;
    try {
      if (a.action === "kick") await api("/rooms/" + r.id + "/kick", { method: "POST", body: JSON.stringify({ pid: x.player_id }) });
      else await api("/rooms/" + r.id + "/admin", { method: "POST", body: JSON.stringify({ pid: x.player_id, value: a.action === "mk" }) });
      toast(a.action === "kick" ? "Anggota dikeluarkan" : a.action === "mk" ? x.full_name + " sekarang admin" : "Status admin dicabut");
      await c.loadRooms(); c.showMembers(c.roomOf("R-" + r.id) || r);
    } catch (e) { toast(e.message); }
  }

  /* ---------- blokir kontak ---------- */
  async function loadBlocks() { try { (await api("/blocks")).blocks.forEach((b) => st.blocked.add(b.player_id)); } catch {} }
  async function blockToggle(pid) {
    const on = !st.blocked.has(pid), nm = c.nameOf(pid);
    if (on && !(await dialog({ title: "Blokir " + nm + "?", desc: "Pesan dan panggilan darinya tidak akan sampai ke kamu. Kamu juga tidak bisa mengirim pesan ke dia sampai blokirnya dibuka.", ok: "Blokir" }))) return;
    try { await api("/blocks", { method: "POST", body: JSON.stringify({ pid, value: on }) }); on ? st.blocked.add(pid) : st.blocked.delete(pid); toast(on ? nm + " diblokir" : "Blokir dibuka"); } catch (e) { toast(e.message); }
  }
  async function showBlocked() {
    let v; try { v = (await api("/blocks")).blocks; } catch (e) { return toast(e.message); }
    c.sheet("Kontak diblokir (" + v.length + ")", (box, close) => {
      if (!v.length) box.append(mk("p", "Belum ada kontak yang diblokir.", "dlg-d"));
      const ul = mk("ul", null, "list");
      v.forEach((b) => {
        const li = c.row(null, b.full_name, b.player_id, () => {}, {}), x = mk("button", "Buka blokir", "pinx"); x.type = "button";
        x.onclick = async (e) => { e.stopPropagation(); try { await api("/blocks", { method: "POST", body: JSON.stringify({ pid: b.player_id, value: false }) }); st.blocked.delete(b.player_id); li.remove(); toast("Blokir dibuka"); } catch (err) { toast(err.message); } };
        li.append(x); ul.append(li);
      });
      box.append(ul);
    });
  }
  async function loadChatState(p) {  // satu centang kalau diblokir, dua putih belum dibalas, dua biru sudah dibalas
    if (!p || p.startsWith("R-")) return;
    try {
      const r = await api("/chatstate?peer=" + encodeURIComponent(p)), cs = st.cs[p] || (st.cs[p] = {});
      cs.blocked = r.blocked; cs.last = Math.max(cs.last || 0, r.last);
      if (r.i_blocked) st.blocked.add(p); else st.blocked.delete(p);
      if (st.cur === p) c.refreshTicks();
    } catch {}
  }

  /* ---------- wallpaper chat ---------- */
  const WPS = [["kuning", "Kuning (bawaan)", ""], ["putih", "Putih", "#ffffff"], ["biru", "Biru muda", "#CFE8FF"], ["mint", "Mint", "#D4F5E0"], ["pink", "Merah muda", "#FFD6DE"],
    ["lavender", "Lavender", "#E6DCFF"], ["malam", "Malam", "#23232E"], ["garis", "Garis", "repeating-linear-gradient(45deg,#FFF3C4 0 14px,#FFE27A 14px 28px)"],
    ["petak", "Petak", "conic-gradient(#fff 25%,#EAF4FF 0 50%,#fff 0 75%,#EAF4FF 0) 0 0/36px 36px"]];
  const wpGet = (k) => { try { return JSON.parse(localStorage.getItem("wc_wp:" + k) || "null"); } catch { return null; } };
  function applyWp(p) {
    const el = $("#msgs"), v = wpGet(p) || wpGet("all"); el.style.background = "";
    if (!v) return;
    if (v.t === "i") el.style.background = 'center / cover no-repeat url("' + v.d + '")';
    else { const w = WPS.find((x) => x[0] === v.id); if (w && w[2]) el.style.background = w[2]; }
  }
  function wallpaperFor(p) {  // p = ID chat, atau null untuk semua chat dan saluran
    const key = p || "all";
    c.sheet(p ? "Wallpaper chat ini" : "Wallpaper semua chat", (box, close) => {
      const set = (v) => { try { v ? localStorage.setItem("wc_wp:" + key, JSON.stringify(v)) : localStorage.removeItem("wc_wp:" + key); } catch { return toast("Penyimpanan penuh, pilih gambar yang lebih kecil"); } if (st.cur) applyWp(st.cur); };
      const g = mk("div", null, "wpgrid");
      WPS.forEach(([id, nm, css]) => {
        const b = mk("button", nm, "wpsw"); b.type = "button"; if (css) b.style.background = css; if (id === "malam") b.style.color = "#fff";
        b.onclick = () => { set(id === "kuning" ? (p ? { t: "p", id: "kuning" } : null) : { t: "p", id }); toast("Wallpaper diganti"); close(); };
        g.append(b);
      });
      box.append(g);
      const gal = mk("button", "Pilih dari galeri", "btn full"); gal.type = "button";
      gal.onclick = async () => { const d = await c.pick(900, 0.65, 450000); if (d) { set({ t: "i", d }); toast("Wallpaper diganti"); close(); } };
      box.append(gal);
      if (wpGet(key)) { const r = mk("button", p ? "Pakai wallpaper umum" : "Kembalikan ke bawaan", "btn full ghost"); r.type = "button"; r.onclick = () => { set(null); toast("Wallpaper dikembalikan"); close(); }; box.append(r); }
    });
  }

  /* ---------- kunci aplikasi (PIN 4/6 digit atau sidik jari) ---------- */
  const LK = "wc_lock", LU = "wc_lock_until";
  const lkGet = () => { try { return JSON.parse(localStorage.getItem(LK) || "null"); } catch { return null; } };
  const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  async function hashPin(pin, saltHex) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16))), iterations: 150000, hash: "SHA-256" }, k, 256));
  }
  const bioOk = async () => !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false));
  async function bioEnroll() {
    const cred = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "WapChatt" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: c.me().player_id, displayName: c.me().full_name }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" }, timeout: 60000, attestation: "none" } });
    return b64u(cred.rawId);
  }
  const bioCheck = (id) => navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: unb64u(id), transports: ["internal"] }], userVerification: "required", timeout: 60000 } });
  function showLock() {
    const L = lkGet(), shade = document.getElementById("lockshade"); if (shade) shade.remove();
    if (!L || document.getElementById("lockscr")) return;
    const scr = mk("div", null, "lockscr"), dots = mk("div", null, "ldots"), msg = mk("p", "", "lmsg"), pad = mk("div", null, "lpad"); scr.id = "lockscr";
    scr.setAttribute("role", "dialog"); scr.setAttribute("aria-modal", "true"); scr.setAttribute("aria-label", "Aplikasi terkunci"); msg.setAttribute("role", "alert");
    let pin = "";
    const paint = () => dots.replaceChildren(...Array.from({ length: L.len }, (_, i) => mk("i", null, i < pin.length ? "on" : "")));
    const open = () => { scr.remove(); localStorage.removeItem(LU); };
    const bio = async () => { try { await bioCheck(L.bio); open(); } catch { msg.textContent = "Sidik jari tidak dikenali. Gunakan PIN."; } };
    const wait = () => Math.max(0, (+localStorage.getItem(LU) || 0) - Date.now());
    let fails = 0;
    const submit = async () => {
      if (wait()) { pin = ""; paint(); msg.textContent = "Terlalu banyak percobaan. Coba lagi " + Math.ceil(wait() / 1000) + " detik."; return; }
      if (await hashPin(pin, L.salt) === L.hash) return open();
      pin = ""; paint(); scr.classList.add("shake"); setTimeout(() => scr.classList.remove("shake"), 400);
      if (++fails >= 5) { fails = 0; localStorage.setItem(LU, String(Date.now() + 30000)); msg.textContent = "Terlalu banyak percobaan. Coba lagi 30 detik."; } else msg.textContent = "PIN salah";
    };
    const press = (d) => { if (pin.length >= L.len) return; pin += d; msg.textContent = ""; paint(); if (pin.length === L.len) submit(); };
    [1, 2, 3, 4, 5, 6, 7, 8, 9, "bio", 0, "del"].forEach((k) => {
      const b = mk("button", null, "lkey"); b.type = "button";
      if (k === "bio") { if (L.bio) { b.textContent = "Sidik jari"; b.classList.add("sm"); b.onclick = bio; } else { b.disabled = true; b.className = "lkey ghost"; } }
      else if (k === "del") { b.textContent = "\u232B"; b.setAttribute("aria-label", "Hapus"); b.onclick = () => { pin = pin.slice(0, -1); paint(); }; }
      else { b.textContent = k; b.onclick = () => press(String(k)); }
      pad.append(b);
    });
    const out = mk("button", "Lupa PIN? Keluar dari akun", "plink"); out.type = "button";
    out.onclick = () => { localStorage.removeItem(LK); localStorage.removeItem(LU); scr.remove(); $("#logout").click(); };
    scr.append(mk("img", null, "llogo"), mk("h2", "WapChatt terkunci"), mk("p", "Masukkan PIN " + L.len + " digit", "lsub"), dots, msg, pad, out);
    scr.querySelector("img").src = "logo.png"; scr.querySelector("img").alt = "";
    paint(); document.body.append(scr);
    document.addEventListener("keydown", function k(e) { if (!document.getElementById("lockscr")) return document.removeEventListener("keydown", k); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") { pin = pin.slice(0, -1); paint(); } });
    if (L.bio) bio();
  }
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {  // terkunci lagi setelah aplikasi ditinggalkan lebih dari 30 detik
    if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 30000 && lkGet()) showLock();
  });
  async function askPin(title, L) {  // minta PIN lama sebelum mengubah / mematikan kunci
    const x = await dialog({ title, fields: [{ name: "p", label: "PIN saat ini", type: "password", inputmode: "numeric", max: 6, required: true }], ok: "Lanjut" });
    if (!x) return false;
    if (await hashPin(x.p, L.salt) === L.hash) return true;
    toast("PIN salah"); return false;
  }
  async function setPin(len, old) {
    const x = await dialog({ title: "Atur PIN " + len + " digit", fields: [{ name: "p", label: "PIN baru", type: "password", inputmode: "numeric", max: len, required: true }, { name: "p2", label: "Ulangi PIN", type: "password", inputmode: "numeric", max: len, required: true }], ok: "Simpan" });
    if (!x) return;
    if (!new RegExp("^\\d{" + len + "}$").test(x.p)) return toast("PIN harus " + len + " angka");
    if (x.p !== x.p2) return toast("Kedua PIN tidak sama");
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(LK, JSON.stringify({ len, salt, hash: await hashPin(x.p, salt), bio: old && old.bio || "" })); toast("Kunci aplikasi aktif"); updLock();
  }
  async function lockSettings() {
    const L = lkGet(), canBio = await bioOk(), acts = [{ key: "p4", label: "PIN 4 digit" }, { key: "p6", label: "PIN 6 digit" }];
    if (L && canBio) acts.push({ key: "bio", label: L.bio ? "Matikan sidik jari" : "Aktifkan sidik jari" });
    if (L) acts.push({ key: "off", label: "Matikan kunci aplikasi", danger: true });
    const x = await dialog({ title: "Kunci aplikasi", desc: L ? "Aktif: PIN " + L.len + " digit" + (L.bio ? " + sidik jari" : "") : "Belum aktif. Pilih PIN dulu; sidik jari bisa ditambahkan setelahnya.", ok: null, actions: acts });
    if (!x) return;
    if (L && !(await askPin("Konfirmasi", L))) return;
    try {
      if (x.action === "p4") await setPin(4, L); else if (x.action === "p6") await setPin(6, L);
      else if (x.action === "bio") { L.bio = L.bio ? "" : await bioEnroll(); localStorage.setItem(LK, JSON.stringify(L)); toast(L.bio ? "Sidik jari aktif" : "Sidik jari dimatikan"); updLock(); }
      else if (x.action === "off") { localStorage.removeItem(LK); toast("Kunci aplikasi dimatikan"); updLock(); }
    } catch (e) { toast("Gagal: " + (e.message || "dibatalkan")); }
  }
  const updLock = () => { const L = lkGet(), s = $("#lockbtn small"); if (s) s.textContent = L ? "Aktif · PIN " + L.len + " digit" + (L.bio ? " + sidik jari" : "") : "PIN 4 atau 6 digit, atau sidik jari"; };
  $("#lockbtn").onclick = lockSettings; updLock();

  /* ---------- pasang aplikasi + notifikasi ---------- */
  let pushKey = "", pushOk = false;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const getPrompt = () => window.__wcInstall || null;  // sinyal siap-dipasang ditangkap lebih awal di <head> dashboard.html
  const updInst = () => { const s = $("#instbtn small"); if (s) s.textContent = standalone() ? "Sudah terpasang di perangkat ini" : getPrompt() ? "Ketuk untuk memasang" : "Unduh WapChatt ke layar utama"; };
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__wcInstall = e; updInst(); });
  window.addEventListener("appinstalled", () => { window.__wcInstall = null; toast("Aplikasi terpasang"); updInst(); });
  $("#instbtn").onclick = async () => {
    if (standalone()) return toast("Aplikasi sudah terpasang di perangkat ini");
    const p = getPrompt();
    if (p) {  // satu ketukan: langsung muncul kotak "Pasang aplikasi" dari browser
      p.prompt(); const r = await p.userChoice.catch(() => ({})); window.__wcInstall = null; updInst();
      return r.outcome === "accepted" ? toast("Memasang aplikasi...") : undefined;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), issues = [];  // cari tahu kenapa browser belum menawarkan pemasangan
    try { const r = await fetch("/manifest.json", { cache: "no-store" }); if (!r.ok) issues.push("manifest tidak ditemukan (status " + r.status + ")"); else { const m = await r.json(); const ic = await fetch(m.icons[0].src, { cache: "no-store" }); if (!ic.ok) issues.push("ikon tidak ditemukan (status " + ic.status + ")"); } } catch { issues.push("manifest tidak bisa dimuat"); }
    try { if (!(await navigator.serviceWorker.getRegistration())) issues.push("service worker belum aktif, muat ulang halaman lalu coba lagi"); } catch { issues.push("service worker tidak didukung"); }
    dialog({ title: "Pasang aplikasi", desc: ios ? "Buka lewat Safari, ketuk tombol Bagikan, lalu pilih Tambah ke Layar Utama."
      : issues.length ? "Belum bisa dipasang: " + issues.join("; ") + "." : "Semua syarat sudah terpenuhi, tapi browser belum menawarkan tombol pasang. Muat ulang halaman, tunggu beberapa detik, lalu ketuk lagi. Kalau tetap belum, buka menu browser (titik tiga) lalu pilih Instal aplikasi.", ok: null });
  };
  updInst(); setTimeout(updInst, 3000);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.open) c.open(e.data.open); });  // ketuk notifikasi: buka chat-nya
  }
  const NK = "wc_notif", perm = () => ("Notification" in window ? Notification.permission : "unsupported");
  const notOn = () => localStorage.getItem(NK) === "1" && perm() === "granted";
  const updNot = () => {  // tulisan kecil selalu menunjukkan keadaan sebenarnya
    const s = $("#notbtn small"); if (!s) return; const p = perm();
    s.textContent = p === "unsupported" ? "Tidak didukung di browser ini" : p === "denied" ? "Diblokir di browser. Ketuk untuk cara membukanya"
      : notOn() ? (pushOk ? "Aktif, termasuk saat aplikasi ditutup" : "Aktif saat aplikasi terbuka") : p === "granted" ? "Izin sudah ada. Ketuk untuk menyalakan" : "Ketuk untuk menyalakan";
  };
  const key64 = (s) => Uint8Array.from(atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  async function pushSub(on) {  // langganan push dari server supaya notifikasi tetap masuk walau aplikasi tertutup (butuh kunci VAPID di server)
    try {
      const reg = await navigator.serviceWorker.ready; if (!reg.pushManager) return;
      pushKey = (await api("/push/key")).key || ""; let sub = await reg.pushManager.getSubscription();
      if (!on) { pushOk = false; if (sub) { await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } return; }
      if (!pushKey) return;
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key64(pushKey) });
      await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) }); pushOk = true;
    } catch { pushOk = false; } finally { updNot(); }
  }
  $("#notbtn").onclick = async () => {
    let p = perm();
    if (p === "unsupported") return dialog({ title: "Notifikasi tidak didukung", desc: "Browser ini belum mendukung notifikasi. Pasang aplikasinya atau pakai Chrome atau Safari terbaru.", ok: null });
    if (notOn()) { localStorage.setItem(NK, "0"); await pushSub(false); updNot(); return toast("Notifikasi dimatikan"); }
    if (p === "default") p = await Notification.requestPermission();  // kalau izin sudah diberikan, tidak ditanya lagi
    if (p !== "granted") {
      updNot();
      return dialog({ title: "Izin notifikasi belum aktif", desc: "Browser memblokir notifikasi untuk situs ini. Ketuk ikon di sebelah alamat situs (gembok atau pengaturan), buka Izin atau Setelan situs, ubah Notifikasi menjadi Izinkan, lalu muat ulang halaman dan ketuk tombol ini lagi.", ok: null });
    }
    localStorage.setItem(NK, "1"); await pushSub(true); updNot();
    showNotif("Notifikasi aktif", { body: "Pesan dan panggilan akan muncul di sini.", tag: "tes" });  // percobaan: kalau ini muncul, notifikasi sudah berfungsi
    toast("Notifikasi dinyalakan");
  };
  if (notOn()) pushSub(true); else updNot();
  async function showNotif(title, o) {
    try { (await navigator.serviceWorker.ready).showNotification(title, Object.assign({ icon: "/logo.png", badge: "/logo.png", renotify: true }, o)); }
    catch { try { new Notification(title, o); } catch {} }
  }
  function notify(m, key) {  // pesan masuk saat aplikasi di latar belakang
    if (!notOn()) return;
    const room = c.roomOf(key), body = c.lastText(m.body);
    showNotif(room ? room.name : c.nameOf(m.sender), { body: room ? c.nameOf(m.sender) + ": " + body : body, tag: "chat-" + key, data: { peer: key } });
  }
  function notifyCall(name, from, video) {
    if (notOn()) showNotif(name, { body: "Panggilan " + (video ? "video" : "suara") + " masuk", tag: "call-" + from, requireInteraction: true, vibrate: [300, 150, 300, 150, 300], data: { peer: from } });
  }

  $("#form").addEventListener("submit", () => { mpop.hidden = true; });
  $("#blockbtn").onclick = showBlocked;
  $("#wpbtn").onclick = () => wallpaperFor(null);

  /* ---------- belum dibaca (disimpan di server) ---------- */
  async function loadUnread() {
    try {
      const r = (await api("/unread")).unread;  // server = sumber kebenaran (juga menangkap chat yang sudah dibaca di perangkat lain)
      st.unread = Object.assign({}, r); if (st.cur) st.unread[st.cur] = 0; c.render();
    } catch {}
  }
  const readQ = new Set(); let readT = 0;
  function markRead(p) {  // ditunda sebentar supaya banyak pesan beruntun jadi satu permintaan
    readQ.add(p); clearTimeout(readT);
    readT = setTimeout(() => { [...readQ].forEach((k) => api("/read", { method: "POST", body: JSON.stringify({ peer: k }) }).catch(() => {})); readQ.clear(); }, 1200);
  }

  /* ---------- owner: detail pengguna ---------- */
  const when = (t) => (t ? new Date(t).toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
  async function userDetail(pid) {
    let u; try { u = (await api("/admin/users/" + encodeURIComponent(pid))).user; } catch (err) { return toast(err.message); }
    c.sheet(u.full_name, (box) => {
      const yn = (v) => (v ? "Ya" : "Tidak");
      [["ID", u.player_id], ["Email", u.email], ["Umur", u.age + " tahun (lahir " + u.birth_year + ")"], ["Bio", u.status || "Belum ada bio"],
        ["Terdaftar", when(u.created_at)], ["Terakhir dilihat", u.online ? "online sekarang" : when(u.last_seen)],
        ["Peran", u.owner ? "Owner" : "Pengguna"], ["Centang biru", yn(u.verified)], ["Diblokir", yn(u.banned)],
        ["Profil publik", yn(u.public)], ["Tampilkan terakhir dilihat", yn(u.show_seen)],
        ["Kontak tersimpan", String(u.contacts)], ["Disimpan oleh", u.saved_by + " orang"],
        ["Pesan terkirim", u.sent + " (" + u.sent24 + " dalam 24 jam)"], ["Pesan diterima", String(u.received)], ["Status aktif", String(u.stories)],
      ].forEach(([k, v]) => box.append(c.irow(k, v)));
      box.append(mk("p", "Grup dan saluran (" + u.rooms_total + ")", "dlg-l"));
      if (!u.rooms.length) box.append(mk("p", "Belum bergabung ke grup atau saluran.", "dlg-d"));
      const ul = mk("ul", null, "list");
      u.rooms.forEach((r) => ul.append(c.row(null, r.name, (r.kind === "group" ? "Grup" : "Saluran") + " · " + r.count + " anggota" + (r.owned ? " · dimiliki" : ""), () => {}, {})));
      box.append(ul);
    });
  }

  showLock();  // tampilkan layar kunci kalau aktif
  const sb = $("#starbtn"); if (sb) sb.onclick = showStars;
  loadStars();

  return {
    preview, fill, menuBtn, showPins, showStars, shareLink, consumeLink, loadUnread, markRead, userDetail,
    rich, encodeMentions, memberMenu, blockToggle, loadBlocks, wallpaperFor, notify, notifyCall,
    opened() { pins = []; canPin = false; pinIdx = 0; paintBar(); loadPins(); applyWp(st.cur); loadChatState(st.cur); picked.clear(); mpop.hidden = true; },  // dipanggil tiap chat dibuka
  };
};
