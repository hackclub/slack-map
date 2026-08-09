# Slack Map

An interactive archipelago explorer for Slack workspaces. Visualize channels as thematic islands and discover your workspace in a fun, engaging way.

## Quick Start

### Prerequisites
- Node.js 18+
- A Slack bot token with permissions to list channels

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your SLACK_BOT_TOKEN
   ```

3. **Start dev server:**
   ```bash
   npm run dev
   # Opens at http://localhost:5173
   ```

4. **Type checking:**
   ```bash
   npm run check
   ```

## Building for Production

```bash
npm run build
npm start
```

The app will serve on `http://localhost:3000`

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions on deploying to:
- systemd (Linux service)
- Docker
- PM2 (Node process manager)
- Behind nginx/Apache

## Project Structure

```
src/
├── lib/
│   ├── index.ts        # Library exports
│   └── slack.ts        # Slack API client
├── routes/
│   ├── +page.svelte    # Main map component
│   └── api/
│       └── slack-channels/  # API endpoints for fetching channels
└── app.d.ts            # Type definitions
```

## Features

- 🗺️ Interactive island-based visualization of Slack channels
- 🎨 Thematic islands for different channel categories
- 📱 Responsive design for all devices
- 🔍 Channel discovery and exploration
- ⚡ Fast loading with real Slack workspace data

## Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Your Slack workspace bot token

Optional:
- `PORT` - Server port (default: 3000 in production, 5173 in dev)
- `NODE_ENV` - Set to `production` for production builds

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run preview` - Preview production build locally
- `npm run check` - Run type checking

## License

MIT
