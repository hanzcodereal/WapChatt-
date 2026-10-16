"""Fitur tambahan WapChatt (file terpisah supaya app.py tidak terlalu panjang).

- Sematkan pesan       : tabel pinned_msgs (24 jam / 7 hari / 30 hari / tanpa batas)
- Polling              : tabel polls, poll_options, poll_votes (grup, chat pribadi, saluran; di saluran suara anonim)
- Pertanyaan saluran   : tabel questions, q_answers (admin tidak bisa menjawab; hanya admin yang melihat nama + ID penjawab, pengikut lain tidak)
- Teruskan pesan       : POST /api/forward
- Link grup            : tabel room_invites (kode undangan acak per grup; link saluran dan profil tidak butuh tabel)
- Bintangi pesan       : tabel star_msgs (pribadi, hanya terlihat pemilik)
- Centang biru saluran : tabel room_flags (otomatis di 1000 pengikut, atau diatur owner)

Semua tabel BARU, jadi database Neon yang sudah ada tidak perlu migrasi (dibuat otomatis oleh init_db()).
"""
import re, secrets
from datetime import datetime, timedelta
from flask import request, jsonify
from sqlalchemy import Column, Integer, String, DateTime, Boolean, func, or_
from database import Base, Message, Room, RoomMember, User

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


class RoomInvite(Base):
    __tablename__ = "room_invites"
    room_id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False, index=True)


class RoomFlag(Base):
    __tablename__ = "room_flags"
    room_id = Column(Integer, primary_key=True)
    verified = Column(Boolean, nullable=True)   # None = aturan otomatis, True = beri centang, False = cabut


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


def can_post(db, me, to):
    """Aturan sama dengan /api/send: saluran hanya pemilik, grup anggota, chat pribadi ke pengguna yang ada."""
    if to == OFFICIAL:
        return False
    rid = room_of(to)
    if to.startswith("R-"):
        r = db.get(Room, rid) if rid else None
        return bool(r) and bool(db.query(RoomMember.id).filter_by(room_id=r.id, player_id=me).first()) and (r.kind == "group" or r.owner == me)
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
    return bool(r) and can_chat(db, me, peer) and (r.kind == "group" or r.owner == me)  # saluran: hanya pemilik


def drop_polls(db, cond):
    ids = [i for (i,) in db.query(Poll.id).filter(cond)]
    if ids:
        for M in (PollVote, PollOption):
            db.query(M).filter(M.poll_id.in_(ids)).delete(synchronize_session=False)
        db.query(Poll).filter(Poll.id.in_(ids)).delete(synchronize_session=False)


def drop_questions(db, cond):
    ids = [i for (i,) in db.query(Question.id).filter(cond)]
    if ids:
        db.query(QAnswer).filter(QAnswer.q_id.in_(ids)).delete(synchronize_session=False)
        db.query(Question).filter(Question.id.in_(ids)).delete(synchronize_session=False)


def on_msg_delete(db, m):
    drop_polls(db, Poll.msg_id == m.id)
    drop_questions(db, Question.msg_id == m.id)
    db.query(PinnedMsg).filter(PinnedMsg.msg_id == m.id).delete(synchronize_session=False)
    db.query(StarMsg).filter(StarMsg.msg_id == m.id).delete(synchronize_session=False)


def on_room_purge(db, rid):
    tag = "R-%d" % rid
    drop_polls(db, Poll.chat == tag)
    drop_questions(db, Question.chat == tag)
    mids = [i for (i,) in db.query(Message.id).filter(Message.to_id == tag)]
    if mids:
        db.query(StarMsg).filter(StarMsg.msg_id.in_(mids)).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.chat == tag).delete(synchronize_session=False)
    db.query(RoomFlag).filter(RoomFlag.room_id == rid).delete(synchronize_session=False)
    db.query(RoomInvite).filter(RoomInvite.room_id == rid).delete(synchronize_session=False)


def on_user_purge(db, pid):
    drop_polls(db, or_(Poll.owner == pid, Poll.chat == pid))
    drop_questions(db, or_(Question.owner == pid, Question.chat == pid))
    db.query(PollVote).filter(PollVote.voter == pid).delete(synchronize_session=False)
    db.query(QAnswer).filter(QAnswer.author == pid).delete(synchronize_session=False)
    db.query(StarMsg).filter(StarMsg.owner == pid).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.by == pid).delete(synchronize_session=False)


def register(app, authed, owner_only, Session, official="NOVA"):
    global OFFICIAL
    OFFICIAL = official

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
        out = []
        for a in rows:
            o = {"id": a.id, "text": a.text, "t": iso(a.created_at), "mine": a.author == me}
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
        db.delete(a)
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
