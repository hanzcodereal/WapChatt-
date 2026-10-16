/* Fitur tambahan WapChatt. Dimuat SEBELUM script.js; script.js memanggil window.WCX(ctx) sekali setelah dashboard siap.
   Isi: sematkan pesan (24 jam / 7 hari / 30 hari / tanpa batas), bintang pesan, menu titik tiga di tiap pesan. */
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
    body.replaceChildren(mk("small", q.count + " jawaban · jawaban anonim, tanpa nama atau ID"));
    const row = mk("div", null, "qbtns"), ans = mk("button", mine ? "Ubah jawabanku" : "Jawab", "btn"), see = mk("button", "Lihat jawaban (" + q.count + ")", "btn ghost");
    ans.type = see.type = "button";
    ans.onclick = async () => {
      const x = await dialog({ title: "Jawab pertanyaan", desc: "Jawabanmu anonim. Tidak ada nama atau ID yang tampil ke siapa pun, termasuk admin saluran.", fields: [{ name: "t", label: "Jawabanmu", multiline: true, max: 500, value: mine ? mine.text : "", required: true }], ok: "Kirim" });
      if (!x) return;
      try { renderQna(w, (await api("/questions/" + q.id + "/answer", { method: "POST", body: JSON.stringify({ text: x.t }) })).q); toast("Jawaban terkirim secara anonim"); } catch (e) { toast(e.message); }
    };
    see.onclick = () => showAnswers(w, q);
    row.append(ans, see); body.append(row);
  }
  function showAnswers(w, q) {
    c.sheet("Jawaban (" + q.count + ")", (box) => {
      if (!q.answers.length) box.append(mk("p", "Belum ada jawaban.", "dlg-d"));
      const ul = mk("ul", null, "list");
      q.answers.forEach((a) => {
        const li = c.row(null, a.mine ? "Anonim (jawabanmu)" : "Anonim", a.text, () => {}, { time: c.short(a.t) });
        if (a.mine || q.is_owner) {
          const x = mk("button", "Hapus", "pinx"); x.type = "button";
          x.onclick = async (ev) => { ev.stopPropagation(); try { await api("/answers/" + a.id, { method: "DELETE" }); li.remove(); loadQna(w); } catch (e) { toast(e.message); } };
          li.append(x);
        }
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
    if (r && r.kind === "channel" && r.owner === c.me().player_id) acts.push({ key: "qna", label: "Pertanyaan (dijawab anonim oleh pengikut)" });
    const x = await dialog({ title: "Buat", ok: null, actions: acts }); if (!x) return;
    try {
      if (x.action === "poll") { const p = await pollDialog(); if (p) posted(await api("/polls", { method: "POST", body: JSON.stringify({ to, ...p }) })); }
      else {
        const q = await dialog({ title: "Pertanyaan untuk pengikut", desc: "Pengikut menjawab secara anonim. Kamu pun hanya melihat isi jawaban, tanpa nama atau ID.", fields: [{ name: "q", label: "Pertanyaan", multiline: true, max: 300, required: true }], ok: "Kirim" });
        if (q) posted(await api("/questions", { method: "POST", body: JSON.stringify({ to, question: q.q }) }));
      }
    } catch (err) { toast(err.message); }
  };

  /* ---------- teruskan pesan ---------- */
  async function forwardMsg(m) {
    if (POLL.test(m.body) || QNA.test(m.body)) return toast("Polling dan pertanyaan tidak bisa diteruskan.");
    const me = c.me(), t = [
      ...st.contacts.filter((x) => x.player_id !== c.OFFICIAL).map((x) => ({ player_id: x.player_id, full_name: x.full_name, avatar: x.avatar })),
      ...st.rooms.filter((r) => r.joined && (r.kind === "group" || r.owner === me.player_id)).map((r) => ({ player_id: "R-" + r.id, full_name: r.name + (r.kind === "group" ? " (grup)" : " (saluran)"), avatar: r.avatar })),
      { player_id: me.player_id, full_name: "Catatan saya", avatar: me.avatar }];
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
  setInterval(() => { if (st.cur && !$("#room").hidden) { loadPins(); refreshWidgets(); } }, 15000);  // sematan dari lawan bicara ikut muncul

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
    else if (x.action === "copy") navigator.clipboard.writeText(txt).then(() => toast("Teks disalin"), () => toast("Gagal menyalin"));
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
    const m = /^([ucg]):(.+)$/.exec(v || ""); if (!m) return;
    const k = m[1], val = m[2];
    try {
      if (k === "u" && /^[A-Za-z0-9]{1,12}$/.test(val)) return c.showProfile(val);
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

  const sb = $("#starbtn"); if (sb) sb.onclick = showStars;
  loadStars();

  return {
    preview, fill, menuBtn, showPins, showStars, shareLink, consumeLink,
    opened() { pins = []; canPin = false; pinIdx = 0; paintBar(); loadPins(); },  // dipanggil tiap chat dibuka
  };
};
