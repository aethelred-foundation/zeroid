# ZeroID frontend: production-mode VPS runbook

This runbook serves the compiled ZeroID Next.js frontend on `0.0.0.0:3003`.
Port `3003` is reserved for the ZeroID frontend; the ZeroID backend uses
`4003`.

## 1. Configure the build

Use Node.js 20 or newer. From the ZeroID repository root:

```bash
cp .env.testnet.example .env.production.local
```

Set these values before building:

| Variable                                | Required value                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CHAIN_ENV`                 | `testnet`                                                                      |
| `NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL` | JSON-RPC URL reachable by users' browsers                                      |
| `NEXT_PUBLIC_ZEROID_API_URL`            | ZeroID backend URL reachable by users' browsers, normally `https://<api-host>` |
| `ZEROID_BACKEND_API_URL`                | HTTPS backend URL used by Next.js server-side routes                           |
| `NEXT_PUBLIC_*_ADDRESS`                 | Addresses from the ZeroID deployment manifest                                  |

`ZEROID_BACKEND_API_URL` is deliberately server-only. In the production
runtime it must use HTTPS and a public hostname, with no embedded credentials,
query, or fragment. Put Nginx, Caddy, or another TLS reverse proxy in front of
the backend. `NEXT_PUBLIC_*` values are compiled into browser bundles, so any
change to them requires rebuilding.

## 2. Build and smoke-test

```bash
npm ci
npm run build
npm run start
```

The last command stays in the foreground. In a second shell, verify the bound
production server:

```bash
curl --fail http://127.0.0.1:3003/api/health
```

Stop the foreground process after the check, then install the service below.
Never use `npm run dev` for the VPS service.

## 3. Run as a background service

The repository includes
`deployments/zeroid-frontend.service.example`. Copy it to systemd and replace
the example user, paths, and npm location with values from the VPS:

```bash
sudo cp deployments/zeroid-frontend.service.example /etc/systemd/system/zeroid-frontend.service
sudo systemctl daemon-reload
sudo systemctl enable --now zeroid-frontend
sudo systemctl status zeroid-frontend
```

The service executes `npm run start`; it does not run the development server or
rebuild on every restart. After pulling a frontend update, deploy it with:

```bash
npm ci
npm run build
sudo systemctl restart zeroid-frontend
curl --fail http://127.0.0.1:3003/api/health
```

Keep the previous release directory until this smoke test passes so the symlink
or service working directory can be rolled back.

## 4. Network boundary

Prefer exposing only ports 80/443 and proxying the public ZeroID hostname to
`127.0.0.1:3003`. If the team temporarily exposes port 3003 directly for
testnet, restrict it at the firewall where practical. The frontend API origin
must also be present in the backend's `CORS_ORIGINS` and
`ZEROID_ALLOWED_ORIGINS` configuration.

The production build is complete only when `npm run build` succeeds. Starting
an old `.next` directory after a failed build is not a valid deployment.
