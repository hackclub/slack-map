# Slack Map – Deployment Guide

This guide covers deploying Slack Map on Hack Club's self-hosted server.

## Prerequisites

- Node.js 18+ installed on the server
- npm or yarn package manager
- A Slack workspace with a bot token (already configured in `.env`)
- A domain or subdomain pointing to your server (e.g., `slack.hackclub.com/map`)

## Environment Setup

The app requires one environment variable:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

This token should be set in your server's environment, not committed to git.

### Option 1: Use `.env` file (local/dev)
Create a `.env` file in the project root:
```
SLACK_BOT_TOKEN=xoxb-...
```

### Option 2: Use system environment variable (production)
Set the variable on your server:
```bash
export SLACK_BOT_TOKEN=xoxb-...
```

## Building for Production

### 1. Install dependencies
```bash
npm install
```

### 2. Build the app
```bash
npm run build
```

This creates a production build in the `build/` directory (compiled and optimized).

### 3. Preview locally (optional)
```bash
npm run preview
```

Then visit `http://localhost:5173` to test.

## Running the App

Once built, run the app with:

```bash
npm start
```

Or directly:
```bash
node build/index.js
```

The app will start on `http://localhost:3000` by default.

### Configure the Port

Set the `PORT` environment variable to use a different port:

```bash
PORT=8080 npm start
```

## Deployment on Self-Hosted Server

### Method 1: Using systemd (Recommended)

Create a systemd service file at `/etc/systemd/system/slack-map.service`:

```ini
[Unit]
Description=Slack Map - Workspace Channel Explorer
After=network.target

[Service]
Type=simple
User=slack-map
WorkingDirectory=/path/to/slack-map
Environment="SLACK_BOT_TOKEN=xoxb-..."
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable slack-map
sudo systemctl start slack-map
```

Check status:
```bash
sudo systemctl status slack-map
```

View logs:
```bash
sudo journalctl -u slack-map -f
```

### Method 2: Using Docker

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY build ./build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "build/index.js"]
```

Build the image:
```bash
docker build -t slack-map .
```

Run the container:
```bash
docker run -d \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -p 3000:3000 \
  --restart=always \
  --name slack-map \
  slack-map
```

### Method 3: Using PM2 (Node Process Manager)

Install PM2:
```bash
npm install -g pm2
```

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'slack-map',
      script: 'build/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN
      },
      instances: 1,
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '500M'
    }
  ]
};
```

Start with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

View logs:
```bash
pm2 logs slack-map
```

## Reverse Proxy Setup

If deploying behind a reverse proxy (nginx, Apache), configure it to forward requests to the app.

### Nginx Example

```nginx
server {
    listen 80;
    server_name slack.hackclub.com;

    location /map {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then reload nginx:
```bash
sudo systemctl reload nginx
```

## Health Check & Monitoring

The app responds to health checks at `/`. If the Slack API is unreachable, it will return an error.

Monitor the app's status:
- Check systemd: `sudo systemctl status slack-map`
- Check Docker: `docker ps | grep slack-map`
- Check PM2: `pm2 status`

## Updating the App

To deploy a new version:

1. Pull the latest code
2. Run `npm install` (if dependencies changed)
3. Run `npm run build`
4. Restart the service:
   ```bash
   sudo systemctl restart slack-map
   # or
   pm2 restart slack-map
   # or
   docker restart slack-map
   ```

## Troubleshooting

### App won't start
- Check the bot token is set: `echo $SLACK_BOT_TOKEN`
- Check logs: `sudo journalctl -u slack-map -f`
- Verify Node.js version: `node --version`

### API errors (channels not loading)
- Verify the bot token is valid and has permissions to list channels
- Check Slack API status: https://status.slack.com
- Review logs for error details

### Port already in use
- Kill the process: `sudo lsof -i :3000` then `kill -9 <PID>`
- Or use a different port: `PORT=3001 npm start`

### Reverse proxy issues
- Test direct connection: `curl http://localhost:3000`
- Check proxy logs and headers are being forwarded correctly
- Ensure CORS headers if needed

## Performance Optimization

For production:

1. **Enable compression**: Already handled by SvelteKit adapter
2. **Set NODE_ENV=production**: Ensures proper optimization
3. **Use a process manager**: Ensures auto-restart on crashes
4. **Monitor memory**: Set `max_memory_restart` in PM2
5. **Cache API responses**: Consider adding a caching layer if channels list is large

## Security

- Keep the bot token secure (use environment variables, not in code)
- Run the app with minimal privileges (dedicated `slack-map` user)
- Use HTTPS in production (configure via reverse proxy)
- Restrict access if needed (IP whitelisting, authentication)

## Support

For issues, check:
- [SvelteKit Deployment Docs](https://svelte.dev/docs/kit/adapter-node)
- [Slack API Docs](https://api.slack.com/)
