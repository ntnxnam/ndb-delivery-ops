# Decommission plan

Run this **only after** the new `apps/delivery-ops/` boots cleanly,
`mcp-server/` is reachable from your client, and you've spot-checked the
TPM Streamlit app. Until then, every original folder under `~/` stays put
so you can fall back without re-cloning anything.

## Step 1 — Smoke the new structure

```bash
cd ~/NDB-Ops-Tools/ndb-delivery-ops

# Web app (delivery-ops)
cd apps/delivery-ops
./restart
# open http://localhost:6100 and click through release-versions, sprint report, KPI

# MCP server
cd ../..
npm run mcp:build
JIRA_PAT=<your PAT> node mcp-server/dist/index.js   # Ctrl+C after "connected over stdio"

# TPM Streamlit
cd apps/tpm-confluence-tools
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

If all three boot, you're cleared to run steps 2-4.

## Step 2 — Set the new git remote and push

```bash
cd ~/NDB-Ops-Tools/ndb-delivery-ops
git remote add origin <your-new-remote-URL>
git push -u origin main
```

If the remote is Gerrit (per the `DPRO-Gerrit-Push-For-Review` rule), use
`refs/for/main` instead:

```bash
git push origin HEAD:refs/for/main
```

## Step 3 — Unlink the old `ndb-status-sender` remote

This makes the old repo orphan-local. Per your explicit instruction
("unlink github remote") — kept manual so it's never accidental.

```bash
cd ~/ndb-status-sender
git remote -v                    # confirm the remote name (usually "origin")
git remote remove origin
git remote -v                    # should now print nothing
```

## Step 4 — Archive Tier D + imported originals

Each project is tarballed (source + git history, **excluding** node_modules,
venv, dist, build, __pycache__, *.log) so it's recoverable in seconds if
needed but doesn't keep eating ~5 GB of disk.

Run the helper script:

```bash
cd ~/NDB-Ops-Tools/ndb-delivery-ops
./scripts/archive-decommissioned-projects.sh
```

The script:
- Creates one `.tar.gz` per project in `~/NDB-Ops-Tools/_archive/`.
- Excludes the big binary dirs.
- Prints the resulting file size next to each project.
- **Does not delete** the originals — you do that manually after spot-checking
  the tarballs.

## Step 5 — Delete the originals

Only after you've spot-checked the tarballs and the new repo passed step 1:

```bash
# Imported into apps/delivery-ops and apps/tpm-confluence-tools:
rm -rf ~/ndb-status-sender
rm -rf ~/Confluence-Page-Creator

# Ported to MCP tools:
rm -rf ~/ndb-date-mover
rm -rf ~/ndb-story-point-calculator
rm -rf ~/ndb-say-vs-do
rm -rf ~/ndb-projects-bin-packing
rm -rf ~/Release-Timelines-Visualizer
rm -rf ~/ndb-capacity-planner
rm -rf ~/GitHub-Commits

# Tier D (no migration; archived only):
rm -rf ~/NDB-Outstanding-Work-Realistic-Timelines
rm -rf ~/NDB-SWOT
rm -rf ~/ndb-status-update-app
rm -rf ~/ndb-release-sprint-analysis-with-chatbot
rm -rf ~/NamPortfolioManagement
rm -rf ~/jira-pm-app-full
rm -rf ~/PM-App
rm -rf ~/Data-Dash
```

Recovery if anything goes wrong:

```bash
cd ~
tar -xzf ~/NDB-Ops-Tools/_archive/<project>.tar.gz
```

## Step 6 — Verify

```bash
ls ~/NDB-Ops-Tools/                          # should be ndb-delivery-ops + _archive
ls ~/NDB-Ops-Tools/_archive/ | wc -l         # ~17 tarballs (Tier D + imported)
du -sh ~/NDB-Ops-Tools/                      # should be << the pre-consolidation total
```

Done.
