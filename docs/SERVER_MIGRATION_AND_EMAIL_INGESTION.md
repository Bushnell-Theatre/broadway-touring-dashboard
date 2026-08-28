# Server Migration & Email Ingestion Plan

**Status:** Planned — not yet implemented. Confirmed against the actual code (not just docs) as of this update: `watcher.py` still hardcodes the rnunley laptop's Windows paths and still watches the local SharePoint/OneDrive-synced folder — none of Parts 1–2 below exist in code yet.

This document covers two related changes:

1. Moving the data pipeline off the rnunley laptop onto **Bush-Python**, a dedicated always-on **physical/on-prem Ubuntu server** (not a cloud VM — this ruled out an Azure-managed-identity approach considered earlier for Part 3, see below).
2. Replacing the SharePoint/OneDrive-synced upload folder with a shared mailbox (`data@bushnell.org`, already created) as the source of new Broadway League reports — built as a **reusable pattern**, since other Bushnell automation projects will also need to receive and process email into their own pipelines.

A third item that used to live here — generating an AI highlight blurb via the Anthropic API — is **not part of this plan anymore**. That work already shipped, separately and differently than what was drafted here: see [docs/AI_PIPELINE_PLAN.md](AI_PIPELINE_PLAN.md) for the real, implemented version (`scripts/generate_highlights.py` and `scripts/generate_season_review.py`, wired into `watcher.py`, using a static `ANTHROPIC_API_KEY` — already documented in [OPERATIONS.md](OPERATIONS.md)). Don't build a second version of this from Part 3 of an earlier draft of this doc.

Treat what remains here as the checklist to work through with IT, not a description of current behavior — see [OPERATIONS.md](OPERATIONS.md) for how the pipeline actually runs today.

---

## Why

Today the pipeline (`watcher.py` + `process_touring.py` + `scrape_shows.py` + `scrape_context.py`) runs only when the rnunley laptop is on, logged in, and has `start_watcher.bat` running in a terminal window. It watches a OneDrive-synced SharePoint folder for new `.xlsx` files. Two problems:

- **Single point of failure.** If the laptop is off, asleep, or the terminal window gets closed, nothing processes until someone notices and runs the pipeline manually.
- **Manual hop in the middle.** The Broadway League report actually arrives as an email attachment. Today it (or someone) has to land it in the SharePoint folder before the watcher ever sees it. That manual step is the thing most likely to get missed on a busy week.

Moving the whole pipeline to a dedicated machine (Bush-Python) solves the first problem, and having that machine read the report directly from a shared mailbox solves the second — but in practice these ship together: Bush-Python comes online once the mailbox permissions are approved, not on its own earlier timeline.

---

## Part 1 — Move the pipeline to Bush-Python

Bush-Python runs Ubuntu, not Windows — a few of these steps look different from a same-OS move.

**This move happens together with Part 2, not before it.** Bush-Python comes online when the Entra/Azure app permissions for `data@bushnell.org` mail access are approved — the OS migration and the mailbox-ingestion switch are one coupled event, not two independent steps done in sequence. Don't stand up Bush-Python early just to keep watching the SharePoint folder from a new machine.

### 1. Repo + Python environment
- Clone the repo, checkout `main`.
- Create a venv, `pip install -r requirements.txt` (openpyxl, requests, watchdog, python-dotenv, SPARQLWrapper, anthropic — plus `msal`, see Part 2).

### 2. Secrets
- `.env` is gitignored and won't come with the clone — copy it by hand. It currently holds `NOAA_CDO_TOKEN`, `FRED_API_KEY`, and `ANTHROPIC_API_KEY` (see [OPERATIONS.md](OPERATIONS.md)); Part 2 adds mailbox credentials to it.

### 3. Git push credentials
- The `origin` remote is HTTPS, so pushes rely on a cached credential helper/token on whatever machine runs them. Bush-Python needs its own credential setup (Git Credential Manager for Linux, or a plain GitHub PAT stored via a credential helper) under the account that will run the pipeline, or background commits will fail silently.
- Set `git config user.name` / `user.email` on Bush-Python to match the identity that should show up in commit history.

