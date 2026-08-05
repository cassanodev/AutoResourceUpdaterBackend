import asyncio
import os

from contextlib import asynccontextmanager
from typing import List
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from .config import Settings, get_settings
from .resources_ids_versions import RESOURCE_IDS
from .discord import exchange_code, get_discord_user, join_guild_if_configured
from .security import create_access_token, create_state, decode_state, decode_token

from packaging.version import Version, InvalidVersion

from dotenv import load_dotenv

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        headers={"User-Agent": "AutoResourceUpdater/1.0"},
    )
    yield
    await app.state.http.aclose()


app = FastAPI(title="Auto Resource Updater Auth", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/discord/login")
async def discord_login(
    flow_id: UUID = Query(),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    state_token = create_state(settings, str(flow_id))
    query = urlencode(
        {
            "client_id": settings.discord_client_id,
            "redirect_uri": settings.discord_redirect_uri,
            "response_type": "code",
            "scope": "identify guilds.join",
            "state": state_token,
            "prompt": "consent",
        }
    )
    return RedirectResponse(f"https://discord.com/oauth2/authorize?{query}")


@app.get("/api/auth/callback/discord")
async def discord_callback(
    request: Request,
    code: str,
    state: str,
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    state_data = decode_state(settings, state)
    client: httpx.AsyncClient = request.app.state.http

    try:
        discord_token = await exchange_code(client, settings, code)
        discord_user = await get_discord_user(client, discord_token)
        await join_guild_if_configured(
            client,
            settings,
            str(discord_user["id"]),
            discord_token,
        )
    except (httpx.HTTPError, KeyError) as error:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Discord authentication failed",
        ) from error

    app_token = create_access_token(
        settings,
        flow_id=str(state_data["flow_id"]),
        discord_user=discord_user,
    )
    callback_query = urlencode(
        {"token": app_token, "flow_id": state_data["flow_id"]}
    )

    # return RedirectResponse(f"autoresourceupdater-auth://callback?{callback_query}")

    callback_url = f"autoresourceupdater-auth://callback?{callback_query}"

    return HTMLResponse(f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authentication Complete</title>

        <style>
            * {{
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }}

            body {{
                background: #313338;
                color: #f2f3f5;
                font-family: "gg sans", "Segoe UI", Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                overflow: hidden;
            }}

            .card {{
                background: #2b2d31;
                width: 420px;
                max-width: 90%;
                padding: 40px;
                border-radius: 16px;
                text-align: center;
                box-shadow: 0 12px 32px rgba(0,0,0,.35);
            }}

            .icon {{
                width: 72px;
                height: 72px;
                margin: 0 auto 24px;
                border-radius: 50%;
                background: #23a559;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 36px;
                color: white;
            }}

            h1 {{
                font-size: 26px;
                margin-bottom: 12px;
                font-weight: 700;
            }}

            p {{
                color: #b5bac1;
                line-height: 1.6;
                font-size: 15px;
            }}

            .status {{
                margin-top: 28px;
                color: #949ba4;
                font-size: 14px;
            }}
        </style>
    </head>
    <body>

    <div class="card">
        <div class="icon">✓</div>

        <h1>Authentication Complete</h1>

        <p>
            Your Discord account has been successfully linked.
            We're opening the application automatically.
        </p>

        <div class="status" id="status">
            You can close this window already.
        </div>
    </div>

    <script>
        const callbackUrl = "{callback_url}";

        window.location.href = callbackUrl;

        setTimeout(() => {{
            document.getElementById("status").textContent =
                "If nothing happened, return to the application manually. You can safely close this window.";
        }}, 2000);
    </script>

    </body>
    </html>
    """)


@app.get("/api/auth/me")
async def me(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict[str, str | None]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    payload = decode_token(settings, authorization.removeprefix("Bearer "))
    if payload.get("typ") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

    return {
        "id": str(payload["sub"]),
        "discordId": str(payload["sub"]),
        "name": payload.get("name"),
        "image": payload.get("image"),
    }

@app.get("/api/resources/getLastVersion")
async def get_last_version(_id: int):
    id = RESOURCE_IDS.get(_id)

    if id is None:
        raise HTTPException(
            status_code=404,
            detail=f"Recurso no encontrado ({_id})."
        )
    
    url = f"https://portal-api.cfx.re/v1/asset-grants/{id}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, cookies={
            "Cookie": os.environ.get("VERSIONS_COOKIE", "")
        })

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Error obteniendo el recurso."
        )

    data = response.json()

    versions = data.get("asset", {}).get("versions", [])

    if not versions:
        raise HTTPException(
            status_code=404,
            detail="No se encontraron versiones."
        )

    valid_versions = []

    for version in versions:
        try:
            valid_versions.append(
                (Version(version["version"]), version)
            )
        except (KeyError, InvalidVersion):
            continue

    if not valid_versions:
        raise HTTPException(
            status_code=404,
            detail="No hay versiones válidas."
        )

    latest = max(valid_versions, key=lambda x: x[0])[1]

    return {
        "version": latest["version"]
    }

from pydantic import BaseModel
class ResourcesRequest(BaseModel):
    ids: List[str]


@app.post("/api/resources/getResourcesLastVersion")
async def get_resources_last_version(body: ResourcesRequest):
    async with httpx.AsyncClient(timeout=30) as client:

        async def get_version(_resource_id: str):
            id = RESOURCE_IDS.get(_resource_id)

            if id is None:
                return {
                    "id": _resource_id,
                    "version": None,
                    "success": False
                }

            try:
                response = await client.get(
                    f"https://portal-api.cfx.re/v1/asset-grants/{id}",
                    headers={
                        "Cookie": os.environ.get("VERSIONS_COOKIE", "")
                    }
                )

                if response.status_code != 200:
                    return {
                        "id": _resource_id,
                        "version": None,
                        "success": False
                    }

                data = response.json()
                versions = data.get("asset", {}).get("versions", [])

                valid_versions = []

                for version in versions:
                    try:
                        valid_versions.append(
                            (Version(version["version"]), version)
                        )
                    except (KeyError, InvalidVersion):
                        continue

                if not valid_versions:
                    return {
                        "id": _resource_id,
                        "version": None,
                        "success": False
                    }

                latest = max(valid_versions, key=lambda x: x[0])[1]

                return {
                    "id": _resource_id,
                    "version": latest["version"],
                    "success": True
                }

            except Exception:
                return {
                    "id": _resource_id,
                    "version": None,
                    "success": False
                }

        results = await asyncio.gather(
            *(get_version(_resource_id) for _resource_id in body.ids)
        )

    return {
        "resources": results
    }
