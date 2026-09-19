# Render Deployment Guide

## What's Ready
- ✅ `render.yaml` - Configuration for API + Bot services
- ✅ `.renderignore` - Excludes dev files
- ✅ Code compiles to ESM JavaScript for production
- ✅ Server uses `PORT` env var (Render standard)
- ✅ Committed to Forgejo (commit `674959b`)

---

## Step 1: Sign Up / Login to Render

1. Go to **https://dashboard.render.com**
2. Click **"Sign In"**
3. Use **GitHub** (recommended) or email

---

## Step 2: Create API Web Service

1. Click **"New+" → "Web Service"**
2. Connect your repository:
   - Click **"Connect a Git Repo"**
   - Select **Forgejo** (or GitHub if you push there)
   - Choose `kousi/ink-finance` repo
3. Configure the service:
   - **Name**: `ink-finance-api`
   - **Root Directory**: leave blank
   - **Build Command**: `npm install && npm run build:server`
   - **Start Command**: `node dist/server/index.js`
   - **Instance Type**: Free
4. Add Environment Variables:
   ```
   NODE_ENV = production
   API_PORT = 10000
   DATABASE_URL = postgresql://neondb_owner:npg_2S4zltRpNEMq@ep-purple-sound-ayfxaygl-pooler.c-5.us-east-2.aws.neon.tech/ink_finance?sslmode=require
   BOT_TOKEN = 8646207104:AAHCdFUtqFRLq2CFTQ1I5XAH72ErcvPS71k
   AI_API_KEY = sk-nry-EEzkH8PX4lO2MStGivJcN5BoUAjinmyr209c0cviP94
   AI_BASE_URL = https://router.bynara.id/v1
   AI_MODEL = agnes-2.5-flash
   BOT_ALLOWED_USERS = (leave empty or add your Telegram ID)
   ```
5. Click **"Create Web Service"**

---

## Step 3: Create Bot Background Service

1. Click **"New+" → "Background Service"**
2. Select same repo: `kousi/ink-finance`
3. Configure:
   - **Name**: `ink-finance-bot`
   - **Build Command**: `npm install && npm run build:server`
   - **Start Command**: `node dist/telegram-bot/index.js`
   - **Instance Type**: Free
4. Add same Environment Variables (copy from API service)
5. Click **"Create Background Service"**

---

## Step 4: Verify Deployment

After both services deploy:

1. **API Health Check**: 
   - Visit `https://ink-finance-api.onrender.com/api/health`
   - Should return: `{"status":"ok","service":"ink-finance"}`

2. **Test Bot**:
   - Message `@inkfin_bot` on Telegram
   - Send `/start`
   - Send a receipt photo

---

## Notes

- **Free tier** has spin-down after 15 min inactivity (first request takes ~30 sec)
- **Database**: Using your existing Neon database - no new DB needed
- **Domain**: Free subdomain (`*.onrender.com`) available
- **Logs**: Check in Render dashboard for debugging

---

## Manual Deploy (Alternative)

If you prefer CLI:
```bash
# Install Render CLI
npm install -g @render-cloud/cli

# Login
render login

# Deploy from current directory
render up --region oregon
```
