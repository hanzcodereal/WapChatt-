"""Fitur tambahan WapChatt (file terpisah supaya app.py tidak terlalu panjang).

- Sematkan pesan       : tabel pinned_msgs (24 jam / 7 hari / 30 hari / tanpa batas)
- Polling              : tabel polls, poll_options, poll_votes (grup, chat pribadi, saluran; di saluran suara anonim)
- Pertanyaan saluran   : tabel questions, q_answers (admin tidak bisa menjawab; hanya admin yang melihat nama + ID penjawab, pengikut lain tidak)
- Balas jawaban        : tabel q_replies (admin membalas penjawab, penjawab membalas admin; hanya label peran yang tampil)
- Detail pengguna      : GET /api/admin/users/<id> (khusus owner; hanya data akun dan angka ringkasan, isi pesan tidak pernah dikirim)
- Blokir kontak        : tabel blocks + undelivered (pesan dari yang diblokir tidak sampai; pengirim melihat satu centang)
- Admin grup/saluran   : tabel room_admins (jadikan admin, keluarkan anggota grup)
- Durasi panggilan     : tabel call_times
- Notifikasi push      : tabel push_subs (opsional; butuh pywebpush + VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)
- Teruskan pesan       : POST /api/forward
- Link grup            : tabel room_invites (kode undangan acak per grup; link saluran dan profil tidak butuh tabel)
- Bintangi pesan       : tabel star_msgs (pribadi, hanya terlihat pemilik)
- Centang biru saluran : tabel room_flags (otomatis di 1000 pengikut, atau diatur owner)

Semua tabel BARU, jadi database Neon yang sudah ada tidak perlu migrasi (dibuat otomatis oleh init_db()).
"""
import os, re, json, secrets
from datetime import datetime, timedelta
from flask import request, jsonify, redirect
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, func, or_, and_, select
from database import Base, Message, Room, RoomMember, User, Contact, Profile, ProfileExt, Story

VERIFY_AT = 1000           # jumlah pengikut untuk centang biru otomatis
MAX_PINS = 3               # jumlah pesan yang bisa disematkan per chat
MAX_FWD = 5                # maksimal tujuan sekali teruskan (seperti WhatsApp)
POLL_RE = re.compile(r"^\[poll:(\d+)\]")
QNA_RE = re.compile(r"^\[qna:(\d+)\]")
OFFICIAL = "NOVA"          # diisi ulang oleh register()
PIN_HOURS = {24, 168, 720}  # 24 jam, 7 hari, 30 hari (0 / kosong = tanpa batas)


class PinnedMsg(Base):
    __tablename__ = "pinned_msgs"
    id = Column(Integer, primary_key=True)
    chat = Column(String(30), nullable=False, index=True)   # "R-<id>" atau "idA:idB" (diurutkan)
    msg_id = Column(Integer, nullable=False, index=True)
    by = Column(String(12), nullable=False)
    expires = Column(DateTime, nullable=True)               # None = tanpa batas
    created_at = Column(DateTime, server_default=func.now())


class StarMsg(Base):
    __tablename__ = "star_msgs"
    id = Column(Integer, primary_key=True)
    owner = Column(String(12), nullable=False, index=True)
    msg_id = Column(Integer, nullable=False, index=True)


class Poll(Base):
    __tablename__ = "polls"
    id = Column(Integer, primary_key=True)
    msg_id = Column(Integer, index=True)
    chat = Column(String(12), nullable=False, index=True)   # to_id pesan: "R-<id>" atau ID pengguna
    owner = Column(String(12), nullable=False, index=True)
    question = Column(String(200), nullable=False)
    multi = Column(Boolean, default=False)
    anon = Column(Boolean, default=False)                     # saluran: pemilih tidak ditampilkan


class PollOption(Base):
    __tablename__ = "poll_options"
    id = Column(Integer, primary_key=True)
    poll_id = Column(Integer, nullable=False, index=True)
    idx = Column(Integer, nullable=False)
    text = Column(String(100), nullable=False)


class PollVote(Base):
    __tablename__ = "poll_votes"
    id = Column(Integer, primary_key=True)
    poll_id = Column(Integer, nullable=False, index=True)
    voter = Column(String(12), nullable=False, index=True)
    opt = Column(Integer, nullable=False)


class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True)
    msg_id = Column(Integer, index=True)
    chat = Column(String(12), nullable=False, index=True)
    owner = Column(String(12), nullable=False, index=True)
    question = Column(String(300), nullable=False)


class QAnswer(Base):
    __tablename__ = "q_answers"
    id = Column(Integer, primary_key=True)
    q_id = Column(Integer, nullable=False, index=True)
    author = Column(String(12), nullable=False, index=True)   # hanya dipakai server (ganti/hapus jawaban sendiri), TIDAK PERNAH dikirim ke klien
    text = Column(String(500), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class QReply(Base):
    __tablename__ = "q_replies"
    id = Column(Integer, primary_key=True)
    answer_id = Column(Integer, nullable=False, index=True)
    author = Column(String(12), nullable=False, index=True)   # admin saluran atau penjawab aslinya
    text = Column(String(300), nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class ChatRead(Base):
    __tablename__ = "chat_reads"
    id = Column(Integer, primary_key=True)
    owner = Column(String(12), nullable=False, index=True)
    peer = Column(String(12), nullable=False, index=True)    # ID lawan bicara atau "R-<id>"
    last_id = Column(Integer, nullable=False, default=0)     # pesan dengan id <= ini sudah dibaca


class Block(Base):
    __tablename__ = "blocks"
    id = Column(Integer, primary_key=True)
    owner = Column(String(12), nullable=False, index=True)    # yang memblokir
    target = Column(String(12), nullable=False, index=True)   # yang diblokir


class Undelivered(Base):
    __tablename__ = "undelivered"
    msg_id = Column(Integer, primary_key=True)                # pesan yang dikirim ke orang yang memblokir pengirimnya


class RoomAdmin(Base):
    __tablename__ = "room_admins"
    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, nullable=False, index=True)
    player_id = Column(String(12), nullable=False, index=True)


class CallTime(Base):
    __tablename__ = "call_times"
    call_id = Column(Integer, primary_key=True)
    started = Column(DateTime, nullable=False)
    secs = Column(Integer, nullable=True)


class PushSub(Base):
    __tablename__ = "push_subs"
    id = Column(Integer, primary_key=True)
    owner = Column(String(12), nullable=False, index=True)
    endpoint = Column(Text, nullable=False)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)


