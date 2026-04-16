# PrecisionTimer — Deployment Guide

Real-time crypto TA dashboard with Swing/Scalp modes. Ships with a serverless proxy that solves Binance CORS issues, so it works in every browser including incognito mode.

## What's in this folder

```
precision-timer-deploy/
├── index.html          ← The dashboard (was precision-timer-v7.html)
├── api/
│   └── klines.js       ← Serverless proxy (Vercel function)
├── vercel.json         ← Vercel config
├── package.json        ← Node runtime spec
└── README.md           ← This file
```

## Deploy to Vercel (fastest — 3 minutes)

### Option A: Deploy via Vercel CLI (if you have it installed)

```bash
cd precision-timer-deploy
npx vercel --prod
```

Vercel will ask a few questions (project name, framework = "Other"), then give you a live URL like `https://precision-timer-xxx.vercel.app`.

### Option B: Deploy via Vercel Dashboard (no CLI needed)

1. Go to https://vercel.com/new
2. Sign in (free account, no credit card required)
3. Click **"Upload"** (or connect your GitHub if you push this folder to a repo)
4. Drag the entire `precision-timer-deploy` folder
5. Click **Deploy**
6. Done — you'll get a URL like `https://precision-timer-xxx.vercel.app`

### Option C: Deploy via GitHub + Vercel (best for updates)

1. Create a new GitHub repo
2. Push this folder to it
3. Go to https://vercel.com/new → Import the repo
4. Click Deploy
5. Any future `git push` auto-deploys

## Deploy to Cloudflare Workers (alternative)

If you prefer Cloudflare, the `api/klines.js` needs minor changes (Cloudflare uses a slightly different handler signature). Let me know and I'll generate a Cloudflare Workers version.

## How it works

Before (broken in incognito):
```
Browser → Binance API directly → CORS BLOCKED
```

After (works everywhere):
```
Browser → your-app.vercel.app/api/klines → Binance API → back to browser
         (same origin, no CORS)
```

The proxy:
- Whitelists valid Binance intervals (1m through 1w)
- Tries 6 Binance endpoints for redundancy
- Caches responses for 30s at the edge (reduces Binance load + faster responses)
- Adds `Access-Control-Allow-Origin: *` so any browser can call it
- Timeout: 10 seconds

## Testing locally

You can't test the proxy by just opening `index.html` from disk — the `/api/klines` path won't exist. Options:

1. **Use the fallback endpoints** — the HTML tries `/api/klines` first, but falls back to direct Binance endpoints if the proxy returns 404. So locally it'll use direct endpoints (same as before, with the CORS issues).

2. **Run Vercel dev server** (recommended):
   ```bash
   npm install -g vercel
   cd precision-timer-deploy
   vercel dev
   ```
   Opens at `http://localhost:3000` with the proxy working.

## Free tier limits

**Vercel Hobby (free):**
- 100 GB bandwidth/month
- Unlimited requests to serverless functions
- 10 second function timeout
- Commercial use: NOT allowed on free tier (upgrade to Pro at $20/month if monetizing)

**Cloudflare Workers (free):**
- 100,000 requests/day
- 10ms CPU time per request
- Commercial use: ALLOWED on free tier
- Better choice if you're charging for access to this dashboard

## Custom domain

After deploy:
1. Vercel dashboard → Your project → Settings → Domains
2. Add `dashboard.dadonomics.com` (or whatever domain you own)
3. Vercel shows DNS records to add to your registrar
4. SSL auto-provisioned

## If something breaks

Check `https://your-app.vercel.app/api/klines?symbol=ETHUSDT&interval=1h&limit=10` directly in your browser. Should return a JSON array of candles. If it returns an error, Vercel logs will show what happened (Dashboard → Project → Logs).
