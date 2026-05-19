import streamlit as st
import pandas as pd
from datetime import datetime
from collections import defaultdict
from src.utils import load_report_state, save_report_state
from src.page_manager import PageAction

# Import authentication components
from src.header import render_header, check_authentication

st.set_page_config(page_title="Report", page_icon="📊", layout="wide")

# Render header and check authentication
render_header()
if not check_authentication():
    st.stop()

st.title("Creation Report")

# Restore from disk if session was cleared (browser refresh)
if not st.session_state.get('creation_results'):
    _persisted = load_report_state()
    if _persisted:
        # Reconstruct PageAction objects from dicts
        st.session_state.creation_results = [
            PageAction(**r) if isinstance(r, dict) else r for r in _persisted
        ]

if not st.session_state.get('creation_results'):
    st.info("No pages have been created or fixed yet. "
            "Go to **Dashboard** to manage and create pages for your release.")
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("📋 Go to Dashboard", type="primary", use_container_width=True):
            st.switch_page("pages/1_Dashboard.py")
    with col2:
        if st.button("⚙️ Team & Release Setup", use_container_width=True):
            st.switch_page("pages/3_Team_Release.py")
    st.stop()

results = st.session_state.creation_results

st.subheader("Summary")

total = len(results)
created = sum(1 for r in results if r.action == 'created')
fixed = sum(1 for r in results if r.action == 'fixed')
errors = sum(1 for r in results if r.action == 'error')
skipped = sum(1 for r in results if r.action == 'skip')

col1, col2, col3, col4, col5 = st.columns(5)
col1.metric("Total Processed", total)
col2.metric("Created", created)
col3.metric("Fixed", fixed)
col4.metric("Errors", errors)
col5.metric("Skipped", skipped)

# Per-page-type counts (when page_type is set)
page_type_labels = {'container': 'Container', 'ccm': 'Code Complete', 'cg': 'CG Checklist', 'pg': 'PG Checklist'}
by_type = defaultdict(lambda: {'created': 0, 'fixed': 0})
for r in results:
    pt = getattr(r, 'page_type', '') or ''
    if not pt:
        continue
    if r.action == 'created':
        by_type[pt]['created'] += 1
    elif r.action == 'fixed':
        by_type[pt]['fixed'] += 1

if by_type:
    st.caption("**By page type:** " + " | ".join(
        f"{page_type_labels.get(pt, pt)}: {by_type[pt]['created']} created, {by_type[pt]['fixed']} fixed"
        for pt in ['container', 'ccm', 'cg', 'pg'] if pt in by_type
    ))

st.caption("Use the table and CSV for status tracking and handoffs. Filter by Action or Page Type to see only created/fixed or a specific gate.")

st.divider()

# --- Per-ticket summary ---
ticket_rollup = defaultdict(lambda: {'summary': '', 'container': '—', 'ccm': '—', 'cg': '—', 'pg': '—'})
for r in results:
    key = r.jira_key
    if not ticket_rollup[key]['summary'] and r.summary:
        ticket_rollup[key]['summary'] = (r.summary[:60] + '...') if len(r.summary or '') > 60 else (r.summary or '—')
    pt = getattr(r, 'page_type', '') or ''
    if pt and pt in ticket_rollup[key]:
        action = r.action.lower()
        if action == 'created':
            ticket_rollup[key][pt] = 'created'
        elif action == 'fixed':
            ticket_rollup[key][pt] = 'fixed'
        elif action == 'error':
            ticket_rollup[key][pt] = 'error'
        elif action == 'skip':
            ticket_rollup[key][pt] = 'skip'

if ticket_rollup:
    st.subheader("Per-ticket summary")
    rollup_rows = []
    for jira_key in sorted(ticket_rollup.keys()):
        t = ticket_rollup[jira_key]
        rollup_rows.append({
            'JIRA Key': jira_key,
            'Summary': t['summary'],
            'Container': t['container'],
            'Code Complete': t['ccm'],
            'CG': t['cg'],
            'PG': t['pg'],
        })
    st.dataframe(pd.DataFrame(rollup_rows), use_container_width=True, hide_index=True)
    st.divider()

# --- Gate Commitments reminder ---
st.info(
    "**Gate Commitments tip:** On CG pages, only set \"CG Met as on Planned Date?\" or "
    "\"Will we meet PG on time?\" to **Yes** after the planned date has passed. "
    "Otherwise use **TBD** so you don’t imply a future date is already met."
)

st.divider()

# --- Detailed Results ---
st.subheader("Detailed Results")

for r in results:
    if r.action == 'created':
        icon = "✅"
        color = "green"
    elif r.action == 'fixed':
        icon = "🔧"
        color = "blue"
    elif r.action == 'error':
        icon = "❌"
        color = "red"
    else:
        icon = "⏭️"
        color = "gray"

    pt_label = page_type_labels.get(getattr(r, 'page_type', '') or '', getattr(r, 'page_type', '') or '—')
    with st.container():
        cols = st.columns([0.05, 0.12, 0.28, 0.12, 0.13, 0.3])
        cols[0].markdown(icon)
        cols[1].markdown(f"**{r.jira_key}**")
        cols[2].markdown(r.summary if r.summary else '-')
        cols[3].markdown(f":{color}[{r.action.upper()}]")
        cols[4].markdown(pt_label)
        if r.page_url:
            cols[5].markdown(f"[Open in Confluence]({r.page_url})")
        else:
            cols[5].markdown(r.details[:50] if r.details else '-')

st.divider()

# --- Export ---
st.subheader("Export Report")

report_data = []
for r in results:
    report_data.append({
        'JIRA Key': r.jira_key,
        'Summary': r.summary,
        'Action': r.action.upper(),
        'Page Type': page_type_labels.get(getattr(r, 'page_type', '') or '', getattr(r, 'page_type', '') or ''),
        'Details': r.details,
        'Page URL': r.page_url,
        'Page ID': r.page_id
    })

df = pd.DataFrame(report_data)

st.dataframe(df, use_container_width=True)

col_csv, col_clear = st.columns(2)

with col_csv:
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    team = st.session_state.get('selected_team', 'unknown')
    version = st.session_state.get('version', 'unknown')
    filename = f"confluence_report_{team}_{version}_{timestamp}.csv"

    csv = df.to_csv(index=False)
    st.download_button(
        "Download CSV Report",
        csv,
        filename,
        "text/csv",
        use_container_width=True
    )

with col_clear:
    if not st.session_state.get('_confirm_clear_report'):
        if st.button("Clear Report", use_container_width=True):
            st.session_state._confirm_clear_report = True
            st.rerun()
    else:
        st.warning("Clear all report data?")
        _cr_yes, _cr_no = st.columns(2)
        with _cr_yes:
            if st.button("Yes, clear", type="primary", use_container_width=True):
                st.session_state.creation_results = []
                st.session_state._confirm_clear_report = False
                save_report_state([])
                st.rerun()
        with _cr_no:
            if st.button("Cancel", use_container_width=True):
                st.session_state._confirm_clear_report = False
                st.rerun()