class RoomInvite(Base):
    __tablename__ = "room_invites"
    room_id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False, index=True)


class RoomFlag(Base):
    __tablename__ = "room_flags"
    room_id = Column(Integer, primary_key=True)
    verified = Column(Boolean, nullable=True)   # None = aturan otomatis, True = beri centang, False = cabut


def mask_email(e):
    """budi.santoso@gmail.com -> bu*******@g****.com (email utuh tidak pernah dikirim ke klien)"""
    name, _, dom = (e or "").partition("@")
    host, _, tld = dom.rpartition(".")
    return name[:2] + "*" * max(3, len(name) - 2) + "@" + (host[:1] + "*" * max(3, len(host) - 1) if host else "***") + ("." + tld if tld else "")


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


# ---------- centang biru saluran ----------
def room_flags(db):
    return {f.room_id: f.verified for f in db.query(RoomFlag) if f.verified is not None}


def room_verified(flags, r, count):
    if r.kind != "channel":
        return False
    v = flags.get(r.id)
    return v if v is not None else count >= VERIFY_AT


# ---------- akses ----------
def chat_key(me, peer):
    return peer if peer.startswith("R-") else ":".join(sorted([me, peer]))


def room_of(peer):
    return int(peer[2:]) if peer.startswith("R-") and peer[2:].isdigit() else None


def can_chat(db, me, peer):
    rid = room_of(peer)
    if peer.startswith("R-"):
        return rid is not None and bool(db.query(RoomMember.id).filter_by(room_id=rid, player_id=me).first())
    return bool(db.query(User.id).filter_by(player_id=peer).first())


def can_see(db, me, m):
    if m.sender == me or m.to_id == me:
        return True
    rid = room_of(m.to_id)
    return rid is not None and bool(db.query(RoomMember.id).filter_by(room_id=rid, player_id=me).first())


def in_chat(m, me, peer):
    if peer.startswith("R-"):
        return m.to_id == peer
    return {m.sender, m.to_id} == {me, peer}


def undelivered():
    return select(Undelivered.msg_id)


def is_blocked(db, owner, target):
    return bool(db.query(Block.id).filter_by(owner=owner, target=target).first())


def is_admin(db, r, pid):
    """Pemilik selalu admin; admin lain dicatat di room_admins."""
    return bool(r) and (r.owner == pid or bool(db.query(RoomAdmin.id).filter_by(room_id=r.id, player_id=pid).first()))


def admin_ids(db, rid):
    return {a.player_id for a in db.query(RoomAdmin).filter_by(room_id=rid)}


def my_admin_rooms(db, me):
    return {a.room_id for a in db.query(RoomAdmin).filter_by(player_id=me)}


def drop_admin(db, rid, pid):
    db.query(RoomAdmin).filter_by(room_id=rid, player_id=pid).delete(synchronize_session=False)


def call_start(db, call_id):
    if not db.get(CallTime, call_id):
        db.add(CallTime(call_id=call_id, started=datetime.utcnow()))


def call_end(db, a, b):
    """Dipanggil saat salah satu pihak mengirim 'end': hitung durasi panggilan terjawab terakhir antara a dan b."""
    from database import Call
    c = db.query(Call).filter(or_(and_(Call.caller == a, Call.callee == b), and_(Call.caller == b, Call.callee == a))).order_by(Call.id.desc()).first()
    t = db.get(CallTime, c.id) if c and c.status == "answered" else None  # panggilan terakhir harus yang terjawab, bukan panggilan lama
    if t and t.secs is None:
        t.secs = max(0, int((datetime.utcnow() - t.started).total_seconds()))


def call_secs(db, ids):
    return {t.call_id: t.secs for t in db.query(CallTime).filter(CallTime.call_id.in_(ids))} if ids else {}


def plain_preview(b):
    b = re.sub(r"^\[(re:\d+|st:[^\]]*|fwd)\]", "", b or "")
    if b.startswith("[stk:"):
        return "Stiker"
    for tag, lab in (("[poll:", "Polling: "), ("[qna:", "Pertanyaan: ")):
        if b.startswith(tag):
            return lab + b.split("]", 1)[-1]
    return re.sub(r"@\[[^|\]]*\|([^\]]*)\]", r"@\1", b)[:120]


def push_enabled():
    return bool(os.getenv("VAPID_PRIVATE_KEY") and os.getenv("VAPID_PUBLIC_KEY"))


def push_to(db, owners, payload):
    """Kirim Web Push ke perangkat milik 'owners'. Diam-diam dilewati kalau pywebpush / kunci VAPID belum dipasang."""
    if not owners or not push_enabled():
        return
    try:
        from pywebpush import webpush, WebPushException
    except Exception:
        return
    for sub in db.query(PushSub).filter(PushSub.owner.in_(list(owners))).limit(40).all():
        try:
            webpush(subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps(payload), vapid_private_key=os.getenv("VAPID_PRIVATE_KEY"),
                    vapid_claims={"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")}, timeout=3, ttl=3600)
        except WebPushException as e:
            if getattr(e, "response", None) is not None and e.response.status_code in (404, 410):
                db.delete(sub)
        except Exception:
            pass
    db.commit()