### 4. Path portability
- `scripts/dashboard_config.py` already supports `BWAY_REPO_FOLDER` and `BWAY_WATCH_FOLDER` env var overrides.
- `scripts/watcher.py` does **not** use `dashboard_config` yet — it hardcodes `WATCH_FOLDER` and `REPO_FOLDER` to the rnunley laptop's Windows paths. Fix this before the move — both because the paths are Windows-style and won't resolve on Linux, and so nothing needs hand-editing on Bush-Python. (This becomes moot for `WATCH_FOLDER` once Part 2 replaces folder-watching with mailbox-polling, but fix it regardless — `REPO_FOLDER` is still used to locate the repo and run git commands.)

### 5. Run as a persistent, self-restarting process
- Today the pipeline is "keep this terminal window open." On Bush-Python it needs to survive reboots and restart on crash — a `systemd` service unit (`systemctl enable` so it starts on boot, `Restart=on-failure` so it comes back after a crash), with output captured via `journalctl` or redirected to `watcher.log` as it is today.

### 6. Scope of the move
- All scripts move together (`process_touring.py`, `scrape_shows.py`, `scrape_context.py`, `validate_data.py`, `generate_highlights.py`, `generate_season_review.py`, `watcher.py`, `dashboard_config.py`) — no split between machines.

---

## Part 2 — Shared mailbox ingestion (`data@bushnell.org`)

### Design decisions already made

| Question | Decision |
|---|---|
| Whose mailbox? | New dedicated shared mailbox, `data@bushnell.org` (created) — not a personal inbox. Decoupled from any one person's account; survives role changes. |
| Auth model | Microsoft Graph API, app-only (client credentials), via an Entra ID app registration. IT support is available to get this approved. |

### One-time IT setup (shared across all projects, not just this one)

1. ~~Create the shared mailbox `data@bushnell.org` in Exchange Online.~~ **Done.**
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

## Retiring the SharePoint folder

The SharePoint upload folder and everything that depends on it can be deprecated once Part 2 is fully in place and reading reports directly from `data@bushnell.org` — not before. Two separate steps, on their own timeline once that condition is met:

1. **Historical files:** one-time bulk copy of the existing `.xlsx` reports already sitting in the SharePoint upload folder onto Bush-Python's local disk (e.g. `reports/archive/`), so nothing on Bush-Python depends on reaching back into SharePoint later. This is a straight file copy, not a pipeline change — no reprocessing implied, just relocating the source files that back already-ingested data.
2. **Going forward:** stop landing *new* reports in SharePoint once the mailbox path is confirmed stable over at least one real report cycle — have Broadway League send only to `data@bushnell.org`. The mailbox's `Processed` subfolder (Part 2) becomes the durable archive for new reports; Exchange Online is backed up independently of Bush-Python, so this doesn't need a second copy in SharePoint on top of it.

Before turning off the SharePoint folder, confirm nothing else (a person, another process, a retention policy) depends on it for a reason unrelated to this pipeline.

---

## Rollout sequencing

1. Fix `watcher.py`'s hardcoded paths to use `dashboard_config` (small, low-risk, do independently of everything else — can happen on the laptop, before anything else here).
2. Get IT to register the Entra app against the `data@bushnell.org` mailbox and apply the Application Access Policy. **This approval is the gate** — nothing else below starts until it clears.
3. Once approved: stand up Bush-Python and build/test the mail-polling replacement for `watcher.py` together, as one move — Bush-Python's first job is reading the mailbox, not watching a SharePoint folder from a new machine.
4. Keep the existing laptop + SharePoint watcher running unchanged during this cutover, so there's a fallback if the new setup has a hiccup — run both **in parallel for one full report cycle** before retiring the old path.
5. Once Bush-Python's mailbox path is confirmed stable: bulk-copy historical report files from SharePoint to Bush-Python and stop landing new ones there (see "Retiring the SharePoint folder" above).

## Open questions for IT

- Client secret or certificate for the mailbox Entra app registration (Part 2)?
- Who owns rotating the mailbox app's client secret, and on what cadence?
- Can Broadway League's report email be redirected to `data@bushnell.org` directly, or does it need an inbox forwarding rule from an existing address?
- Does anyone else depend on the current SharePoint upload folder for a reason unrelated to this pipeline, before it gets decommissioned?
