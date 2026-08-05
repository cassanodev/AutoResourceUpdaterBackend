from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException, status

from .config import Settings


def create_state(settings: Settings, flow_id: str) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "typ": "oauth-state",
            "flow_id": flow_id,
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def decode_state(settings: Settings, token: str) -> dict[str, Any]:
    payload = decode_token(settings, token)
    if payload.get("typ") != "oauth-state" or not payload.get("flow_id"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OAuth state")
    return payload


def create_access_token(
    settings: Settings,
    *,
    flow_id: str,
    discord_user: dict[str, Any],
) -> str:
    now = datetime.now(UTC)
    discord_id = str(discord_user["id"])
    avatar_hash = discord_user.get("avatar")
    avatar = (
        f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png?size=256"
        if avatar_hash
        else None
    )

    return jwt.encode(
        {
            "typ": "access",
            "sub": discord_id,
            "flow_id": flow_id,
            "name": discord_user.get("global_name") or discord_user.get("username"),
            "image": avatar,
            "iat": now,
            "exp": now + timedelta(minutes=settings.jwt_expires_minutes),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def decode_token(settings: Settings, token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from error
