# Server Migration & Email Ingestion Plan

**Status:** Planned — not yet implemented. This document is the design/prep reference for three related changes:

1. Moving the data pipeline off the rnunley laptop onto a dedicated always-on machine.
2. Replacing the SharePoint/OneDrive-synced upload folder with a shared mailbox (`data@bushnell.org`) as the source of new Broadway League reports — built as a **reusable pattern**, since other Bushnell automation projects will also need to receive and process email into their own pipelines.
3. Using the Anthropic API to generate a short highlight blurb for the hub page after each data update.

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
- Create a venv, `pip install -r requirements.txt` (openpyxl, requests, watchdog, python-dotenv, SPARQLWrapper — plus `msal` and `anthropic`, see Parts 2–3).

### 2. Secrets
- `.env` is gitignored and won't come with the clone — copy it by hand. It currently holds `NOAA_CDO_TOKEN` and `FRED_API_KEY` (used by `scrape_context.py`); Parts 2–3 add mailbox and Anthropic credentials to it.

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

## Part 3 — AI-generated hub highlight blurb

A third piece, layered on top of Part 2: after the pipeline ingests a new report, generate a short "what changed this week" summary and surface it on the hub (`src/index.html`).

### Design decisions already made

| Question | Decision |
|---|---|
| What does it produce? | A written summary/highlight blurb — not open-ended judgment calls inside the data pipeline itself. |
| How does it run? | A scripted Anthropic API call, not an unattended Claude Code agent. One prompt in, one text output out, written to a defined file. It cannot read or touch anything else in the repo, and it never runs `git`. |
| Auth model | **Workload Identity Federation (WIF)**, not a static API key. The box is an Azure VM, and Anthropic's WIF (GA June 17, 2026) natively trusts Microsoft Entra ID as an OIDC issuer — the VM's managed identity authenticates directly, with no `ANTHROPIC_API_KEY` stored anywhere. |
| Scope | The Entra audience app + issuer are **shared org infrastructure**, same posture as `data@bushnell.org` — set up once, reused by every future Bushnell project that wants to call Claude. Each project gets its own Service Account and Federation Rule underneath that shared plumbing. |

This keeps the blast radius small and consistent with this repo's [Golden Rule](../CLAUDE.md) and branch policy — nothing here gets any ability to push to `main`; it only ever produces content that flows through the same commit/push step the rest of the pipeline already uses.

### Implementation sketch

