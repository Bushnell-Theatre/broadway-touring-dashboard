# Server Migration & Email Ingestion Plan

**Status:** Planned — not yet implemented. This document is the design/prep reference for two related changes:

1. Moving the data pipeline off the rnunley laptop onto a dedicated always-on machine.
2. Replacing the SharePoint/OneDrive-synced upload folder with a shared mailbox (`data@bushnell.org`) as the source of new Broadway League reports — built as a **reusable pattern**, since other Bushnell automation projects will also need to receive and process email into their own pipelines.

Nothing here is live yet. Treat this as the checklist to work through with IT, not a description of current behavior — see [OPERATIONS.md](OPERATIONS.md) for how the pipeline actually runs today.

---

## Why

Today the pipeline (`watcher.py` + `process_touring.py` + `scrape_shows.py` + `scrape_context.py`) runs only when the rnunley laptop is on, logged in, and has `start_watcher.bat` running in a terminal window. It watches a OneDrive-synced SharePoint folder for new `.xlsx` files. Two problems:

- **Single point of failure.** If the laptop is off, asleep, or the terminal window gets closed, nothing processes until someone notices and runs the pipeline manually.
- **Manual hop in the middle.** The Broadway League report actually arrives as an email attachment. Today it (or someone) has to land it in the SharePoint folder before the watcher ever sees it. That manual step is the thing most likely to get missed on a busy week.

Moving the whole pipeline to a dedicated machine solves the first problem. Having that machine read the report directly from a shared mailbox solves the second, and removes the SharePoint dependency entirely.

---

## Part 1 — Move the pipeline to a dedicated always-on machine

### 1. Repo + Python environment
- Clone the repo, checkout `main`.
- Create a venv, `pip install -r requirements.txt` (openpyxl, requests, watchdog, python-dotenv, SPARQLWrapper — plus `msal`, see Part 2).

### 2. Secrets
- `.env` is gitignored and won't come with the clone — copy it by hand. It currently holds `NOAA_CDO_TOKEN` and `FRED_API_KEY` (used by `scrape_context.py`); Part 2 adds mailbox credentials to it.

### 3. Git push credentials
- The `origin` remote is HTTPS, so pushes rely on a cached credential helper/token on whatever machine runs them. The new box needs its own credential setup (Git Credential Manager login or a GitHub PAT) under the account that will run the pipeline, or background commits will fail silently.
- Set `git config user.name` / `user.email` on the box to match the identity that should show up in commit history.

### 4. Path portability
- `scripts/dashboard_config.py` already supports `BWAY_REPO_FOLDER` and `BWAY_WATCH_FOLDER` env var overrides.
- `scripts/watcher.py` does **not** use `dashboard_config` yet — it hardcodes `WATCH_FOLDER` and `REPO_FOLDER` to the rnunley laptop's paths (lines 35–36). Fix this before the move so nothing needs hand-editing on the new machine. (This becomes moot once Part 2 replaces folder-watching with mailbox-polling, but fix it regardless — `REPO_FOLDER` is still used to locate the repo and run git commands.)

### 5. Run as a persistent, self-restarting process
- Today the pipeline is "keep this terminal window open." On a dedicated box it needs to survive reboots and restart on crash — a Windows service (e.g. via NSSM) or a Scheduled Task set to run at startup, with output redirected to `watcher.log` as it is today.

### 6. Scope of the move
- All scripts move together (`process_touring.py`, `scrape_shows.py`, `scrape_context.py`, `validate_data.py`, `watcher.py`, `dashboard_config.py`) — no split between machines.

---

## Part 2 — Shared mailbox ingestion (`data@bushnell.org`)

### Design decisions already made

| Question | Decision |
|---|---|
| Whose mailbox? | New dedicated shared mailbox, `data@bushnell.org` — not a personal inbox. Decoupled from any one person's account; survives role changes. |
| Auth model | Microsoft Graph API, app-only (client credentials), via an Entra ID app registration. IT support is available to get this approved. |

### One-time IT setup (shared across all projects, not just this one)

