from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    discord_client_id: str
    discord_client_secret: SecretStr
    discord_redirect_uri: str = "http://127.0.0.1:4785/api/auth/callback/discord"
    discord_guild_id: str | None = None
    discord_bot_token: SecretStr | None = None

    jwt_secret: SecretStr = Field(
        validation_alias=AliasChoices("JWT_SECRET", "NEXTAUTH_SECRET")
    )
    jwt_expires_minutes: int = 7 * 24 * 60
    jwt_issuer: str = "auto-resource-updater-auth"
    jwt_audience: str = "auto-resource-updater-desktop"


@lru_cache
def get_settings() -> Settings:
    return Settings()