1. **New pipeline step**, added after Stage 1 (`process_touring.py --append`) in `run_pipeline.py` / `watcher.py`'s `process_new_file()`:
   - Diff the newly appended records (or just pass the latest week's rows) into a prompt.
   - Call the Anthropic API (`anthropic` Python SDK) with that prompt, asking for a short highlight blurb.
   - Write the returned text to a new data file, e.g. `src/data/hub_highlight.json` (`{ "week_of": "...", "summary": "...", "generated_at": "..." }`) — same pattern as `context.json`, generated data checked into the repo alongside the rest of `src/data/`.
2. **Hub display:** `index.html` fetches `hub_highlight.json` at boot (same fetch-JSON-at-runtime pattern the rest of the site uses — see [DEVELOPER.md](DEVELOPER.md)) and renders it in a new element.
3. **Failure mode:** if the token exchange or API call fails, log a warning and skip the step — same graceful-degradation pattern `scrape_context.py` already uses for missing `FRED_API_KEY`/`NOAA_CDO_TOKEN`. A missing highlight blurb should never block the rest of the pipeline or the deploy.

### Credential setup — Workload Identity Federation (no static key)

Per your call: set this up as **shared infrastructure**, the same way `data@bushnell.org` serves every project rather than each one standing up its own mailbox. Concretely, that means the Entra audience app and the Entra issuer registered in Anthropic are org-wide, one-time resources — every future Bushnell workload that wants to federate to Claude reuses them. Only the Service Account and Federation Rule are per-project.

#### One-time shared setup (do once, for the whole org)

1. **Register the shared Entra audience app** — this represents "the Claude API" to the tenant, not this project specifically:
   ```bash
   APP_ID=$(az ad app create --display-name bushnell-claude-api-federation --query appId -o tsv)
   az ad app update --id "$APP_ID" --identifier-uris "api://$APP_ID" --set api.requestedAccessTokenVersion=2
   az ad sp create --id "$APP_ID"
   ```
   Entra only issues tokens for an audience that exists in the tenant as an app registration — without this, every token request fails, for every project. Record `$APP_ID` somewhere durable (alongside the `data@bushnell.org` setup notes) — every project's runtime code needs it as the `resource`/`audience` value.
2. **Register the tenant's Entra issuer in the Claude Console** (Settings → Workload identity → Connect workload → Microsoft Entra tile). This registers `https://login.microsoftonline.com/<TENANT_ID>/v2.0` once for the whole org — a second project does not create a second issuer.
3. **Fix the token-lifetime gotcha immediately, before the first project goes live:** the wizard sets the issuer's `max_jwt_lifetime_seconds` to `7500` (~2 hours), but Azure managed-identity tokens carry up to 24 hours between issue and expiry. Edit the issuer under **Settings → Workload identity → Issuers** and raise `max_jwt_lifetime_seconds` to `86400` — otherwise every exchange from every project fails with `invalid_grant`.

#### Per-project setup (repeat for Broadway Touring Dashboard, and for each future project)

1. **Attach a managed identity to that project's Azure resource** (the VM, App Service, etc.). For this project: Azure portal → the VM → **Identity** → turn on **System assigned** (or attach a user-assigned identity). Note its **Object (principal) ID**.
2. **Create a Service Account and Federation Rule in the Claude Console**, scoped to this project — e.g. name them `svc-broadwaytouring` / `rule-broadwaytouring` so the convention reads the same way `Inbox/BroadwayTouring` does in Part 2. The rule matches this managed identity's object ID (`oid` claim) and the tenant ID (`tid` claim) against the shared audience app's client ID — it grants access to *this* identity only, not every managed identity in the tenant.
3. **Runtime:** the pipeline script fetches a token from Azure's local IMDS endpoint (`http://169.254.169.254/metadata/identity/oauth2/token`, header `Metadata: true`, `resource=api://<APP_ID>`), and passes it to the `anthropic` Python SDK's `WorkloadIdentityCredentials`, which exchanges it for a short-lived `sk-ant-oat01-...` token and refreshes it automatically:
   ```python
   import os, requests
   from anthropic import Anthropic, WorkloadIdentityCredentials

   AUDIENCE = "api://<APP_ID>"  # the shared audience app's client ID

   def fetch_entra_token() -> str:
       r = requests.get(
           "http://169.254.169.254/metadata/identity/oauth2/token",
           headers={"Metadata": "true"},
           params={"api-version": "2018-02-01", "resource": AUDIENCE},
           timeout=5,
       )
       r.raise_for_status()
       return r.json()["access_token"]

   client = Anthropic(
       credentials=WorkloadIdentityCredentials(
           identity_token_provider=fetch_entra_token,
           federation_rule_id=os.environ["ANTHROPIC_FEDERATION_RULE_ID"],
           organization_id=os.environ["ANTHROPIC_ORGANIZATION_ID"],
           service_account_id=os.environ["ANTHROPIC_SERVICE_ACCOUNT_ID"],
           workspace_id=os.environ.get("ANTHROPIC_WORKSPACE_ID"),
       ),
   )
   ```
   `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, and `ANTHROPIC_SERVICE_ACCOUNT_ID` (IDs, not secrets — safe to keep in `.env` or even plain config) are per-project, from step 2 above.
4. Add `anthropic` to this project's `requirements.txt` (a version that includes WIF support — GA June 2026).

**No `ANTHROPIC_API_KEY` exists anywhere in this flow, for any project.** If one is ever added to an environment for testing, remove it before going live — the SDK's credential precedence checks `ANTHROPIC_API_KEY` before federation, so a leftover key silently shadows WIF.

**Isolation note:** because each project gets its own Federation Rule tied to its own managed identity, one project's compromised VM can't mint tokens for another project's Service Account — the shared audience app and issuer are just the trust plumbing, not a shared credential. This mirrors Part 2's per-project mailbox subfolders: shared front door, separated access underneath.

### A parallel opportunity for Part 2

Since the box already has an Azure managed identity for this, the same identity can likely simplify the mailbox access in Part 2: managed identities are themselves Entra service principals, so IT may be able to grant the VM's managed identity the Graph `Mail.Read` application role directly (scoped via the Application Access Policy to `data@bushnell.org`) — no separate app-registration client secret to create or rotate for that piece either. Worth raising with IT alongside the WIF request rather than treating them as unrelated asks.

### Guardrail

Only aggregate box-office/touring data (gross, capacity, show names, dates) goes into the prompt — never any customer, donor, or patron-level personal information. This pipeline has no such data in scope today; if that ever changes, the prompt-construction step must explicitly exclude it.

---

## Rollout sequencing

1. Fix `watcher.py`'s hardcoded paths to use `dashboard_config` (small, low-risk, do independently of everything else).
2. Move all scripts to the dedicated box, still watching the existing SharePoint folder — validates the environment/credentials/service setup without touching ingestion logic.
3. Get IT to register the Entra app against the existing `data@bushnell.org` mailbox and apply the Application Access Policy.
4. Build and test the mail-polling replacement for `watcher.py` against the new mailbox.
5. Run the SharePoint watcher and the mailbox poller **in parallel for one report cycle** before retiring the SharePoint path, so a mail-flow hiccup doesn't create a silent gap.
6. Set up WIF (register the audience app, attach the VM's managed identity, configure the Claude Console) and add the hub-highlight step once Parts 1–2 are stable — it's additive and independent of the ingestion mechanism.

## Open questions for IT

- Confirm whether the mailbox Entra app (Part 2) needs its own client secret, or whether the VM's managed identity can hold the `Mail.Read` app role directly (see "A parallel opportunity for Part 2" above) — the latter needs no secret at all.
- Who owns raising `max_jwt_lifetime_seconds` on the Claude WIF issuer to `86400` after the Connect-workload wizard runs (Part 3) — the wizard's default rejects managed-identity tokens otherwise.
- Can Broadway League's report email be redirected to `data@bushnell.org` directly, or does it need an inbox forwarding rule from an existing address?
