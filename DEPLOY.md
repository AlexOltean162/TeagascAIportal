# Deploying the new AI Portal (replacing the current one)

This deploys the **AI Portal, Teag-Ask and the specialist assistants** (Policy, Staff Handbook, Research Papers).
TeagascGPT (LibreChat and its MCP servers) is a separate, later step; see the end of this guide.

Two servers, both on the company VPN, with no new DNS names or certificates:

```
Browser ──► HCUX402  nginx  (serves the AI Portal today, at /aiportal/)
              /aiportal/                       static portal + Assistants hub + Teag-Ask UI   (this repo)
              /aiportal/assistants/<app>/  ─┐
              /aiportal/teagask/api/       ─┴──► https://ai.teagasc.net/assistant-api/<app>/
                                                     │
            HCUX404  nginx  (ai.teagasc.net: LibreChat, /sites/, /code-api/, and now /assistant-api/)
              /assistant-api/research/  ──► 127.0.0.1:8000  Research Papers   (docker compose)
              /assistant-api/policy/    ──► 127.0.0.1:8020  Policy Assistant  (systemd)
              /assistant-api/handbook/  ──► 127.0.0.1:8030  Staff Handbook    (systemd)
              /assistant-api/teagask/   ──► 127.0.0.1:8040  Teag-Ask          (systemd)
              allowed from: HCUX402 and HCUX404 itself (and later its Docker networks, for TeagascGPT's MCP servers)
```

| Repo (private) | Branch | Server and path |
|---|---|---|
| `AlexOltean162/TeagascResearchAssistant` | `main` | HCUX404 `/opt/teagasc-rag` |
| `AlexOltean162/PoliciesAIAssistant` | `staff-handbook` | HCUX404 `/opt/policy-assistant` |
| `AlexOltean162/TeagAskAzure` | `main` | HCUX404 `/opt/teagask` |
| `AlexOltean162/TeagascAIportal` | `portal-redesign` | HCUX402 `/opt/aiportal`, published to the portal's web root |

Order: **HCUX404 first** (the backends and their nginx), then **swap the portal on HCUX402**. The current portal keeps
working until step 8's swap, and the swap itself takes seconds.

---

## 0. Azure (once, from a machine with `az login`)

Create one service principal for HCUX404. The Azure managed identities only work inside Azure.

```bash
az ad sp create-for-rbac --name teagasc-ai-server --years 2     # keep appId, password, tenant
APP=<appId>
SEARCH=$(az search service show -g rg-teagasc-ai-assistant-eu -n teagask-ai-search-4c0116 --query id -o tsv)
AOAI=$(az cognitiveservices account show -g rg-teagasc-ai-assistant-eu -n teagask-ai-4c0116 --query id -o tsv)
ST=$(az storage account show -g AiPolicies -n teagascpolicies --query id -o tsv)
az role assignment create --assignee $APP --role "Search Index Data Contributor"  --scope $SEARCH
az role assignment create --assignee $APP --role "Search Service Contributor"     --scope $SEARCH
az role assignment create --assignee $APP --role "Cognitive Services OpenAI User" --scope $AOAI
az role assignment create --assignee $APP --role "Storage Blob Data Reader" --scope $ST/blobServices/default/containers/policies-mirror-sp
az role assignment create --assignee $APP --role "Storage Blob Data Reader" --scope $ST/blobServices/default/containers/staff-handbook-mirror-sp
```

**Also have ready:**
- An OpenAI API key (Research, Policy, Handbook).
- A free OpenAlex API key (Research crawl).
- A strong Postgres password.

The Logic Apps (`Sharepoint2Blob`, `Handbook2Blob`) and the search indexes already run in Azure; nothing to deploy
there.

---

## HCUX404: the assistant backends

### 1. Check the ports are free and install packages

```bash
sudo ss -ltnp | grep -E ':(8000|8020|8030|8040|5433)\b' || echo "all free"
sudo apt update && sudo apt install -y git python3.12 python3.12-venv tesseract-ocr
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh
gh auth login        # or add a read-only deploy key to each private repo
df -h /var/lib/docker /opt    # Research's document corpus needs ~15 GB
```

Docker and Compose are already installed for LibreChat.

### 2. Research Papers (docker compose, 127.0.0.1:8000)

```bash
sudo git clone https://github.com/AlexOltean162/TeagascResearchAssistant.git /opt/teagasc-rag
cd /opt/teagasc-rag
sudo cp .env.example .env && sudo chmod 600 .env
sudo nano .env      # OPENAI_API_KEY, OPENALEX_API_KEY, CONTACT_EMAIL, POSTGRES_PASSWORD
sudo docker compose up -d --build
sudo docker compose exec app python -m teagasc_rag init-db
sudo docker compose exec app python -m teagasc_rag update     # re-crawls the corpus: ~1 h + a few hours of OpenAI batches
curl -s http://127.0.0.1:8000/health                           # {"ok":true}
```

