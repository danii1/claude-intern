# Webhook Server Deployment Guide

This guide covers secure deployment options for the claude-intern webhook server to automatically address PR review comments.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Exposure Options](#exposure-options)
  - [Option 1: Cloudflare Tunnel (Recommended)](#option-1-cloudflare-tunnel-recommended)
  - [Option 2: Tailscale Funnel](#option-2-tailscale-funnel)
  - [Option 3: Reverse Proxy (Caddy/nginx)](#option-3-reverse-proxy-caddynginx)
  - [Option 4: Direct Exposure (Not Recommended)](#option-4-direct-exposure-not-recommended)
- [Security Layers](#security-layers)
- [GitHub App Configuration](#github-app-configuration)
- [Running the Server](#running-the-server)
- [Monitoring & Troubleshooting](#monitoring--troubleshooting)

## Overview

The webhook server listens for GitHub PR review events and automatically runs Claude to address review feedback. The architecture looks like:

```
GitHub → [Exposure Layer] → Webhook Server → Claude → Git Push
```

**Key Security Principle**: The webhook server should never be directly exposed to the internet. Always use one of the secure exposure options below.

## Prerequisites

1. **GitHub App** configured with webhook permissions
2. **Webhook Secret** - a random string for request verification
3. **Claude CLI** installed and configured
4. **Git credentials** with push access to target repositories

Generate a webhook secret:
```bash
openssl rand -hex 32
```

## Exposure Options

### Option 1: Cloudflare Tunnel (Recommended)

**Zero open ports** - Cloudflare Tunnel creates an outbound-only connection from your server to Cloudflare's edge network.

**Pros:**
- No inbound ports to open on your firewall
- Free tier available
- DDoS protection included
- Automatic HTTPS
- Works behind NAT/firewalls

**Setup:**

1. Install cloudflared:
```bash
# macOS
brew install cloudflared

# Linux
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
```

2. Authenticate:
```bash
cloudflared tunnel login
```

3. Create a tunnel:
```bash
cloudflared tunnel create claude-intern-webhooks
```

4. Configure DNS (creates webhooks.yourdomain.com):
```bash
cloudflared tunnel route dns claude-intern-webhooks webhooks.yourdomain.com
```

5. Create config file (`~/.cloudflared/config.yml`):
```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /path/to/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

6. Run the tunnel:
```bash
# Foreground
cloudflared tunnel run claude-intern-webhooks

# Or as a service
sudo cloudflared service install
sudo systemctl start cloudflared
```

**Final architecture:**
```
GitHub → Cloudflare Edge → Cloudflare Tunnel → localhost:3000
                                                    ↓
                                          Webhook Server (no open ports)
```

---

### Option 2: Tailscale Funnel

If you already use Tailscale for your network, Funnel provides a simple way to expose services.

**Pros:**
- Simple one-command setup
- Integrates with existing Tailscale network
- Automatic HTTPS with valid certificates

**Setup:**

1. Enable Funnel in Tailscale admin console (requires admin access)

2. Start the funnel:
```bash
tailscale funnel 3000
```

3. Your webhook URL will be: `https://your-machine-name.tailnet-name.ts.net`

**Note:** Tailscale Funnel has some limitations on free plans. Check [Tailscale Funnel docs](https://tailscale.com/kb/1223/tailscale-funnel/).

---

### Option 3: Reverse Proxy (Caddy/nginx)

Use when you have a server with a public IP and want full control.

#### Caddy (Automatic HTTPS)

1. Install Caddy:
```bash
# Debian/Ubuntu
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# macOS
brew install caddy
```

2. Configure (`/etc/caddy/Caddyfile`):
```caddyfile
webhooks.yourdomain.com {
    reverse_proxy localhost:3000

    # Rate limiting
    rate_limit {
        zone webhooks {
            key {remote_host}
            events 30
            window 1m
        }
    }

    # Optional: IP allowlisting for GitHub
    # See "GitHub IP Ranges" section below for current IPs
    @blocked not remote_ip 140.82.112.0/20 143.55.64.0/20 185.199.108.0/22 192.30.252.0/22
    respond @blocked 403
}
```

3. Start Caddy:
```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

#### nginx

1. Configure (`/etc/nginx/sites-available/webhooks`):
```nginx
server {
    listen 443 ssl http2;
    server_name webhooks.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/webhooks.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webhooks.yourdomain.com/privkey.pem;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=webhooks:10m rate=30r/m;

    location / {
        limit_req zone=webhooks burst=5;

        # Optional: GitHub IP allowlisting
        # allow 140.82.112.0/20;
        # allow 143.55.64.0/20;
        # allow 185.199.108.0/22;
        # allow 192.30.252.0/22;
        # deny all;

        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

2. Get SSL certificate:
```bash
sudo certbot certonly --nginx -d webhooks.yourdomain.com
```

3. Enable and start:
```bash
sudo ln -s /etc/nginx/sites-available/webhooks /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### Option 4: Direct Exposure (Not Recommended)

**⚠️ Only use this for testing with tools like ngrok**

```bash
# ngrok (temporary testing only)
ngrok http 3000
```

Never expose the webhook server directly to the internet in production.

---

## Security Layers

Regardless of which exposure method you choose, **always implement these security measures**:

### 1. Webhook Signature Verification (Critical)

This is implemented in claude-intern and **cannot be bypassed**. GitHub signs every webhook with your secret:

```bash
# Set your webhook secret
export WEBHOOK_SECRET="your-random-secret-here"
```

The server will reject any request without a valid `X-Hub-Signature-256` header.

### 2. GitHub IP Allowlisting (Recommended)

GitHub publishes their webhook IP ranges at `https://api.github.com/meta`. Current ranges (may change):

```
140.82.112.0/20
143.55.64.0/20
185.199.108.0/22
192.30.252.0/22
```

**Dynamically fetch current IPs:**
```bash
curl -s https://api.github.com/meta | jq '.hooks'
```

### 3. Rate Limiting

Prevent abuse even from valid sources. Recommended limits:
- 30 requests per minute per IP
- Burst of 5 requests

### 4. Firewall Rules (OS-level)

If using direct exposure or reverse proxy, add firewall rules:

```bash
# UFW (Ubuntu)
sudo ufw allow from 140.82.112.0/20 to any port 3000
sudo ufw allow from 143.55.64.0/20 to any port 3000
sudo ufw allow from 185.199.108.0/22 to any port 3000
sudo ufw allow from 192.30.252.0/22 to any port 3000

# iptables
iptables -A INPUT -p tcp --dport 3000 -s 140.82.112.0/20 -j ACCEPT
iptables -A INPUT -p tcp --dport 3000 -s 143.55.64.0/20 -j ACCEPT
iptables -A INPUT -p tcp --dport 3000 -j DROP
```

### 5. TLS/HTTPS (Required by GitHub)

GitHub requires HTTPS for production webhooks. All exposure options above provide automatic HTTPS except direct exposure.

---

## GitHub App Configuration

### Update App Permissions

Add these permissions to your GitHub App:

1. Go to your GitHub App settings
2. Navigate to **Permissions & events**
3. Under **Repository permissions**, add:
   - **Pull request review comments**: Read and write
4. Under **Subscribe to events**, enable:
   - Pull request review
   - Pull request review comment

### Configure Webhook

1. In your GitHub App settings, go to **Webhooks**
2. Set **Webhook URL** to your server's URL (e.g., `https://webhooks.yourdomain.com/webhooks/github`)
3. Set **Secret** to your `WEBHOOK_SECRET`
4. Select content type: `application/json`
5. Enable events:
   - Pull request reviews
   - Pull request review comments

---

## Running the Server

### Environment Variables

```bash
# Required
export WEBHOOK_SECRET="your-webhook-secret"

# GitHub App authentication (same as PR creation)
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY_PATH="/path/to/key.pem"
# OR
export GITHUB_APP_PRIVATE_KEY_BASE64="..."

# Optional
export WEBHOOK_PORT="3000"        # Default: 3000
export WEBHOOK_HOST="0.0.0.0"     # Default: 0.0.0.0
export WEBHOOK_AUTO_REPLY="true"  # Reply to addressed comments
export WEBHOOK_AUTO_REVIEW="true" # Run self-review loop after addressing feedback
export WEBHOOK_AUTO_REVIEW_MAX_ITERATIONS="5"  # Max review iterations (default: 5)
```

### Start the Server

```bash
# Development
bun run src/webhook-server.ts

# Production (after build)
claude-intern serve --port 3000

# With PM2 (process manager)
pm2 start "claude-intern serve" --name claude-intern-webhooks
```

### Systemd Service (Linux)

Create `/etc/systemd/system/claude-intern-webhooks.service`:

```ini
[Unit]
Description=Claude Intern Webhook Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/your/projects
Environment=WEBHOOK_SECRET=your-secret
Environment=GITHUB_APP_ID=123456
Environment=GITHUB_APP_PRIVATE_KEY_PATH=/path/to/key.pem
Environment=WEBHOOK_AUTO_REPLY=true
Environment=WEBHOOK_AUTO_REVIEW=true
ExecStart=/usr/local/bin/claude-intern serve --port 3000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-intern-webhooks
sudo systemctl start claude-intern-webhooks
```

---

## Monitoring & Troubleshooting

### Logs

```bash
# Systemd
journalctl -u claude-intern-webhooks -f

# PM2
pm2 logs claude-intern-webhooks
```

### Health Check

The server exposes a health endpoint:

```bash
curl https://webhooks.yourdomain.com/health
# {"status": "ok", "timestamp": "..."}
```

### Test Webhook Delivery

1. Go to your GitHub App settings → **Advanced**
2. View **Recent Deliveries**
3. Check response codes and bodies
4. Use **Redeliver** to test

### Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | Check `WEBHOOK_SECRET` matches GitHub App config |
| 403 Forbidden | Check IP allowlisting if enabled |
| 500 Internal Error | Check server logs for stack trace |
| Timeout | Ensure Claude CLI is installed and working |
| No webhook received | Check GitHub App webhook URL and events |

### Debug Mode

Run with verbose logging:

```bash
WEBHOOK_DEBUG=true claude-intern serve
```

---

## Security Checklist

Before going to production:

- [ ] Webhook secret is set and matches GitHub App
- [ ] HTTPS is enabled (automatic with recommended options)
- [ ] Rate limiting is configured
- [ ] IP allowlisting is enabled (optional but recommended)
- [ ] Server runs as non-root user
- [ ] Logs are being collected
- [ ] Health monitoring is set up
- [ ] Firewall rules are configured (if applicable)

---

## Quick Start Summary

**Fastest secure setup (Cloudflare Tunnel):**

```bash
# 1. Install cloudflared
brew install cloudflared  # or appropriate package manager

# 2. Create tunnel
cloudflared tunnel login
cloudflared tunnel create claude-intern
cloudflared tunnel route dns claude-intern webhooks.yourdomain.com

# 3. Set environment
export WEBHOOK_SECRET=$(openssl rand -hex 32)
export GITHUB_APP_ID="your-app-id"
export GITHUB_APP_PRIVATE_KEY_PATH="/path/to/key.pem"

# 4. Start server
claude-intern serve &

# 5. Start tunnel
cloudflared tunnel run claude-intern

# 6. Configure GitHub App webhook URL to:
#    https://webhooks.yourdomain.com/webhooks/github
```

Your webhook server is now securely exposed with zero open ports!
