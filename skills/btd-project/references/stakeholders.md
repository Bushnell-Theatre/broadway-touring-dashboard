# BTD Stakeholders Reference

## Tom — Director of Programming

**Dashboard:** `programming.html`
**Role:** Evaluating potential Broadway bookings, pressure-testing programming decisions
**Needs:**
- Fit scoring for candidate shows
- Peer venue benchmarking
- Historical show performance context
- Market trend analysis

**Key design principle:** `programming.html` is a **pressure-test tool** for Tom's existing professional judgment (conference relationships, agent knowledge) — NOT a recommendation engine. Never frame outputs as definitive recommendations.

---

## Stephanie — COO / Project Sponsor

**Dashboard:** `exec_summary.html`
**Role:** Retrospective accountability, season-level oversight
**Needs:**
- Executive-level summary of Bushnell vs peer/national benchmarks
- Revenue signal vs peer average and national average as dual proxy baselines
- Confidence indicators

**Key design principle:** `exec_summary.html` functions as a **retrospective accountability tool** — not a forward-looking planning tool.

---

## Alex — VP Marketing

**Dashboard:** `dashboard.html` (primary)
**Role:** Season-level data intelligence, market context
**Needs:**
- Full data build with KPI strip
- Multi-tab analysis
- Peer benchmarking
- Show history and fit scoring

---

## Randale — IT (Project Owner)

**Role:** Technical owner and implementer of the entire BTD suite
**Manages:** Python pipeline, GitHub Actions CI/CD, Azure Static Web Apps, all front-end HTML files
**Contact:** IT department, Bushnell Center for the Performing Arts