Weekly refresh: add to `sudo crontab -e`:

```cron
0 2 * * 0 cd /opt/teagasc-rag && docker compose exec -T app python -m teagasc_rag update >> logs/update.log 2>&1
```

Research answers even while the crawl is still running, but only from what has been loaded so far.

### 3. Policy Assistant and Staff Handbook (systemd, 127.0.0.1:8020 and :8030)

```bash
sudo useradd --system --home /opt/policy-assistant policy-assistant
sudo git clone -b staff-handbook https://github.com/AlexOltean162/PoliciesAIAssistant.git /opt/policy-assistant
cd /opt/policy-assistant && sudo uv sync --no-dev
sudo mkdir -p /etc/policy-assistant
sudo cp .env.example /etc/policy-assistant/policy-assistant.env
sudo cp handbook.env.example /etc/policy-assistant/handbook.env
sudo nano /etc/policy-assistant/policy-assistant.env
sudo nano /etc/policy-assistant/handbook.env
```

In both files, set `OPENAI_API_KEY`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (the service
principal from step 0). Leave the `*_API_KEY` and `STORAGE_ACCOUNT_KEY` lines empty.

```bash
sudo chown policy-assistant /etc/policy-assistant/*.env && sudo chmod 600 /etc/policy-assistant/*.env
sudo cp deploy/{policy-assistant,handbook-assistant,policy-ingest,handbook-ingest}.service \
        deploy/{policy-ingest,handbook-ingest}.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now policy-assistant handbook-assistant policy-ingest.timer handbook-ingest.timer
sudo systemctl start policy-ingest handbook-ingest       # first sync (the indexes already exist, so it's quick)
curl -s http://127.0.0.1:8020/healthz; curl -s http://127.0.0.1:8030/healthz   # "status":"ok"
```

### 4. Teag-Ask (systemd, 127.0.0.1:8040)

```bash
sudo useradd --system --home /opt/teagask teagask
sudo git clone https://github.com/AlexOltean162/TeagAskAzure.git /opt/teagask
sudo python3.12 -m venv /opt/teagask/.venv
sudo /opt/teagask/.venv/bin/pip install -r /opt/teagask/app/requirements.txt
sudo mkdir -p /etc/teagask && sudo cp /opt/teagask/app/teagask.env.example /etc/teagask/teagask.env
sudo nano /etc/teagask/teagask.env        # AZURE_CLIENT_ID and AZURE_CLIENT_SECRET (service principal from step 0)
sudo chown teagask /etc/teagask/teagask.env && sudo chmod 600 /etc/teagask/teagask.env
sudo cp /opt/teagask/deploy/teagask.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now teagask
curl -s http://127.0.0.1:8040/api/access      # {"ok":true}
```

### 5. Expose them to HCUX402 through HCUX404's nginx

On **HCUX402**, run `hostname -I` and note its address.

On **HCUX404**:
1. Get the nginx file by cloning the portal repo here too: `sudo git clone -b portal-redesign
   https://github.com/AlexOltean162/TeagascAIportal.git /opt/aiportal`.
2. Paste the `location /assistant-api/ { ... }` block from `/opt/aiportal/deploy/nginx-hcux404-assistant-api.conf`
   into the existing `server { server_name ai.teagasc.net; }` block, next to `/code-api/`.
3. Replace `HCUX402_IP` with the address you noted.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://ai.teagasc.net/assistant-api/research/health       # from HCUX404: {"ok":true}
```

### 6. Check from HCUX402

```bash
curl -s https://ai.teagasc.net/assistant-api/research/health
curl -s https://ai.teagasc.net/assistant-api/policy/healthz
curl -s https://ai.teagasc.net/assistant-api/handbook/healthz
curl -s https://ai.teagasc.net/assistant-api/teagask/api/access
```

All four should answer. From any other machine they should return **403**.

---

## HCUX402: swap the portal

### 7. Find the current portal and back it up

```bash
sudo grep -rn "aiportal" /etc/nginx/        # shows the server block and the folder (root/alias) serving /aiportal/
WEBROOT=/var/www/aiportal                   # <- set to the folder from the line above
ls -la $WEBROOT                             # note anything not in the new repo you want to keep
sudo cp -a $WEBROOT $WEBROOT.bak-$(date +%F)
sudo cp /etc/nginx/sites-enabled/<that file> ~/nginx-aiportal.bak-$(date +%F)
```

### 8. Install the new portal next to the old one, then swap

```bash
sudo git clone -b portal-redesign https://github.com/AlexOltean162/TeagascAIportal.git /opt/aiportal
sudo rsync -a --exclude .git --exclude deploy --exclude DEPLOY.md /opt/aiportal/ $WEBROOT.new/
sudo cp /opt/aiportal/deploy/aiportal-assistant-proxy.conf /etc/nginx/snippets/
```

Edit the nginx server block that serves `/aiportal/`:
1. Paste in the locations from `/opt/aiportal/deploy/nginx-hcux402-portal.conf`.
2. Add `add_header Cache-Control "no-cache";` inside the existing `/aiportal/` location.

Then validate the config and swap:

```bash
sudo nginx -t
sudo mv $WEBROOT $WEBROOT.old && sudo mv $WEBROOT.new $WEBROOT && sudo systemctl reload nginx
```

### 9. Check it on the VPN

- **Portal:** open `https://teagask.teagasc.net/aiportal/`. You should see three tiles, the AI Policy and AI literacy
  training cards, and no MyData link.
