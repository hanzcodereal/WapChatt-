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
  setInterval(() => { if (st.cur && !$("#room").hidden) loadPins(); }, 15000);  // sematan dari lawan bicara ikut muncul

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
    acts.push({ key: "star", label: stars.has(id) ? "Hapus bintang" : "Beri bintang" });
    if (canPin) acts.push({ key: "pin", label: pinned ? "Lepas sematan pesan" : "Sematkan pesan" });
    if (!sid && txt) acts.push({ key: "copy", label: "Salin teks" });
    if (sid && !mine) acts.push({ key: "stk", label: "Simpan stiker" });
    if (mine) acts.push({ key: "del", label: "Hapus pesan", danger: true });
    const x = await dialog({ title: "Pesan", ok: null, actions: acts });
    if (!x) return;
    if (x.action === "reply") c.startReply(id);
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
    menuBtn, showPins, showStars, shareLink, consumeLink,
    opened() { pins = []; canPin = false; pinIdx = 0; paintBar(); loadPins(); },  // dipanggil tiap chat dibuka
  };
};
