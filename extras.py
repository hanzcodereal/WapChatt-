"""Fitur tambahan WapChatt (file terpisah supaya app.py tidak terlalu panjang).

- Sematkan pesan       : tabel pinned_msgs (24 jam / 7 hari / 30 hari / tanpa batas)
- Link grup            : tabel room_invites (kode undangan acak per grup; link saluran dan profil tidak butuh tabel)
- Bintangi pesan       : tabel star_msgs (pribadi, hanya terlihat pemilik)
- Centang biru saluran : tabel room_flags (otomatis di 1000 pengikut, atau diatur owner)

Semua tabel BARU, jadi database Neon yang sudah ada tidak perlu migrasi (dibuat otomatis oleh init_db()).
"""
import secrets
from datetime import datetime, timedelta
from flask import request, jsonify
from sqlalchemy import Column, Integer, String, DateTime, Boolean, func, or_
from database import Base, Message, Room, RoomMember, User

VERIFY_AT = 1000           # jumlah pengikut untuk centang biru otomatis
MAX_PINS = 3               # jumlah pesan yang bisa disematkan per chat
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


def can_pin_in(db, me, peer):
    rid = room_of(peer)
    if rid is None:
        return can_chat(db, me, peer)
    r = db.get(Room, rid)
    return bool(r) and can_chat(db, me, peer) and (r.kind == "group" or r.owner == me)  # saluran: hanya pemilik


def on_msg_delete(db, m):
    db.query(PinnedMsg).filter(PinnedMsg.msg_id == m.id).delete(synchronize_session=False)
    db.query(StarMsg).filter(StarMsg.msg_id == m.id).delete(synchronize_session=False)


def on_room_purge(db, rid):
    tag = "R-%d" % rid
    mids = [i for (i,) in db.query(Message.id).filter(Message.to_id == tag)]
    if mids:
        db.query(StarMsg).filter(StarMsg.msg_id.in_(mids)).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.chat == tag).delete(synchronize_session=False)
    db.query(RoomFlag).filter(RoomFlag.room_id == rid).delete(synchronize_session=False)
    db.query(RoomInvite).filter(RoomInvite.room_id == rid).delete(synchronize_session=False)


def on_user_purge(db, pid):
    db.query(StarMsg).filter(StarMsg.owner == pid).delete(synchronize_session=False)
    db.query(PinnedMsg).filter(PinnedMsg.by == pid).delete(synchronize_session=False)


def register(app, authed, owner_only, Session):
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