1. **Create the shared mailbox** `data@bushnell.org` in Exchange Online.
2. **Register an Entra ID (Azure AD) app** — e.g. `bushnell-data-ingestion` — with:
   - Microsoft Graph **application permission** `Mail.Read` (app-only; no signed-in user required).
   - Admin consent granted.
   - A client secret (or certificate, if IT prefers to avoid secret rotation).
3. **Restrict the permission with an Application Access Policy.** This is the step most likely to get missed: `Mail.Read` as an *application* permission grants the app read access to **every mailbox in the tenant** unless explicitly scoped. IT needs to run `New-ApplicationAccessPolicy` in Exchange Online PowerShell to limit this app to `data@bushnell.org` only.
4. **Hand off:** Tenant ID, Client ID, Client Secret, mailbox address — stored in each project's `.env`, never committed.

Do this once. Every future project that needs to receive and process email reuses the same mailbox, app registration, and access policy — they don't each need their own Entra app.

### Multi-project mailbox convention

Since `data@bushnell.org` will serve more than just this project, incoming mail needs to be sorted so one project's poller doesn't see (or have to filter through) another's mail:

- Use **Outlook inbox rules** to route incoming mail into per-project subfolders based on sender address or subject line — e.g. `Inbox/BroadwayTouring`, `Inbox/<NextProject>`.
- Each project's polling script reads only its own subfolder via Graph (`/users/data@bushnell.org/mailFolders/{folderId}/messages`), not the root inbox.
- Each project defines its own sender/subject filter as a second layer of defense in case a rule misfires.
- Recommend agreeing on a lightweight naming convention up front (e.g. project folder name = repo name) so this doesn't get ad hoc as more projects onboard.

### Broadway Touring Dashboard–specific setup

1. Have Broadway League send the weekly report to `data@bushnell.org` directly, or add a forwarding rule from wherever it lands today.
2. Add an inbox rule filing those messages into `Inbox/BroadwayTouring`.
3. Replace the `watchdog` folder-watcher in `scripts/watcher.py` with a mail-polling loop:
   - Auth via `msal` (client credentials flow) — new dependency in `requirements.txt`.
   - Poll `Inbox/BroadwayTouring` on an interval (10–15 min is plenty for a weekly report — no need for Graph webhook/change-notification complexity, which would require a public HTTPS endpoint).
   - Filter for messages with `.xlsx` attachments matching the expected sender/subject pattern.
   - Download the attachment to a local temp path, hand it to the existing `process_new_file()` pipeline unchanged.
   - Mark the message read, or move it to a `Processed` subfolder (needs `Mail.ReadWrite` instead of `Mail.Read` if so).
4. **Idempotency:** persist processed message IDs to a local state file (not just an in-memory set like today's `XLSXHandler._seen`), since a polling process restarts and would otherwise lose track of what it already handled.

### Security notes

- Client secret lives only in `.env` on the box, gitignored, same as `FRED_API_KEY` today.
- The Application Access Policy (above) is the actual security boundary — without it, a leaked client secret would expose every mailbox in the tenant, not just this one.
- Prefer `Mail.Read` over `Mail.ReadWrite` unless the "move to Processed folder" approach is chosen — narrower permission is safer even with the access policy in place.

---

## Rollout sequencing

1. Fix `watcher.py`'s hardcoded paths to use `dashboard_config` (small, low-risk, do independently of everything else).
2. Move all scripts to the dedicated box, still watching the existing SharePoint folder — validates the environment/credentials/service setup without touching ingestion logic.
3. Get IT to create `data@bushnell.org`, register the Entra app, and apply the Application Access Policy.
4. Build and test the mail-polling replacement for `watcher.py` against the new mailbox.
5. Run the SharePoint watcher and the mailbox poller **in parallel for one report cycle** before retiring the SharePoint path, so a mail-flow hiccup doesn't create a silent gap.

## Open questions for IT

- Client secret or certificate for the app registration?
- Who owns rotating the client secret when it expires, and on what cadence?
- Can Broadway League's report email be redirected to `data@bushnell.org` directly, or does it need an inbox forwarding rule from an existing address?
