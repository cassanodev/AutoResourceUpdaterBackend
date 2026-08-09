# Auto Resource Updater Backend

Backend central Node.js/Fastify para OAuth de Discord, cuentas, suscripciones,
afiliados, pagos y consulta de versiones Keymaster/CFX.

## Estructura

- `migrations/`: esquema MySQL versionado.
- `src/routes/`: contratos HTTP agrupados por dominio.
- `src/services/`: reglas de negocio y persistencia.
- `src/database.js`: pool MySQL asíncrono compartido.
- `scripts/`: operaciones administrativas, como registrar el webhook PayPal.
- Los módulos de recursos y preservación Lua existentes permanecen separados.

## Desarrollo

1. Instale Node.js 22 o superior y MySQL 8.
2. Copie `.env.example` a `.env` y complete las credenciales.
3. Ejecute `migrations/001_billing.sql` en MySQL.
4. Instale dependencias con `pnpm install`.
5. Inicie con recarga automática usando `pnpm dev`.

Producción: `pnpm start`.

El servidor escucha en `127.0.0.1:4785` de forma predeterminada. La Redirect
URI de Discord debe ser:

`http://127.0.0.1:4785/api/auth/callback/discord`

## API de plataforma

- `POST /api/accounts/get`
- `POST /api/trials/start`
- `POST /api/affiliates/get`
- `POST /api/affiliates/withdraw`
- `POST /api/crypto/deposits` (mock preparado para CoinPayments)
- `POST /api/billing/paypal/checkouts`
- `POST /api/paypal/webhooks`

## Webhook PayPal

Configure una URL HTTPS pública terminada en `/api/paypal/webhooks` como
`PAYPAL_WEBHOOK_URL` y ejecute `pnpm paypal:webhook:register`. Copie el
`PAYPAL_WEBHOOK_ID` resultante a `.env` y reinicie el backend. Cada evento se
verifica con PayPal y se guarda de forma idempotente antes de actualizar pagos.

## Rendimiento

- Pool HTTP persistente con keep-alive.
- Pool MySQL asíncrono con límite configurable.
- Hasta `CFX_CONCURRENCY` consultas simultáneas a CFX.
- Deduplicación de solicitudes en curso.
- Caché de versiones configurable con `VERSION_CACHE_MS`.
- Lotes de hasta 2.000 recursos por petición.
- Planes de actualización de hasta `UPDATE_BODY_LIMIT_MB`.
