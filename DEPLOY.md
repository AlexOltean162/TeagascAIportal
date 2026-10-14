# Deploying the AI Portal and its assistants on the Linux server

Everything runs on the one server, behind the existing `ai.teagasc.net` nginx, on the company VPN. The portal is the
only interface. The apps listen on localhost only, and there is no sign-in or chat history (LibreChat is separate).

```
https://ai.teagasc.net/aiportal/                  static portal + Assistants hub      (this repo)
          /aiportal/teagask/                      Teag-Ask UI (copied into this repo)
          /aiportal/teagask/api/          ──►  127.0.0.1:8040  Teag-Ask API           (TeagAskAzure)
          /aiportal/assistants/research/  ──►  127.0.0.1:8000  Research Papers API    (TeagascResearchAssistant, Docker)
          /aiportal/assistants/policy/    ──►  127.0.0.1:8020  Policy Assistant API   (PoliciesAIAssistant)
          /aiportal/assistants/handbook/  ──►  127.0.0.1:8030  Staff Handbook API     (PoliciesAIAssistant, handbook.env)
```

| Repo (private unless noted) | Branch | Goes to |
|---|---|---|
| `AlexOltean162/TeagascAIportal` (portal) | `portal-redesign` | `/opt/aiportal`, published to the nginx web root |
| `AlexOltean162/TeagascResearchAssistant` | `main` | `/opt/teagasc-rag` |
| `AlexOltean162/PoliciesAIAssistant` | `staff-handbook` | `/opt/policy-assistant` |
| `AlexOltean162/TeagAskAzure` | `main` | `/opt/teagask` |

Once `portal-redesign` and `staff-handbook` are merged, clone the default branches instead.

---

## 0. Before you start (from a machine with `az login`)

**One service principal for the server.** The Azure managed identities only work inside Azure, so the server needs
its own identity.

```bash
az ad sp create-for-rbac --name teagasc-ai-server --years 2
```

Keep the `appId`, `password` and `tenant` it prints. Then grant its roles:

```bash
APP=<appId>
SEARCH=$(az search service show -g rg-teagasc-ai-assistant-eu -n teagask-ai-search-4c0116 --query id -o tsv)
AOAI=$(az cognitiveservices account show -g rg-teagasc-ai-assistant-eu -n teagask-ai-4c0116 --query id -o tsv)
ST=$(az storage account show -g AiPolicies -n teagascpolicies --query id -o tsv)
az role assignment create --assignee $APP --role "Search Index Data Contributor" --scope $SEARCH
az role assignment create --assignee $APP --role "Search Service Contributor"    --scope $SEARCH
az role assignment create --assignee $APP --role "Cognitive Services OpenAI User" --scope $AOAI
az role assignment create --assignee $APP --role "Storage Blob Data Reader" --scope $ST/blobServices/default/containers/policies-mirror-sp
az role assignment create --assignee $APP --role "Storage Blob Data Reader" --scope $ST/blobServices/default/containers/staff-handbook-mirror-sp
```

**Also have ready:**
- An **OpenAI API key**, used by Research, Policy and Handbook.
- An **OpenAlex API key** (free, from openalex.org/settings) for the Research crawl.
- A strong **Postgres password**.

The Logic Apps (`Sharepoint2Blob`, `Handbook2Blob`) and the search indexes already run in Azure, so there's nothing
to deploy for them.

## 1. Server packages and GitHub access

```bash
sudo apt update
sudo apt install -y git rsync python3.12 python3.12-venv tesseract-ocr docker.io docker-compose-v2
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh
```

The repos are private. The simplest way in is `gh auth login`, or add a read-only deploy key to each repo.

## 2. Research Papers (Docker, port 8000)

```bash
sudo git clone https://github.com/AlexOltean162/TeagascResearchAssistant.git /opt/teagasc-rag
cd /opt/teagasc-rag
sudo cp .env.example .env && sudo chmod 600 .env
sudo nano .env      # OPENAI_API_KEY, OPENALEX_API_KEY, CONTACT_EMAIL, POSTGRES_PASSWORD
sudo docker compose up -d --build
```

The document corpus is not in git, so rebuild it. This takes about 1 hour of harvest and downloads plus a few hours
of OpenAI batches:

```bash
sudo docker compose exec app python -m teagasc_rag init-db
sudo docker compose exec app python -m teagasc_rag update
```

Weekly refresh: add this to root's crontab (`sudo crontab -e`):

```cron
0 2 * * 0 cd /opt/teagasc-rag && docker compose exec -T app python -m teagasc_rag update >> logs/update.log 2>&1
```

Check: `curl localhost:8000/health` returns `{"ok":true}`.

## 3. Policy Assistant and Staff Handbook (systemd, ports 8020 and 8030)

```bash
sudo useradd --system --home /opt/policy-assistant policy-assistant
sudo git clone -b staff-handbook https://github.com/AlexOltean162/PoliciesAIAssistant.git /opt/policy-assistant
cd /opt/policy-assistant && sudo uv sync --no-dev
sudo mkdir -p /etc/policy-assistant
sudo cp .env.example /etc/policy-assistant/policy-assistant.env
sudo cp handbook.env.example /etc/policy-assistant/handbook.env
```