def notify_send(db, m, sender_name):
    """Hook setelah pesan tersimpan: push untuk pesan baru dan panggilan masuk."""
    if not push_enabled() or db.get(Undelivered, m.id):
        return
    if m.kind == "sig":
        try:
            s = json.loads(m.body)
        except ValueError:
            return
        if s.get("type") == "offer":
            push_to(db, [m.to_id], {"title": sender_name, "body": "Panggilan video masuk" if (s.get("data") or {}).get("video") else "Panggilan suara masuk",
                                    "tag": "call-" + m.sender, "peer": m.sender, "call": True})
        return
    if m.to_id.startswith("R-"):
        rid = room_of(m.to_id)
        r = db.get(Room, rid) if rid else None
        if not r:
            return
        owners = [x.player_id for x in db.query(RoomMember).filter(RoomMember.room_id == rid, RoomMember.player_id != m.sender).limit(20)]
        push_to(db, owners, {"title": r.name, "body": sender_name + ": " + plain_preview(m.body), "tag": "chat-" + m.to_id, "peer": m.to_id})
    else:
        push_to(db, [m.to_id], {"title": sender_name, "body": plain_preview(m.body), "tag": "chat-" + m.sender, "peer": m.sender})


def can_post(db, me, to):
    """Aturan sama dengan /api/send: saluran hanya pemilik, grup anggota, chat pribadi ke pengguna yang ada."""
    if to == OFFICIAL:
        return False
    rid = room_of(to)
    if to.startswith("R-"):
        r = db.get(Room, rid) if rid else None
        return bool(r) and bool(db.query(RoomMember.id).filter_by(room_id=r.id, player_id=me).first()) and (r.kind == "group" or is_admin(db, r, me))
    return bool(db.query(User.id).filter_by(player_id=to).first())


def room_kind(db, to):
    rid = room_of(to)
    r = db.get(Room, rid) if rid else None
    return r.kind if r else None


def can_pin_in(db, me, peer):
    rid = room_of(peer)
    if rid is None:
        return can_chat(db, me, peer)
    r = db.get(Room, rid)
    return bool(r) and can_chat(db, me, peer) and (r.kind == "group" or is_admin(db, r, me))  # saluran: pemilik dan admin


def drop_polls(db, cond):
    ids = [i for (i,) in db.query(Poll.id).filter(cond)]
    if ids:
        for M in (PollVote, PollOption):
            db.query(M).filter(M.poll_id.in_(ids)).delete(synchronize_session=False)
        db.query(Poll).filter(Poll.id.in_(ids)).delete(synchronize_session=False)


def drop_questions(db, cond):
    ids = [i for (i,) in db.query(Question.id).filter(cond)]
    if ids:
        aids = [i for (i,) in db.query(QAnswer.id).filter(QAnswer.q_id.in_(ids))]
        if aids:
            db.query(QReply).filter(QReply.answer_id.in_(aids)).delete(synchronize_session=False)
        db.query(QAnswer).filter(QAnswer.q_id.in_(ids)).delete(synchronize_session=False)
        db.query(Question).filter(Question.id.in_(ids)).delete(synchronize_session=False)


def on_msg_delete(db, m):
    drop_polls(db, Poll.msg_id == m.id)
    drop_questions(db, Question.msg_id == m.id)
    db.query(PinnedMsg).filter(PinnedMsg.msg_id == m.id).delete(synchronize_session=False)
    db.query(StarMsg).filter(StarMsg.msg_id == m.id).delete(synchronize_session=False)


def on_room_purge(db, rid):
    tag = "R-%d" % rid
    db.query(ChatRead).filter(ChatRead.peer == tag).delete(synchronize_session=False)
    db.query(RoomAdmin).filter(RoomAdmin.room_id == rid).delete(synchronize_session=False)
    drop_polls(db, Poll.chat == tag)
    drop_questions(db, Question.chat == tag)
    mids = [i for (i,) in db.query(Message.id).filter(Message.to_id == tag)]
    if mids:
        db.query(StarMsg).filter(StarMsg.msg_id.in_(mids)).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.chat == tag).delete(synchronize_session=False)
    db.query(RoomFlag).filter(RoomFlag.room_id == rid).delete(synchronize_session=False)
    db.query(RoomInvite).filter(RoomInvite.room_id == rid).delete(synchronize_session=False)


def on_user_purge(db, pid):
    db.query(Block).filter(or_(Block.owner == pid, Block.target == pid)).delete(synchronize_session=False)
    db.query(RoomAdmin).filter(RoomAdmin.player_id == pid).delete(synchronize_session=False)
    db.query(PushSub).filter(PushSub.owner == pid).delete(synchronize_session=False)
    db.query(ChatRead).filter(or_(ChatRead.owner == pid, ChatRead.peer == pid)).delete(synchronize_session=False)
    drop_polls(db, or_(Poll.owner == pid, Poll.chat == pid))
    drop_questions(db, or_(Question.owner == pid, Question.chat == pid))
    db.query(PollVote).filter(PollVote.voter == pid).delete(synchronize_session=False)
    db.query(QReply).filter(QReply.author == pid).delete(synchronize_session=False)
    db.query(QAnswer).filter(QAnswer.author == pid).delete(synchronize_session=False)
    db.query(StarMsg).filter(StarMsg.owner == pid).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.by == pid).delete(synchronize_session=False)


PWA_MANIFEST = {
    "id": "/dashboard.html", "name": "WapChatt", "short_name": "WapChatt", "description": "Chat, status, saluran, dan panggilan.",
    "start_url": "/dashboard.html", "scope": "/", "display": "standalone", "orientation": "portrait", "lang": "id",
    "background_color": "#FFD600", "theme_color": "#FFD600", "prefer_related_applications": False,
    "icons": [{"src": "/logo.png", "sizes": "192x192 512x512", "type": "image/png", "purpose": "any"}],
}

