# Server Setup — Broadway Touring Dashboard Pipeline

This document covers everything needed to run the data pipeline on a dedicated server so the weekly update process is not dependent on a specific laptop being on.

---

## What the server needs to do

1. Watch a folder for new Broadway League XLSX files
2. On new file: run `process_touring.py`, `scrape_shows.py`, `scrape_context.py`
3. Commit updated data files to GitHub and push to `main`
4. Azure auto-deploys from `main` (~30 seconds)

The dashboard frontend (HTML/CSS/JS) is hosted on Azure Static Web Apps — the server only runs the data pipeline.

---

## System Requirements

- **OS:** Windows Server 2019+ or Windows 11 Pro (preferred — OneDrive sync is native)  
  Linux is viable if the upload folder is mounted as a network share instead of OneDrive
- **Python:** 3.10 or later (3.12 recommended)
- **Git:** 2.x
- **Network:** outbound HTTPS to GitHub, NOAA, FRED, Wikidata, Wikipedia, DBpedia

---

## Step 1 — Install Python

Download from https://www.python.org/downloads/ — use the Windows installer.

During install, check **"Add Python to PATH"**.

Verify:
```
python --version
pip --version
```

---

## Step 2 — Install Git

Download from https://git-scm.com/download/win and install with defaults.

Configure identity (used for automated commits):
```
git config --global user.name "Bushnell Dashboard"
git config --global user.email "rnunley@bushnell.org"
```

---

## Step 3 — Install Python dependencies

All scripts use the same virtual environment. From the repo root:

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

If `requirements.txt` does not exist yet, install manually and then generate it:

```
pip install openpyxl requests SPARQLWrapper python-dotenv watchdog
pip freeze > requirements.txt
```

### What each package does

| Package | Used by | Purpose |
|---|---|---|
| `openpyxl` | process_touring.py | Reads Broadway League XLSX report files |
| `requests` | scrape_shows.py, scrape_context.py | HTTP calls to Wikidata, Wikipedia, NOAA, FRED |
| `SPARQLWrapper` | scrape_shows.py | SPARQL queries to Wikidata and DBpedia |
| `python-dotenv` | scrape_context.py | Loads API tokens from `.env` file |
| `watchdog` | watcher.py | File system event monitoring (detects new XLSX) |

All other imports (`csv`, `gzip`, `io`, `json`, `logging`, `os`, `re`, `subprocess`, `sys`, `time`, `pathlib`, `urllib`) are Python standard library — no install needed.

---

## Step 4 — Clone the repository

```
cd C:\
git clone https://github.com/Bushnell-Theatre/broadway-touring-dashboard.git
cd broadway-touring-dashboard
```

Or clone to whatever path you prefer — just update the `REPO_FOLDER` path in `scripts/watcher.py`.

---

## Step 5 — Configure GitHub authentication

The watcher commits and pushes to GitHub automatically. The server needs credentials that work non-interactively.

**Recommended: Personal Access Token (PAT)**

1. In GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Create a token scoped to the `Bushnell-Theatre/broadway-touring-dashboard` repo with **Contents: Read and Write**
3. On the server, store credentials in Git's credential manager:
   ```
   git config --global credential.helper manager
   git push   ← enter your GitHub username + PAT when prompted; it will be saved
   ```

After the first successful push, Git will reuse the stored credentials automatically.

---

## Step 6 — Create the `.env` file

In the repo root, create a file named `.env` (gitignored — never commit this):

```
FRED_API_KEY=your_fred_api_key_here
```

**Getting a FRED API key** (free):  
Register at https://fredaccount.stlouisfed.org/login/secure/ → My Account → API Keys → Request API Key

The NOAA Storm Events data (`scrape_context.py`) downloads from NOAA's public bulk FTP — no token required.

---

## Step 7 — Configure the upload folder

The watcher monitors a folder for new XLSX files. Currently set to:

```
C:\Users\rnunley\Bushnell Center for the Performing Arts\
AI Taskforce Group-Testing-Development - Broadway League Report Uploads\reports
```

**Option A — OneDrive sync (Windows Server with OneDrive installed)**  
Sign into OneDrive with the same Microsoft 365 account and sync the Teams channel folder. The path above will be accessible once synced.

**Option B — Network share / mapped drive**  
Map the SharePoint document library as a network drive and update `WATCH_FOLDER` in `scripts/watcher.py` to the new path.

To update the path, edit `scripts/watcher.py` line ~34:
```python
WATCH_FOLDER = r"<new path to the reports folder>"
REPO_FOLDER  = r"<new path to the cloned repo>"
```

---

## Step 8 — Run the watcher as a Windows Service

For the watcher to survive reboots and run without a logged-in user, install it as a Windows service using [NSSM (Non-Sucking Service Manager)](https://nssm.cc/download).

1. Download `nssm.exe` and place it somewhere on the server (e.g. `C:\tools\nssm.exe`)

2. Install the service (run Command Prompt as Administrator):
   ```
   C:\tools\nssm.exe install BroadwayDashboardWatcher
   ```

3. In the NSSM GUI that opens:
   - **Path:** `C:\broadway-touring-dashboard\.venv\Scripts\python.exe`
   - **Startup directory:** `C:\broadway-touring-dashboard\scripts`
   - **Arguments:** `watcher.py`

4. On the **Details** tab:
   - Display name: `Broadway Dashboard Watcher`
   - Description: `Watches for Broadway League XLSX uploads and triggers dashboard data pipeline`

5. On the **Log on** tab: set the account that has access to OneDrive/the network share

6. Click **Install service**, then start it:
   ```
   C:\tools\nssm.exe start BroadwayDashboardWatcher
   ```

To check status:
```
C:\tools\nssm.exe status BroadwayDashboardWatcher
```

To view logs: open `scripts\watcher.log` — it records every file detected, every script run, and every git operation.

---

## Step 9 — Verify end-to-end

1. Drop a test XLSX file into the watch folder
2. Watch `scripts\watcher.log` — you should see:
   ```
   New file detected: <filename>
   Running: process_touring.py --append ...
   Running: scrape_context.py
   Committing src/data/data.json ...
   Done. Dashboard updated for <filename>
   ```
3. Check GitHub — a new commit should appear on `main`
4. Wait ~30 seconds — the Azure deployment should pick it up

---

## Summary checklist

- [ ] Python 3.10+ installed, added to PATH
- [ ] Git installed and configured with name + email
- [ ] Repo cloned to server
- [ ] Virtual environment created and packages installed (`openpyxl`, `requests`, `SPARQLWrapper`, `python-dotenv`, `watchdog`)
- [ ] GitHub PAT created and stored in Git credential manager
- [ ] `.env` file created with `FRED_API_KEY`
- [ ] `WATCH_FOLDER` and `REPO_FOLDER` paths updated in `watcher.py` if different from laptop paths
- [ ] OneDrive synced (or network share mapped) so upload folder is accessible
- [ ] Watcher installed as a Windows service via NSSM
- [ ] End-to-end test with a real or test XLSX file confirmed