Edit both env files and set the same values in each:
- `OPENAI_API_KEY`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` (the service principal from step 0)

Leave the `*_API_KEY` and `STORAGE_ACCOUNT_KEY` lines empty. Then lock the files down:

```bash
sudo chown policy-assistant /etc/policy-assistant/*.env && sudo chmod 600 /etc/policy-assistant/*.env
sudo cp deploy/policy-assistant.service deploy/policy-ingest.service deploy/policy-ingest.timer \
        deploy/handbook-assistant.service deploy/handbook-ingest.service deploy/handbook-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now policy-assistant handbook-assistant policy-ingest.timer handbook-ingest.timer
sudo systemctl start policy-ingest handbook-ingest     # first sync; both indexes already exist, so this is quick
```

Check: `curl localhost:8020/healthz` and `curl localhost:8030/healthz` both return `"status":"ok"`.

## 4. Teag-Ask (systemd, port 8040)

```bash
sudo useradd --system --home /opt/teagask teagask
sudo git clone https://github.com/AlexOltean162/TeagAskAzure.git /opt/teagask
sudo python3.12 -m venv /opt/teagask/.venv
sudo /opt/teagask/.venv/bin/pip install -r /opt/teagask/app/requirements.txt
sudo mkdir -p /etc/teagask && sudo cp /opt/teagask/app/teagask.env.example /etc/teagask/teagask.env
sudo nano /etc/teagask/teagask.env      # AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (service principal from step 0)
sudo chown teagask /etc/teagask/teagask.env && sudo chmod 600 /etc/teagask/teagask.env
sudo cp /opt/teagask/deploy/teagask.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now teagask
```

Check: `curl localhost:8040/api/access` returns `{"ok":true}`.

## 5. The portal (static files and nginx)

Find the folder your existing `/aiportal/` location serves:

```bash
grep -rn "aiportal" /etc/nginx/
```

The examples below assume it is `/var/www/aiportal`. Back it up first:

```bash
sudo cp -a /var/www/aiportal /var/www/aiportal.bak-$(date +%F)
sudo git clone -b portal-redesign https://github.com/AlexOltean162/TeagascAIportal.git /opt/aiportal
sudo rsync -a --exclude .git --exclude deploy --exclude DEPLOY.md /opt/aiportal/ /var/www/aiportal/
```

In the `ai.teagasc.net` server block:
1. Paste the `location` blocks from [deploy/nginx-assistants.conf](deploy/nginx-assistants.conf), next to the
   existing `/aiportal/` location.
2. Add `add_header Cache-Control "no-cache";` inside the existing `/aiportal/` location, so browsers never keep an
   old copy of the hub.

Then test the config and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Check it end to end (on the VPN)

- Open `https://ai.teagasc.net/aiportal/`. You should see three tiles, the AI Policy and AI literacy training cards,
  and no MyData link.
- **Teag-Ask:** opens with no access screen, and has a "← AI Portal" link. Ask a farming question.
- **Assistants:** all three open as chats; none shows "isn't available".
  - Policy: *What is the policy on working from home?*
  - Staff Handbook: *Can I carry over annual leave?* There should be no department dropdown.
  - Research: *What has Teagasc published on grassland research?* The research plan should tick off its steps,
    finishing in about 2–3 minutes.
- Logs: `journalctl -u policy-assistant -u handbook-assistant -u teagask -f` and
  `sudo docker compose -f /opt/teagasc-rag/docker-compose.yml logs -f app`.

## Updating later

| What changed | Run |
|---|---|
| Portal or hub | `cd /opt/aiportal && sudo git pull`, then the `rsync` from step 5 |
| Teag-Ask UI | On a dev machine: `python deploy/sync_teagask.py <TeagAskAzure>/app/frontend-dist`, commit, then update the portal as above |
| Research | `cd /opt/teagasc-rag && sudo git pull && sudo docker compose up -d --build` |
| Policy or Handbook | `cd /opt/policy-assistant && sudo git pull && sudo uv sync --no-dev && sudo systemctl restart policy-assistant handbook-assistant` |
| Teag-Ask backend | `cd /opt/teagask && sudo git pull && sudo systemctl restart teagask` |

## Rolling back Teag-Ask to Azure

The Azure container app `teagasc-ai-assistant` had its ingress disabled on 2026-10-13; it was not deleted. To bring
it back, re-enable ingress on the port the image listens on. The port wasn't recorded when ingress was disabled, so
confirm it from the image or the portal's revision history first.

```bash
az containerapp ingress enable -g rg-teagasc-ai-assistant-eu -n teagasc-ai-assistant --type external --target-port <port>
```

If no revision is active, activate the latest one with
`az containerapp revision activate -g rg-teagasc-ai-assistant-eu -n teagasc-ai-assistant --revision <name>`.

Once the self-hosted Teag-Ask has run well for a while, the container app can be deleted.