# Service worker dibuat dari kode (tanpa file tambahan): syarat pemasangan aplikasi + penerima notifikasi.
SW_JS = r"""
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => new Response("Tidak ada koneksi internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "WapChatt", body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "WapChatt", {
      body: d.body || "", tag: d.tag || "wapchatt", renotify: true, icon: "/logo.png", badge: "/logo.png",
      vibrate: d.call ? [300, 150, 300, 150, 300] : [120], requireInteraction: !!d.call, data: { peer: d.peer || "" },
    });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const peer = (e.notification.data || {}).peer || "";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) { await wins[0].focus(); wins[0].postMessage({ open: peer }); return; }
    await self.clients.openWindow("/dashboard.html" + (peer ? "?o=" + encodeURIComponent(peer) : ""));
  })());
});
"""


def register(app, authed, owner_only, Session, official="NOVA", helpers=None):
    global OFFICIAL
    OFFICIAL = official
    H = helpers or {}

    @app.get("/manifest.json")
    def pwa_manifest():
        # related_applications memungkinkan browser tahu aplikasinya sudah terpasang (tombol Pasang di Profil lalu hilang)
        m = dict(PWA_MANIFEST, related_applications=[{"platform": "webapp", "url": "https://%s/manifest.json" % request.host}])
        r = app.response_class(json.dumps(m), mimetype="application/manifest+json")
        r.headers["Cache-Control"] = "public, max-age=600"
        return r

    @app.get("/c/<slug>")
    def channel_link(slug):  # link saluran yang memuat namanya: /c/berita-harian-5 -> /?c=5
        m = re.search(r"(\d{1,9})$", slug)
        return redirect("/?c=" + m.group(1) if m else "/")

    @app.get("/sw.js")
    def pwa_sw():
        r = app.response_class(SW_JS, mimetype="text/javascript")
        r.headers["Cache-Control"] = "no-cache"
        r.headers["Service-Worker-Allowed"] = "/"
        return r

    # ---------- polling ----------
    def poll_dict(db, me, p):
        opts = db.query(PollOption).filter_by(poll_id=p.id).order_by(PollOption.idx).all()
        votes = db.query(PollVote).filter_by(poll_id=p.id).all()
        cnt, voters = {}, {}
        for v in votes:
            cnt[v.opt] = cnt.get(v.opt, 0) + 1
            voters.setdefault(v.opt, []).append(v.voter)
        out = {"id": p.id, "question": p.question, "multi": bool(p.multi), "anon": bool(p.anon),
               "total": len({v.voter for v in votes}), "mine": sorted(v.opt for v in votes if v.voter == me),
               "options": [{"i": o.idx, "text": o.text, "n": cnt.get(o.idx, 0)} for o in opts]}
        if not p.anon:  # grup / chat pribadi: pemilih terlihat seperti di WhatsApp
            for o in out["options"]:
                o["voters"] = voters.get(o["i"], [])
        return out

    @app.post("/api/polls")
    @authed
    def poll_create(db, u):
        d = request.get_json(silent=True) or {}
        to, q = str(d.get("to") or ""), str(d.get("question") or "").strip()[:200]
        opts = []
        for t in d.get("options") or []:
            t = str(t).strip()[:100]
            if t and t not in opts:
                opts.append(t)
        if not q or len(opts) < 2 or len(opts) > 12:
            return jsonify(error="Isi pertanyaan dan minimal 2 pilihan jawaban (maksimal 12)."), 400
        if not can_post(db, u.player_id, to):
            return jsonify(error="Kamu tidak bisa membuat polling di chat ini."), 403
        p = Poll(chat=to, owner=u.player_id, question=q, multi=bool(d.get("multi")), anon=room_kind(db, to) == "channel")
        db.add(p)
        db.flush()
        for i, t in enumerate(opts):
            db.add(PollOption(poll_id=p.id, idx=i, text=t))
        m = Message(sender=u.player_id, to_id=to, kind="text", body="[poll:%d]%s" % (p.id, q))
        db.add(m)
        db.flush()
        p.msg_id = m.id
        db.commit()
        return jsonify(m.public()), 201

    def poll_for(db, me, pid):
        p = db.get(Poll, pid)
        m = db.get(Message, p.msg_id) if p and p.msg_id else None
        return p if m and can_see(db, me, m) else None

    @app.get("/api/polls/<int:pid>")
    @authed
    def poll_get(db, u, pid):
        p = poll_for(db, u.player_id, pid)
        return jsonify(poll=poll_dict(db, u.player_id, p)) if p else (jsonify(error="Polling tidak ditemukan."), 404)

    @app.post("/api/polls/<int:pid>/vote")
    @authed
    def poll_vote(db, u, pid):
        p = poll_for(db, u.player_id, pid)
        if not p:
            return jsonify(error="Polling tidak ditemukan."), 404
        valid = {o.idx for o in db.query(PollOption).filter_by(poll_id=pid)}
        sel = {i for i in ((request.get_json(silent=True) or {}).get("options") or []) if isinstance(i, int) and i in valid}
        if not p.multi:
            sel = set(sorted(sel)[:1])
        db.query(PollVote).filter_by(poll_id=pid, voter=u.player_id).delete(synchronize_session=False)
        for i in sel:
            db.add(PollVote(poll_id=pid, voter=u.player_id, opt=i))
        db.commit()
        return jsonify(poll=poll_dict(db, u.player_id, p))

    # ---------- pertanyaan saluran (jawaban anonim) ----------
    def q_for(db, me, qid):
        q = db.get(Question, qid)
        m = db.get(Message, q.msg_id) if q and q.msg_id else None
        return q if m and can_see(db, me, m) else None

    def q_dict(db, me, q):
        rows = db.query(QAnswer).filter_by(q_id=q.id).order_by(QAnswer.id.desc()).limit(200).all()
        n = db.query(func.count(QAnswer.id)).filter_by(q_id=q.id).scalar() or 0
        # nama + ID penjawab HANYA dikirim ke admin (pemilik) saluran; pengikut lain tidak pernah menerimanya
        is_owner = q.owner == me
        who = {x.player_id: x.full_name for x in db.query(User).filter(User.player_id.in_([a.author for a in rows]))} if is_owner and rows else {}
        reps = {}
        for r in db.query(QReply).filter(QReply.answer_id.in_([a.id for a in rows])).order_by(QReply.id) if rows else []:
            # balasan hanya diberi label peran; ID penulisnya tidak dikirim
            reps.setdefault(r.answer_id, []).append({"id": r.id, "text": r.text, "t": iso(r.created_at),
                                                     "who": "admin" if r.author == q.owner else "penjawab", "mine": r.author == me})
        out = []
        for a in rows:
            o = {"id": a.id, "text": a.text, "t": iso(a.created_at), "mine": a.author == me, "replies": reps.get(a.id, [])}
            if is_owner:
                o["by"], o["name"] = a.author, who.get(a.author, a.author)
            out.append(o)
        return {"id": q.id, "question": q.question, "count": n, "is_owner": is_owner, "answers": out}

    @app.post("/api/questions")
    @authed
    def q_create(db, u):
        d = request.get_json(silent=True) or {}
        to, text = str(d.get("to") or ""), str(d.get("question") or "").strip()[:300]
        if not text:
            return jsonify(error="Pertanyaan tidak boleh kosong."), 400
        if room_kind(db, to) != "channel" or not can_post(db, u.player_id, to):
            return jsonify(error="Pertanyaan hanya bisa dibuat pemilik di salurannya sendiri."), 403
        q = Question(chat=to, owner=u.player_id, question=text)
        db.add(q)
        db.flush()
        m = Message(sender=u.player_id, to_id=to, kind="text", body="[qna:%d]%s" % (q.id, text))
        db.add(m)
        db.flush()
        q.msg_id = m.id
        db.commit()
        return jsonify(m.public()), 201

    @app.get("/api/questions/<int:qid>")
    @authed
    def q_get(db, u, qid):
        q = q_for(db, u.player_id, qid)
        return jsonify(q=q_dict(db, u.player_id, q)) if q else (jsonify(error="Pertanyaan tidak ditemukan."), 404)

    @app.post("/api/questions/<int:qid>/answer")
    @authed
    def q_answer(db, u, qid):
        q = q_for(db, u.player_id, qid)
        text = str((request.get_json(silent=True) or {}).get("text") or "").strip()[:500]
        if not q or not text:
            return jsonify(error="Jawaban tidak boleh kosong."), 400
        if q.owner == u.player_id:
            return jsonify(error="Admin saluran tidak bisa menjawab pertanyaannya sendiri."), 403
        a = db.query(QAnswer).filter_by(q_id=qid, author=u.player_id).first()  # satu jawaban per orang; menjawab lagi = mengganti
        if a:
            a.text = text
        else:
            db.add(QAnswer(q_id=qid, author=u.player_id, text=text))
        db.commit()
        return jsonify(q=q_dict(db, u.player_id, q))

    @app.delete("/api/answers/<int:aid>")
    @authed
    def q_answer_del(db, u, aid):
        a = db.get(QAnswer, aid)
        q = db.get(Question, a.q_id) if a else None
        if not a or not q or (a.author != u.player_id and q.owner != u.player_id):
            return jsonify(error="Jawaban tidak ditemukan."), 404
        db.query(QReply).filter(QReply.answer_id == aid).delete(synchronize_session=False)
        db.delete(a)
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/answers/<int:aid>/reply")
    @authed
    def q_reply(db, u, aid):
        a = db.get(QAnswer, aid)
        q = q_for(db, u.player_id, a.q_id) if a else None
        text = str((request.get_json(silent=True) or {}).get("text") or "").strip()[:300]
        if not a or not q:
            return jsonify(error="Jawaban tidak ditemukan."), 404
        if u.player_id != q.owner and u.player_id != a.author:  # admin boleh membalas semua; selain itu hanya penjawabnya sendiri
            return jsonify(error="Hanya admin saluran dan penjawab yang bisa membalas."), 403
        if not text:
            return jsonify(error="Balasan tidak boleh kosong."), 400
        if (db.query(func.count(QReply.id)).filter_by(answer_id=aid).scalar() or 0) >= 50:
            return jsonify(error="Balasan untuk jawaban ini sudah terlalu banyak."), 400
        db.add(QReply(answer_id=aid, author=u.player_id, text=text))
        db.commit()
        return jsonify(q=q_dict(db, u.player_id, q))

    @app.delete("/api/replies/<int:rid>")
    @authed
    def q_reply_del(db, u, rid):
        r = db.get(QReply, rid)
        a = db.get(QAnswer, r.answer_id) if r else None
        q = db.get(Question, a.q_id) if a else None
        if not r or not q or (r.author != u.player_id and q.owner != u.player_id):
            return jsonify(error="Balasan tidak ditemukan."), 404
        db.delete(r)
        db.commit()
        return jsonify(ok=True)

    # ---------- teruskan pesan ----------
    @app.post("/api/forward")
    @authed
    def forward(db, u):
        d = request.get_json(silent=True) or {}
        m = db.get(Message, d.get("msg_id")) if isinstance(d.get("msg_id"), int) else None
        tos = list(dict.fromkeys(str(x) for x in (d.get("to") or [])))
        if not m or m.kind != "text" or not can_see(db, u.player_id, m):
            return jsonify(error="Pesan tidak ditemukan."), 404
        if not tos or len(tos) > MAX_FWD:
            return jsonify(error="Pilih 1 sampai %d tujuan." % MAX_FWD), 400
        body = m.body or ""
        if body.startswith(("[poll:", "[qna:")):
            return jsonify(error="Polling dan pertanyaan tidak bisa diteruskan."), 400
        body = re.sub(r"^\[(re:\d+|st:[^\]]*)\]", "", body)  # kutipan balasan / status tidak ikut diteruskan
        if not body.startswith(("[stk:", "[fwd]")):
            body = "[fwd]" + body
        body = body[:4000]
        if any(not can_post(db, u.player_id, t) for t in tos):
            return jsonify(error="Tidak bisa meneruskan ke salah satu tujuan (saluran hanya untuk pemiliknya)."), 403
        out = [Message(sender=u.player_id, to_id=t, kind="text", body=body) for t in tos]
        db.add_all(out)
        db.commit()
        return jsonify(messages=[x.public() for x in out]), 201

    # ---------- sematkan pesan ----------
    @app.get("/api/pins")
    @authed
    def pins_get(db, u):
        peer = request.args.get("peer", "")
        if not can_chat(db, u.player_id, peer):
            return jsonify(pins=[])
        key, now = chat_key(u.player_id, peer), datetime.utcnow()
        rows = db.query(PinnedMsg).filter(PinnedMsg.chat == key, or_(PinnedMsg.expires.is_(None), PinnedMsg.expires > now)) \
            .order_by(PinnedMsg.id.desc()).all()
        msgs = {m.id: m for m in db.query(Message).filter(Message.id.in_([p.msg_id for p in rows]))} if rows else {}
        return jsonify(pins=[{"id": p.id, "by": p.by, "exp": iso(p.expires), "msg": msgs[p.msg_id].public()}
                             for p in rows if p.msg_id in msgs],
                       can_pin=can_pin_in(db, u.player_id, peer))

    @app.post("/api/pins")
    @authed
    def pins_post(db, u):
        d = request.get_json(silent=True) or {}
        peer, hours = str(d.get("peer") or ""), d.get("hours") or 0
        m = db.get(Message, d.get("msg_id")) if isinstance(d.get("msg_id"), int) else None
        if not can_chat(db, u.player_id, peer) or not m or m.kind != "text" or not in_chat(m, u.player_id, peer):
            return jsonify(error="Pesan tidak ditemukan."), 404
        if not can_pin_in(db, u.player_id, peer):
            return jsonify(error="Hanya pemilik saluran yang bisa menyematkan pesan."), 403
        if hours not in PIN_HOURS and hours != 0:
            return jsonify(error="Durasi tidak valid."), 400
        key = chat_key(u.player_id, peer)
        exp = datetime.utcnow() + timedelta(hours=hours) if hours else None
        p = db.query(PinnedMsg).filter_by(chat=key, msg_id=m.id).first()
        if p:
            p.expires, p.by = exp, u.player_id
        else:
            db.add(PinnedMsg(chat=key, msg_id=m.id, by=u.player_id, expires=exp))
        db.flush()
        now = datetime.utcnow()
        act = db.query(PinnedMsg).filter(PinnedMsg.chat == key, or_(PinnedMsg.expires.is_(None), PinnedMsg.expires > now)) \
            .order_by(PinnedMsg.id.desc()).all()
        for old in act[MAX_PINS:]:  # lebih dari batas: yang paling lama dilepas
            db.delete(old)
        db.commit()
        return jsonify(ok=True), 201

    @app.delete("/api/pins/<int:pid>")
    @authed
    def pins_delete(db, u, pid):
        p = db.get(PinnedMsg, pid)
        if not p:
            return jsonify(error="Sematan tidak ditemukan."), 404
        peer = p.chat if p.chat.startswith("R-") else next((x for x in p.chat.split(":") if x != u.player_id), u.player_id)
        if u.player_id not in p.chat.split(":") and not p.chat.startswith("R-"):
            return jsonify(error="Sematan tidak ditemukan."), 404
        if not can_pin_in(db, u.player_id, peer):
            return jsonify(error="Tidak diizinkan."), 403
        db.delete(p)
        db.commit()
        return jsonify(ok=True)

    # ---------- bintang (pribadi) ----------
    @app.get("/api/stars")
    @authed
    def stars_get(db, u):
        rows = db.query(StarMsg).filter_by(owner=u.player_id).order_by(StarMsg.id.desc()).limit(200).all()
        msgs = {m.id: m for m in db.query(Message).filter(Message.id.in_([s.msg_id for s in rows]))} if rows else {}
        out = []
        for s in rows:
            m = msgs.get(s.msg_id)
            if m and can_see(db, u.player_id, m):
                key = m.to_id if (m.to_id.startswith("R-") or m.sender == u.player_id) else m.sender
                out.append({"key": key, "msg": m.public()})
        return jsonify(stars=out)

    @app.post("/api/stars")
    @authed
    def stars_post(db, u):
        d = request.get_json(silent=True) or {}
        m = db.get(Message, d.get("msg_id")) if isinstance(d.get("msg_id"), int) else None
        if not m or m.kind != "text" or not can_see(db, u.player_id, m):
            return jsonify(error="Pesan tidak ditemukan."), 404
        s = db.query(StarMsg).filter_by(owner=u.player_id, msg_id=m.id).first()
        if d.get("value") and not s:
            db.add(StarMsg(owner=u.player_id, msg_id=m.id))
        elif not d.get("value") and s:
            db.delete(s)
        db.commit()
        return jsonify(ok=True)

    # ---------- belum dibaca (disimpan di server, tahan muat ulang) ----------
    @app.get("/api/unread")
    @authed
    def unread_get(db, u):
        me = u.player_id
        mine = [i for (i,) in db.query(RoomMember.room_id).filter_by(player_id=me)]
        # saluran milik sendiri tidak punya "belum dibaca": semua pesannya ditulis oleh admin itu sendiri
        tags = ["R-%d" % r.id for r in db.query(Room).filter(Room.id.in_(mine))] if mine else []
        own = {"R-%d" % r.id for r in db.query(Room).filter(Room.id.in_(mine), Room.kind == "channel", Room.owner == me)} if mine else set()
        tags = [t for t in tags if t not in own]
        if not db.query(ChatRead.id).filter_by(owner=me).first():
            # pertama kali: riwayat yang sudah ada dianggap terbaca, supaya angkanya tidak meledak
            for peer, mx in db.query(Message.sender, func.max(Message.id)).filter(Message.to_id == me, Message.sender != me, Message.kind == "text").group_by(Message.sender):
                db.add(ChatRead(owner=me, peer=peer, last_id=mx))
            if tags:
                for peer, mx in db.query(Message.to_id, func.max(Message.id)).filter(Message.to_id.in_(tags), Message.kind == "text").group_by(Message.to_id):
                    db.add(ChatRead(owner=me, peer=peer, last_id=mx))
            db.add(ChatRead(owner=me, peer=me, last_id=0))  # penanda "sudah diinisialisasi"
            db.commit()
            return jsonify(unread={})
        out = {}
        dm = db.query(Message.sender, func.count(Message.id)).outerjoin(ChatRead, and_(ChatRead.owner == me, ChatRead.peer == Message.sender)) \
            .filter(Message.to_id == me, Message.sender != me, Message.kind == "text", Message.id > func.coalesce(ChatRead.last_id, 0), ~Message.id.in_(undelivered())).group_by(Message.sender)
        out.update({k: n for k, n in dm})
        if tags:
            rm = db.query(Message.to_id, func.count(Message.id)).outerjoin(ChatRead, and_(ChatRead.owner == me, ChatRead.peer == Message.to_id)) \
                .filter(Message.to_id.in_(tags), Message.sender != me, Message.kind == "text", Message.id > func.coalesce(ChatRead.last_id, 0)).group_by(Message.to_id)
            out.update({k: n for k, n in rm})
        return jsonify(unread=out)

    @app.post("/api/read")
    @authed
    def read_post(db, u):
        me, peer = u.player_id, str((request.get_json(silent=True) or {}).get("peer") or "")
        if not can_chat(db, me, peer):
            return jsonify(ok=True)
        q = db.query(func.max(Message.id)).filter(Message.kind == "text")
        mx = (q.filter(Message.to_id == peer) if peer.startswith("R-") else q.filter(Message.to_id == me, Message.sender == peer)).scalar() or 0
        r = db.query(ChatRead).filter_by(owner=me, peer=peer).first()
        if r:
            r.last_id = max(r.last_id or 0, mx)
        else:
            db.add(ChatRead(owner=me, peer=peer, last_id=mx))
        db.commit()
        return jsonify(ok=True)

    # ---------- blokir kontak ----------
    @app.get("/api/blocks")
    @authed
    def blocks_get(db, u):
        ids = [b.target for b in db.query(Block).filter_by(owner=u.player_id).order_by(Block.id.desc())]
        names = {x.player_id: x.full_name for x in db.query(User).filter(User.player_id.in_(ids))} if ids else {}
        return jsonify(blocks=[{"player_id": i, "full_name": names.get(i, i)} for i in ids])

    @app.post("/api/blocks")
    @authed
    def blocks_post(db, u):
        d = request.get_json(silent=True) or {}
        pid = str(d.get("pid") or "")
        if pid == u.player_id or pid == OFFICIAL or not db.query(User.id).filter_by(player_id=pid).first():
            return jsonify(error="Kontak tidak bisa diblokir."), 400
        b = db.query(Block).filter_by(owner=u.player_id, target=pid).first()
        if d.get("value") and not b:
            db.add(Block(owner=u.player_id, target=pid))
        elif not d.get("value") and b:
            db.delete(b)
        db.commit()
        return jsonify(ok=True)

    @app.get("/api/chatstate")
    @authed
    def chatstate(db, u):
        peer = request.args.get("peer", "")
        i_blocked = is_blocked(db, u.player_id, peer)
        blocked = i_blocked or is_blocked(db, peer, u.player_id) or peer in H.get("banned", lambda: set())()   # saling blokir, atau akunnya diblokir owner: satu centang
        last = db.query(func.max(Message.id)).filter(Message.sender == peer, Message.to_id == u.player_id, Message.kind == "text").scalar() or 0
        return jsonify(blocked=bool(blocked), last=last, i_blocked=i_blocked)

    # ---------- admin grup / saluran ----------
    @app.post("/api/rooms/<int:rid>/admin")
    @authed
    def room_admin_set(db, u, rid):
        r = db.get(Room, rid)
        d = request.get_json(silent=True) or {}
        pid = str(d.get("pid") or "")
        if not r or not is_admin(db, r, u.player_id):
            return jsonify(error="Hanya admin yang bisa mengatur admin."), 403
        if pid == r.owner or not db.query(RoomMember.id).filter_by(room_id=rid, player_id=pid).first():
            return jsonify(error="Anggota tidak ditemukan atau pemilik sudah otomatis admin."), 400
        a = db.query(RoomAdmin).filter_by(room_id=rid, player_id=pid).first()
        if d.get("value") and not a:
            db.add(RoomAdmin(room_id=rid, player_id=pid))
        elif not d.get("value") and a:
            if u.player_id != r.owner and pid != u.player_id:
                return jsonify(error="Hanya pemilik yang bisa mencabut admin lain."), 403
            db.delete(a)
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/kick")
    @authed
    def room_kick(db, u, rid):
        r = db.get(Room, rid)
        pid = str((request.get_json(silent=True) or {}).get("pid") or "")
        if not r or r.kind != "group" or not is_admin(db, r, u.player_id):
            return jsonify(error="Hanya admin grup yang bisa mengeluarkan anggota."), 403
        m = db.query(RoomMember).filter_by(room_id=rid, player_id=pid).first()
        if not m or pid == r.owner or pid == u.player_id:
            return jsonify(error="Anggota tidak bisa dikeluarkan."), 400
        if is_admin(db, r, pid) and u.player_id != r.owner:
            return jsonify(error="Hanya pemilik yang bisa mengeluarkan admin."), 403
        drop_admin(db, rid, pid)
        db.delete(m)
        db.commit()
        return jsonify(ok=True)

    # ---------- notifikasi push (opsional) ----------
    @app.get("/api/push/key")
    @authed
    def push_key(db, u):
        return jsonify(key=os.getenv("VAPID_PUBLIC_KEY", "") if push_enabled() else "")

    @app.post("/api/push/subscribe")
    @authed
    def push_sub(db, u):
        d = request.get_json(silent=True) or {}
        k = d.get("keys") or {}
        ep, p256, au = str(d.get("endpoint") or ""), str(k.get("p256dh") or ""), str(k.get("auth") or "")
        if not ep.startswith("https://") or not p256 or not au or len(ep) > 1000:
            return jsonify(error="Langganan tidak valid."), 400
        for x in db.query(PushSub).filter(PushSub.endpoint == ep).all():
            db.delete(x)
        db.add(PushSub(owner=u.player_id, endpoint=ep, p256dh=p256[:200], auth=au[:100]))
        db.commit()
        return jsonify(ok=True)

    @app.post("/api/push/unsubscribe")
    @authed
    def push_unsub(db, u):
        ep = str((request.get_json(silent=True) or {}).get("endpoint") or "")
        db.query(PushSub).filter(PushSub.owner == u.player_id, PushSub.endpoint == ep).delete(synchronize_session=False)
        db.commit()
        return jsonify(ok=True)

    # ---------- link grup (undangan) ----------
    @app.post("/api/rooms/<int:rid>/invite")
    @authed
    def room_invite(db, u, rid):
        r = db.get(Room, rid)
        if not r or r.kind != "group" or r.owner != u.player_id:
            return jsonify(error="Hanya pemilik grup yang bisa membuat link."), 403
        inv = db.get(RoomInvite, rid)
        if not inv:
            inv = RoomInvite(room_id=rid, code=secrets.token_hex(8))
            db.add(inv)
        elif (request.get_json(silent=True) or {}).get("reset"):
            inv.code = secrets.token_hex(8)  # link lama langsung tidak berlaku
        db.commit()
        return jsonify(code=inv.code)

    def invite_room(db, code):
        inv = db.query(RoomInvite).filter_by(code=code[:16]).first()
        return db.get(Room, inv.room_id) if inv else None

    @app.get("/api/invite/<code>")
    @authed
    def invite_get(db, u, code):
        r = invite_room(db, code)
        if not r:
            return jsonify(error="Link grup tidak berlaku lagi."), 404
        n = db.query(func.count(RoomMember.id)).filter_by(room_id=r.id).scalar() or 0
        joined = bool(db.query(RoomMember.id).filter_by(room_id=r.id, player_id=u.player_id).first())
        return jsonify(room={"id": r.id, "name": r.name, "about": r.about, "count": n, "joined": joined})

    @app.post("/api/invite/<code>/join")
    @authed
    def invite_join(db, u, code):
        r = invite_room(db, code)
        if not r:
            return jsonify(error="Link grup tidak berlaku lagi."), 404
        if not db.query(RoomMember.id).filter_by(room_id=r.id, player_id=u.player_id).first():
            db.add(RoomMember(room_id=r.id, player_id=u.player_id))
            db.commit()
        return jsonify(id=r.id)

    # ---------- owner: detail pengguna ----------
    @app.get("/api/admin/users/<pid>")
    @owner_only
    def adm_user_detail(db, u, pid):
        t, err = H["target_user"](db, u, pid, allow_self=True)
        if err:
            return err
        now = datetime.utcnow()
        day = now - timedelta(days=1)
        ext, prof = db.get(ProfileExt, pid), db.get(Profile, pid)
        ls = ext.last_seen if ext else None
        cnt = lambda q: q.scalar() or 0
        sent = db.query(func.count(Message.id)).filter(Message.sender == pid, Message.kind == "text")
        rooms = db.query(Room).join(RoomMember, RoomMember.room_id == Room.id).filter(RoomMember.player_id == pid).order_by(Room.id.desc()).all()
        size = {rid: n for rid, n in db.query(RoomMember.room_id, func.count(RoomMember.id)).filter(RoomMember.room_id.in_([r.id for r in rooms])).group_by(RoomMember.room_id)} if rooms else {}
        return jsonify(user={
            "player_id": t.player_id, "full_name": t.full_name, "email": mask_email(t.email), "birth_year": t.birth_year,
            "age": now.year - t.birth_year, "status": (prof.status if prof else "") or "",
            "created_at": iso(t.created_at), "last_seen": iso(ls), "online": bool(ls and (now - ls).total_seconds() < 90),
            "verified": H["is_verified"](t), "owner": H["is_owner"](t), "banned": t.player_id in H["banned"](),
            "public": ext.public is not False if ext else True, "show_seen": ext.show_seen is not False if ext else True,
            "contacts": cnt(db.query(func.count(Contact.id)).filter(Contact.owner == pid)),
            "saved_by": cnt(db.query(func.count(Contact.id)).filter(Contact.contact_pid == pid)),
            "sent": cnt(sent), "sent24": cnt(sent.filter(Message.created_at > day)),
            "received": cnt(db.query(func.count(Message.id)).filter(Message.to_id == pid, Message.kind == "text")),
            "stories": cnt(db.query(func.count(Story.id)).filter(Story.owner == pid, Story.created_at > day)),
            "rooms": [{"id": r.id, "kind": r.kind, "name": r.name, "owned": r.owner == pid, "count": size.get(r.id, 0)} for r in rooms[:40]],
            "rooms_total": len(rooms)})

    # ---------- owner: centang biru saluran ----------
    @app.post("/api/admin/rooms/<int:rid>/verify")
    @owner_only
    def adm_room_verify(db, u, rid):
        r = db.get(Room, rid)
        if not r or r.kind != "channel":
            return jsonify(error="Saluran tidak ditemukan."), 404
        f = db.get(RoomFlag, rid) or RoomFlag(room_id=rid)
        f.verified = bool((request.get_json(silent=True) or {}).get("value"))
        db.add(f)
        db.commit()
        return jsonify(ok=True)