- **Teag-Ask:** opens with no access screen and has a "← AI Portal" link. Ask a farming question, including a DAFM
  scheme question.
- **Assistants:** Policy, Staff Handbook and Research Papers all open as chats; none shows "isn't available".
  - Policy: *What is the policy on working from home?*
  - Staff Handbook: *Can I carry over annual leave?*
  - Research: *What has Teagasc published on grassland research?* The plan should tick off its steps; it finishes in
    about 2–3 minutes.
- **Logs:**
  - On HCUX404: `journalctl -u policy-assistant -u handbook-assistant -u teagask -f`
  - Research: `sudo docker compose -f /opt/teagasc-rag/docker-compose.yml logs -f app`
  - On HCUX402: the nginx error log.

### Rolling back the portal

```bash
sudo mv $WEBROOT $WEBROOT.new && sudo mv $WEBROOT.old $WEBROOT
sudo cp ~/nginx-aiportal.bak-<date> /etc/nginx/sites-enabled/<that file> && sudo nginx -t && sudo systemctl reload nginx
```

Once the new portal has run well for a while, remove `$WEBROOT.old` and the backups.

---

## Updating later

| What changed | Where | Run |
|---|---|---|
| Portal or hub | HCUX402 | `cd /opt/aiportal && sudo git pull && sudo rsync -a --exclude .git --exclude deploy --exclude DEPLOY.md /opt/aiportal/ $WEBROOT/` |
| Teag-Ask UI | dev machine | `python deploy/sync_teagask.py <TeagAskAzure>/app/frontend-dist`, commit and push, then update the portal as above |
| Research | HCUX404 | `cd /opt/teagasc-rag && sudo git pull && sudo docker compose up -d --build` |
| Policy or Handbook | HCUX404 | `cd /opt/policy-assistant && sudo git pull && sudo uv sync --no-dev && sudo systemctl restart policy-assistant handbook-assistant` |
| Teag-Ask backend | HCUX404 | `cd /opt/teagask && sudo git pull && sudo systemctl restart teagask` |

## The Azure Teag-Ask container app

`teagasc-ai-assistant` has its public ingress off but was not deleted. Its latest revision (the DAFM image,
`dafm-20261014`) is active with one replica, so it still costs money while nothing can reach it. Once the
self-hosted Teag-Ask is confirmed working, deactivate that revision or delete the app. To bring it back instead,
re-enable ingress on the image's port:

```bash
az containerapp ingress enable -g rg-teagasc-ai-assistant-eu -n teagasc-ai-assistant --type external --target-port <port>
```

---

## Later: connecting TeagascGPT (LibreChat and its MCP servers)

Do this when you deploy the MCP servers. Until then, TeagascGPT's TeagAsk knowledge tool doesn't work: its current
config calls the Azure container app, whose public address was switched off on 2026-10-13. The portal and
assistants above don't depend on TeagascGPT.

The `/assistant-api/` location on HCUX404 already allows HCUX404's Docker networks (`172.16.0.0/12`), so the MCP
containers can call the same APIs. If you'd rather not allow that until then, comment out that `allow` line.

### Point the TeagAsk tool at the self-hosted Teag-Ask

In the infrastructure repo on HCUX404 (`deploy/hcux404/mcp/`), make two changes.

**`.env`:**

```bash
TEAGASK_BACKEND_URL=https://ai.teagasc.net/assistant-api/teagask
TEAGASK_APP_KEY=
```

**`docker-compose.yml`**, `knowledge-mcp` service: add `ai.teagasc.net` next to the existing `host.docker.internal`
entry, so the container reaches HCUX404's nginx (the LibreChat container already does this):

```yaml
    extra_hosts: ["host.docker.internal:host-gateway", "ai.teagasc.net:host-gateway"]
```

Then restart and test:

```bash
docker compose up -d knowledge-mcp
docker compose exec knowledge-mcp python -c "import httpx;print(httpx.get('https://ai.teagasc.net/assistant-api/teagask/health').status_code)"
```

Also delete the old Azure `TEAGASK_APP_KEY` value; the self-hosted Teag-Ask has no key.

Leave `POLICIES_BACKEND_URL`, `RESEARCH_BACKEND_URL` and `HANDBOOK_BACKEND_URL` alone for now. The knowledge-mcp
expects `/answer` and `/search` endpoints, and the new Policy, Handbook and Research apps don't have those yet.
