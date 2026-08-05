# Backend de autenticacion

Servidor FastAPI encargado del OAuth de Discord y de emitir la sesion JWT usada por Electron.

## Desarrollo

1. Cree un entorno virtual: `python -m venv .venv`.
2. Active el entorno e instale: `pip install -r requirements.txt`.
3. Copie las variables de `.env.example` a `.env` y complete los valores.
4. Inicie el servidor: `python -m uvicorn app.main:app --host 127.0.0.1 --port 4785 --reload`.

La Redirect URI configurada en Discord debe ser exactamente:

`http://127.0.0.1:4785/api/auth/callback/discord`

En produccion publique este backend bajo HTTPS y cambie `DISCORD_REDIRECT_URI` tanto en el entorno como en el portal de Discord.
