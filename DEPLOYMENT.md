# Self-Hosting Guide — Timetable Builder

This guide walks through deploying the app to your own VPS at
`timetable.seatofwisdomacademy.com`. It assumes a fresh Ubuntu 22.04 / 24.04
(or Debian 12) server with root or sudo access.

The app is a single Node.js process that serves both the API and the built
React frontend on one port. A PostgreSQL database stores all data.
Nginx terminates TLS and reverse-proxies to Node.

---

## 1. DNS

Create an `A` record for `timetable.seatofwisdomacademy.com` pointing to your
VPS public IPv4 address. Verify before continuing:

```bash
dig +short timetable.seatofwisdomacademy.com
```

## 2. Install system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ca-certificates ufw nginx postgresql-16

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Certbot for Let's Encrypt TLS
sudo apt install -y certbot python3-certbot-nginx
```

Open the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## 3. Create the PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER timetable WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
CREATE DATABASE timetable OWNER timetable;
SQL
```

Test the connection string locally:

```
postgres://timetable:CHANGE_ME_STRONG_PASSWORD@localhost:5432/timetable
```

## 4. Create a Google OAuth client (optional but recommended)

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Create Credentials → OAuth client ID → Web application**.
3. Add **Authorized redirect URI**:
   `https://timetable.seatofwisdomacademy.com/api/auth/google/callback`
4. Copy the Client ID and Client Secret — you'll put them in `.env`.

If you skip this, the "Continue with Google" button will return a 503 and
users can still register/sign in with email + password.

## 5. Deploy the application

Create an unprivileged user and clone the repo:

```bash
sudo adduser --system --group --home /opt/timetable timetable
sudo -u timetable git clone <YOUR_REPO_URL> /opt/timetable
cd /opt/timetable
sudo -u timetable npm ci
```

Create the environment file:

```bash
sudo -u timetable cp .env.example /opt/timetable/.env
sudo -u timetable nano /opt/timetable/.env
```

Fill in:
- `DATABASE_URL` — from step 3
- `SESSION_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `APP_URL` — `https://timetable.seatofwisdomacademy.com`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 4 (optional)
- `NODE_ENV=production`
- `PORT=5000`

Sync the schema and build:

```bash
sudo -u timetable bash -c 'set -a; source .env; set +a; npm run db:push'
sudo -u timetable npm run build
```

## 6. Run as a systemd service

Create `/etc/systemd/system/timetable.service`:

```ini
[Unit]
Description=Timetable Builder
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=timetable
Group=timetable
WorkingDirectory=/opt/timetable
EnvironmentFile=/opt/timetable/.env
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now timetable
sudo systemctl status timetable
```

Logs: `sudo journalctl -u timetable -f`

## 7. Nginx reverse proxy

Create `/etc/nginx/sites-available/timetable`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name timetable.seatofwisdomacademy.com;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/timetable /etc/nginx/sites-enabled/timetable
sudo nginx -t && sudo systemctl reload nginx
```

## 8. TLS with Let's Encrypt

```bash
sudo certbot --nginx -d timetable.seatofwisdomacademy.com \
  --redirect --agree-tos -m you@example.com --no-eff-email
```

Certbot installs a renewal timer automatically. Test renewal:

```bash
sudo certbot renew --dry-run
```

## 9. Smoke test

Visit `https://timetable.seatofwisdomacademy.com`. You should see the landing
page. Create an account with email/password, then sign out and sign back in.
If Google is configured, test that flow too.

## 10. Updating the app

```bash
cd /opt/timetable
sudo -u timetable git pull
sudo -u timetable npm ci
sudo -u timetable bash -c 'set -a; source .env; set +a; npm run db:push'
sudo -u timetable npm run build
sudo systemctl restart timetable
```

## Troubleshooting

- **502 Bad Gateway** — Node process isn't running. Check `journalctl -u timetable -f`.
- **"Missing required environment variable"** — Ensure `.env` is filled and the
  systemd unit's `EnvironmentFile` path matches.
- **Cookies not persisting after login** — Confirm `NODE_ENV=production`, that
  the site is served over HTTPS, and that Nginx forwards `X-Forwarded-Proto`.
- **Google login fails with redirect_uri_mismatch** — The redirect URI in
  Google Cloud Console must exactly match `${APP_URL}/api/auth/google/callback`.
