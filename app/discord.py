from typing import Any

import httpx

from .config import Settings

DISCORD_API = "https://discord.com/api/v10"


async def exchange_code(
    client: httpx.AsyncClient,
    settings: Settings,
    code: str,
) -> str:
    response = await client.post(
        f"{DISCORD_API}/oauth2/token",
        data={
            "client_id": settings.discord_client_id,
            "client_secret": settings.discord_client_secret.get_secret_value(),
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.discord_redirect_uri,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


async def get_discord_user(
    client: httpx.AsyncClient,
    access_token: str,
) -> dict[str, Any]:
    response = await client.get(
        f"{DISCORD_API}/users/@me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    response.raise_for_status()
    return response.json()


async def join_guild_if_configured(
    client: httpx.AsyncClient,
    settings: Settings,
    discord_user_id: str,
    access_token: str,
) -> None:
    if not settings.discord_guild_id or not settings.discord_bot_token:
        return

    response = await client.put(
        f"{DISCORD_API}/guilds/{settings.discord_guild_id}/members/{discord_user_id}",
        headers={
            "Authorization": f"Bot {settings.discord_bot_token.get_secret_value()}",
            "Content-Type": "application/json",
        },
        json={"access_token": access_token},
    )
    if response.status_code not in (201, 204):
        response.raise_for_status()
