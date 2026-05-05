"""
JWT Authentication — register / login / token validation.
Foloseste tabelul `users` din Supabase.
"""
import os
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from db import get_client

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET env var not set — nu porni fara ea")
ALGORITHM    = "HS256"
ACCESS_TTL   = 60 * 24 * 7   # 7 zile in minute

bearer = HTTPBearer(auto_error=False)


# ─── helpers ────────────────────────────────────────────────


def _hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _create_token(user_id: int, email: str, tier: str, role: str = "user") -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL)
    return jwt.encode(
        {"sub": str(user_id), "email": email, "tier": tier, "role": role, "exp": exp},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ─── register / login ───────────────────────────────────────


def register_user(email: str, password: str) -> dict:
    """
    Creaza cont nou. Returneaza token sau arunca HTTPException.
    """
    try:
        client = get_client()
        if client is None:
            raise HTTPException(503, "DB indisponibil")

        existing = client.table("users").select("id").eq("email", email).execute()
        if existing.data:
            raise HTTPException(400, "Email deja inregistrat")

        if len(password.encode("utf-8")) > 72:
            raise HTTPException(400, "Parola prea lunga (max 72 caractere)")

        hashed = _hash(password)
        client.table("users").insert({
            "email":         email,
            "password_hash": hashed,
            "tier":          "free",
        }).execute()

        rows = client.table("users").select("*").eq("email", email).execute()
        if not rows.data:
            raise HTTPException(500, "User negasit dupa insert")
        user = rows.data[0]
        token = _create_token(user["id"], user["email"], user["tier"])
        return {"access_token": token, "token_type": "bearer", "tier": "free"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("register_user error: %s", repr(e))
        raise HTTPException(500, f"Eroare inregistrare: {repr(e)}")


def login_user(email: str, password: str) -> dict:
    """
    Autentifica user. Returneaza token sau arunca HTTPException.
    """
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")

    rows = client.table("users").select("*").eq("email", email).execute()
    if not rows.data:
        raise HTTPException(401, "Email sau parola incorecta")

    user = rows.data[0]
    if not _verify(password, user["password_hash"]):
        raise HTTPException(401, "Email sau parola incorecta")

    role = user.get("role", "user") or "user"
    tier = user.get("tier", "free") or "free"

    # Downgrade automat daca tier_expires a trecut
    expires = user.get("tier_expires")
    if expires and tier not in ("free", "owner"):
        try:
            exp_dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp_dt:
                tier = "free"
                get_client().table("users").update({"tier": "free"}).eq("id", user["id"]).execute()
                logger.info("login_user: tier downgradat la free pentru %s (expirat %s)", email, expires)
        except Exception as e:
            logger.warning("login_user: verificare tier_expires failed: %s", e)

    token = _create_token(user["id"], user["email"], tier, role)
    return {"access_token": token, "token_type": "bearer", "tier": tier, "role": role}


# ─── dependency injection ───────────────────────────────────


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Optional[dict]:
    """
    Dependency FastAPI — returneaza user dict sau None (rute publice).
    """
    if credentials is None:
        return None
    try:
        payload = _decode_token(credentials.credentials)
        return {
            "id":    payload.get("sub"),
            "email": payload.get("email"),
            "tier":  payload.get("tier", "free"),
            "role":  payload.get("role", "user"),
        }
    except JWTError:
        return None


def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    """Dependency — arunca 401 daca nu e autentificat."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentificare necesara",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_vip(user: dict = Depends(require_user)) -> dict:
    """Dependency — arunca 403 daca nu e tier VIP/Pro/Owner."""
    if user.get("tier") not in ("vip", "pro", "owner") and user.get("role") not in ("owner", "admin"):
        raise HTTPException(403, "Acces rezervat utilizatorilor VIP")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    """Dependency — arunca 403 daca nu e owner/admin."""
    if user.get("role") not in ("owner", "admin"):
        raise HTTPException(403, "Acces rezervat administratorilor")
    return user


# ─── forgot / reset password ────────────────────────────────


def request_password_reset(email: str) -> None:
    client = get_client()
    if client is None:
        return

    rows = client.table("users").select("id").eq("email", email).execute()
    if not rows.data:
        return  # nu dezvaluim daca emailul exista

    client.table("password_resets").delete().eq("email", email).execute()

    token = str(secrets.randbelow(900000) + 100000)  # 6 cifre: 100000-999999
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)

    client.table("password_resets").insert({
        "email":      email,
        "token":      token,
        "expires_at": expires.isoformat(),
    }).execute()

    _send_reset_email(email, token)


def _send_reset_email(email: str, token: str) -> None:
    import resend as _resend
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.warning("_send_reset_email: RESEND_API_KEY lipsa")
        return
    try:
        _resend.api_key = api_key
        _resend.Emails.send({
            "from":    "Oxiano <noreply@oxiano.com>",
            "to":      [email],
            "subject": "Resetare parola — Oxiano",
            "html":    f"""
            <div style="background:#0f172a;padding:32px;font-family:monospace;color:#f1f5f9">
              <h2 style="color:#3b82f6;margin:0 0 16px">Oxiano — Resetare parola</h2>
              <p style="color:#94a3b8">Codul tau de resetare (valid 15 minute):</p>
              <div style="background:#1e293b;border-radius:10px;padding:20px;text-align:center;
                          font-size:36px;font-weight:700;letter-spacing:12px;color:#f1f5f9;
                          border:1px solid #334155;margin:20px 0">
                {token}
              </div>
              <p style="color:#64748b;font-size:12px">
                Daca nu ai solicitat resetarea parolei, ignora acest email.
              </p>
            </div>""",
        })
    except Exception as e:
        logger.error("_send_reset_email failed: %s", e)


def reset_password(email: str, token: str, new_password: str) -> None:
    client = get_client()
    if client is None:
        raise HTTPException(503, "DB indisponibil")

    if len(new_password) < 6:
        raise HTTPException(400, "Parola prea scurta (min 6 caractere)")
    if len(new_password.encode("utf-8")) > 72:
        raise HTTPException(400, "Parola prea lunga (max 72 caractere)")

    rows = client.table("password_resets") \
        .select("*").eq("email", email).eq("token", token).eq("used", False) \
        .execute()

    if not rows.data:
        raise HTTPException(400, "Cod invalid sau deja folosit")

    reset = rows.data[0]
    expires = datetime.fromisoformat(reset["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(400, "Codul a expirat. Solicita unul nou.")

    client.table("users").update({"password_hash": _hash(new_password)}).eq("email", email).execute()
    client.table("password_resets").update({"used": True}).eq("id", reset["id"]).execute()
