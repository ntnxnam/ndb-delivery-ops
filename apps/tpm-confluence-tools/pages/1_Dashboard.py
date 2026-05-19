import streamlit as st
from src.utils import (
    load_team_config,
    load_template_overrides,
    load_workflow_state,
    get_version_from_fix_version,
    generate_tag,
    _deep_merge,
    sanitize_title,
    format_page_title,
)
from src.page_manager import (
    ensure_phase_folders,
    scan_tickets,
    create_container_page,
    create_gate_page,
    discover_release_templates,
    TicketStatus,
    GATE_PAGE_SUFFIXES,
    extract_jira_key_from_title,
    _is_likely_container,
)
from src.template_data import get_default_config, GATE_TYPES


# Helper functions for dashboard actions
def _create_all_containers_dashboard(confluence, space_key, exec_id, ticket_statuses, issues, team, version, title_pattern):
    """Create all missing containers from the dashboard."""
    from src.utils import generate_tag
    from src.page_manager import create_container_page
    
    tag = generate_tag(team, version)
    containers_to_create = [ts for ts in ticket_statuses if hasattr(ts, 'container_action') and ts.container_action == 'create']
    
    with st.status(f"Creating {len(containers_to_create)} containers...", expanded=True) as status:
        created = 0
        progress = st.progress(0.0)
        
        for i, ts in enumerate(containers_to_create):
            issue = next((iss for iss in issues if iss['key'] == ts.jira_key), None)
            if issue:
                summary = issue.get('fields', {}).get('summary', '')
                st.write(f"Creating: {ts.jira_key}")
                
                try:
                    result = create_container_page(
                        confluence=confluence,
                        space_key=space_key,
                        execution_folder_id=exec_id,
                        jira_key=ts.jira_key,
                        summary=summary,
                        team=team,
                        version=version,
                        server_id='',  # Add server_id if needed
                        title_pattern=title_pattern,
                        tag=tag
                    )
                    if result.action == 'created':
                        ts.container_action = 'exists'
                        ts.container_id = result.page_id
                        ts.container_url = result.page_url
                        created += 1
                except Exception as e:
                    st.error(f"Failed to create {ts.jira_key}: {e}")
                    
            progress.progress((i + 1) / len(containers_to_create))
        
        status.update(label=f"✅ Created {created} containers", state="complete", expanded=False)
        st.rerun()


def _create_missing_pages_dashboard(confluence, space_key, ticket_statuses, issues, team, version):
    """Create all missing gate pages from the dashboard."""
    from src.utils import generate_tag
    from src.page_manager import create_gate_page
    from src.template_data import get_default_config
    
    tag = generate_tag(team, version)
    
    # Count total missing pages
    missing_pages = []
    for ts in ticket_statuses:
        if hasattr(ts, 'gates') and hasattr(ts, 'container_id') and ts.container_id:
            for gate_type in ['ccm', 'cg', 'pg']:
                if not ts.gates.get(gate_type, {}).get('exists'):
                    missing_pages.append((ts, gate_type))
    
    with st.status(f"Creating {len(missing_pages)} gate pages...", expanded=True) as status:
        created = 0
        progress = st.progress(0.0)
        
        for i, (ts, gate_type) in enumerate(missing_pages):
            issue = next((iss for iss in issues if iss['key'] == ts.jira_key), None)
            if issue:
                st.write(f"Creating: {ts.jira_key} {gate_type.upper()}")
                
                # Get template config
                template_config = st.session_state.get(f'template_config_{gate_type}')
                if not template_config:
                    template_config = get_default_config(gate_type)
                
                try:
                    result = create_gate_page(
                        confluence=confluence,
                        space_key=space_key,
                        container_id=ts.container_id,
                        issue=issue,
                        team=team,
                        version=version,
                        server_id='',  # Add server_id if needed
                        title_pattern=st.session_state.get('dash_title_pattern', ''),
                        gate_type=gate_type,
                        template_config=template_config,
                        tag=tag
                    )
                    if result.action == 'created':
                        ts.gates[gate_type] = {
                            'exists': True,
                            'page_id': result.page_id,
                            'url': result.page_url,
                            'needs_sync': False
                        }
                        created += 1
                except Exception as e:
                    st.error(f"Failed to create {ts.jira_key} {gate_type}: {e}")
                    
            progress.progress((i + 1) / len(missing_pages))
        
        status.update(label=f"✅ Created {created} gate pages", state="complete", expanded=False)
        st.rerun()


def _sync_pages_dashboard(confluence, ticket_statuses, team, version):
    """Sync all pages that need updating from the dashboard."""
    from src.utils import generate_tag
    from src.page_manager import sync_gate_page_content
    from src.template_data import get_default_config
    
    tag = generate_tag(team, version)
    
    # Find pages that need sync
    pages_to_sync = []
    for ts in ticket_statuses:
        if hasattr(ts, 'gates'):
            for gate_type in ['ccm', 'cg', 'pg']:
                gate_info = ts.gates.get(gate_type, {})
                if gate_info.get('needs_sync') and gate_info.get('page_id'):
                    pages_to_sync.append((ts, gate_type, gate_info['page_id']))
    
    with st.status(f"Syncing {len(pages_to_sync)} pages...", expanded=True) as status:
        synced = 0
        progress = st.progress(0.0)
        
        for i, (ts, gate_type, page_id) in enumerate(pages_to_sync):
            st.write(f"Syncing: {ts.jira_key} {gate_type.upper()}")
            
            # Get template config
            template_config = st.session_state.get(f'template_config_{gate_type}')
            if not template_config:
                template_config = get_default_config(gate_type)
            
            try:
                sync_gate_page_content(
                    confluence=confluence,
                    page_id=page_id,
                    gate_type=gate_type,
                    template_config=template_config,
                    team=team,
                    version=version,
                    tag=tag
                )
                ts.gates[gate_type]['needs_sync'] = False
                synced += 1
            except Exception as e:
                st.error(f"Failed to sync {ts.jira_key} {gate_type}: {e}")
                
            progress.progress((i + 1) / len(pages_to_sync))
        
        status.update(label=f"✅ Synced {synced} pages", state="complete", expanded=False)
        st.rerun()


def _create_ticket_gates_dashboard(confluence, ts, issue, missing_gates, team, version, space_key):
    """Create missing gates for a specific ticket."""
    # Implementation similar to _create_missing_pages_dashboard but for single ticket
    pass


def _create_ticket_all_dashboard(confluence, space_key, exec_id, issue, team, version, title_pattern):
    """Create container and all gates for a ticket."""
    # Implementation for creating everything for a single ticket
    pass


st.set_page_config(page_title="Dashboard", page_icon="📋", layout="wide")

# Import authentication components
from src.header import render_header, check_authentication

# Render header and check authentication
render_header()
if not check_authentication():
    st.stop()

st.markdown("### Release Dashboard")
st.caption("Gate pages and TCMS links for release")


def _extract_team_info(issue_fields: dict) -> dict:
    info = {}
    assignee = issue_fields.get('assignee')
    if assignee:
        info['Dev Lead'] = assignee.get('displayName', '')
    reporter = issue_fields.get('reporter')
    if reporter:
        info['Product Manager'] = reporter.get('displayName', '')
    components = issue_fields.get('components') or []
    if components:
        info['Dev Team'] = ', '.join(c.get('name', '') for c in components if c.get('name'))
    return info


jira = st.session_state.jira_client
confluence = st.session_state.confluence_client
team_config = load_team_config()
teams = team_config['teams']
team_names = list(teams.keys())

overrides = load_template_overrides()
for gt in GATE_TYPES:
    ck = f'template_config_{gt}'
    if ck not in st.session_state and overrides:
        st.session_state[ck] = _deep_merge(get_default_config(gt), overrides.get(gt, {}))

NOT_AVAILABLE = "Not Available"

# --- Inherit context from Team & Release session or saved workflow ---
_wf = load_workflow_state()
_default_team = st.session_state.get('team_select') or _wf.get('team_select')
_default_fv = st.session_state.get('selected_fix_version') or _wf.get('fix_version_select')
_default_space = st.session_state.get('confluence_space') or _wf.get('confluence_space_input', '')

# --- Team & version selection ---

col_team, col_project, col_ver = st.columns(3)
with col_team:
    _team_default_idx = team_names.index(_default_team) if _default_team in team_names else 0
    selected_team = st.selectbox(
        "Team",
        team_names,
        index=_team_default_idx,
        format_func=lambda t: teams[t]['display_name'],
        key="dash_team_select",
    )
team_cfg = teams[selected_team]

with col_project:
    primary_project = st.text_input(
        "Primary JIRA Project Key",
        value=team_cfg['primary_project'],
        key="dash_primary_project",
    )

if st.session_state.get('_dash_last_team') != selected_team:
    for k in list(st.session_state.keys()):
        if k.startswith('dash_') and k not in ('dash_team_select', 'dash_primary_project'):
            st.session_state.pop(k, None)
    st.session_state._dash_last_team = selected_team

# Auto-fetch versions (shared cache with Team & Release)
_dash_ver_cache_key = f'available_versions_{selected_team}_{primary_project}'
if _dash_ver_cache_key not in st.session_state:
    with st.spinner(f"Fetching fix versions for {primary_project}..."):
        try:
            versions = jira.get_fix_versions(primary_project)
            prefix = team_cfg['fix_version_prefix']
            filtered = [v for v in versions if v['name'].upper().startswith(prefix.upper())]
            st.session_state[_dash_ver_cache_key] = filtered if filtered else versions
        except Exception as e:
            st.error(f"Failed to fetch versions: {e}")
            st.session_state[_dash_ver_cache_key] = []

_dash_versions = st.session_state.get(_dash_ver_cache_key, [])
_dash_ver_names = [v['name'] for v in _dash_versions]
_dash_ver_idx = _dash_ver_names.index(_default_fv) if _default_fv in _dash_ver_names else 0

with col_ver:
    if _dash_ver_names:
        selected_fix_version = st.selectbox("Fix Version", _dash_ver_names, index=_dash_ver_idx, key="dash_fix_version")
        if st.button("↻", key="dash_refresh_versions", help="Refresh", use_container_width=True):
            st.session_state.pop(_dash_ver_cache_key, None)
            st.rerun()
    else:
        st.caption("No versions available.")
        selected_fix_version = None

if not selected_fix_version:
    st.stop()

version = get_version_from_fix_version(selected_fix_version, team_cfg['fix_version_prefix'])

space_key = st.text_input(
    "Space Key",
    value=_default_space or team_cfg.get('confluence_space', ''),
    key="dash_space_key",
)

tcms_field = team_cfg.get('tcms_field', '')

# Load button in header area
col_space, col_load = st.columns([2, 1])
with col_space:
    st.write("")  # Spacer
with col_load:
    if st.button("Load Dashboard", type="primary", key="dash_load", use_container_width=True):
        with st.status("Loading dashboard...", expanded=True) as load_status:
            st.write("Fetching JIRA tickets...")
            jql = team_cfg['jql_template'].format(
                project=primary_project,
                fix_version=selected_fix_version,
            )
            fields = 'key,summary,status,assignee,reporter,components'
            if tcms_field:
                fields += f',{tcms_field}'
            try:
                issues = jira.search_issues(jql, fields=fields)
            except Exception as e:
                load_status.update(label="Failed", state="error")
                st.error(f"JQL failed: {e}")
                st.stop()

            st.write(f"Found **{len(issues)}** tickets. Scanning Confluence...")

            title_pattern = team_cfg.get(
                'page_title_pattern',
                '{team} Project Update - {version} - {jira_key} - {summary}',
            )
            ticket_statuses_list = []
            exec_id = ''

            parent_title = team_cfg['parent_page_title_pattern'].format(
                team=selected_team, version=version, fix_version=selected_fix_version
            )
            try:
                parent_page = confluence.get_page_by_title(space_key, parent_title)
                if parent_page:
                    folder_info = ensure_phase_folders(
                        confluence=confluence,
                        space_key=space_key,
                        parent_id=parent_page['id'],
                        team=selected_team,
                        version=version,
                        phase_patterns=team_cfg.get('phase_folders', {}),
                        fix_version=selected_fix_version,
                    )
                    exec_id = folder_info.get('execution', {}).get('id', '')
                    if exec_id:
                        st.write(f"Scanning gate pages for {len(issues)} tickets...")
                        try:
                            # Use a faster, simplified scanning for dashboard
                            st.write("📄 Quick scanning (simplified)...")
                            progress = st.progress(0)
                            
                            # Create basic ticket statuses without deep scanning
                            ticket_statuses_list = []
                            
                            # Get direct children of execution folder
                            children = confluence.get_child_pages(exec_id, expand='version,metadata.labels')
                            progress.progress(0.3)
                            
                            # Build maps of existing containers and gates
                            existing_containers = {}
                            existing_gates = {}  # jira_key -> {gate_type -> page}
                            
                            st.write(f"🔍 Scanning {len(children)} pages under execution folder...")
                            
                            for child in children:
                                child_title = child['title']
                                # Find JIRA key in title using more robust matching
                                jira_key = None
                                for issue in issues:
                                    jk = issue['key']
                                    # Try multiple matching strategies
                                    if (jk in child_title or 
                                        jk.replace('-', '') in child_title.replace('-', '') or
                                        jk.lower() in child_title.lower()):
                                        jira_key = jk
                                        break
                                
                                if not jira_key:
                                    # Debug: show unmatched pages (first few only to avoid spam)
                                    if len([c for c in children if not any(issue['key'] in c['title'] for issue in issues)]) < 5:
                                        st.caption(f"⚠️ No JIRA key found in: '{child_title[:60]}...'")
                                    continue
                                    
                                # Check if this is a container or gate page using more patterns
                                is_gate = False
                                gate_type = None
                                title_lower = child_title.lower()
                                
                                # Gate detection patterns
                                if ('code complete' in title_lower or 'ccm' in title_lower or 
                                    'codecomplete' in title_lower):
                                    is_gate = True
                                    gate_type = 'ccm'
                                elif ('cg checklist' in title_lower or 'commit gate' in title_lower or 
                                      'cg-checklist' in title_lower or 'commitgate' in title_lower):
                                    is_gate = True  
                                    gate_type = 'cg'
                                elif ('pg checklist' in title_lower or 'pg readiness' in title_lower or 
                                      'promotion gate' in title_lower or 'pg-checklist' in title_lower or 
                                      'promotiongate' in title_lower or 'readiness checklist' in title_lower):
                                    is_gate = True
                                    gate_type = 'pg'
                                
                                if is_gate and gate_type:
                                    # This is a gate page
                                    if jira_key not in existing_gates:
                                        existing_gates[jira_key] = {}
                                    existing_gates[jira_key][gate_type] = child
                                    st.caption(f"🎯 Found {gate_type.upper()} gate: {jira_key}")
                                else:
                                    # This is likely a container (not a gate page) - validate with expected titles
                                    if jira_key not in existing_containers:
                                        # Check if this is a valid container using both version formats
                                        issue_obj = next((i for i in issues if i['key'] == jira_key), None)
                                        if issue_obj:
                                            s = issue_obj.get('fields', {}).get('summary', '')
                                            
                                            # Try both version formats
                                            expected_v1 = sanitize_title(format_page_title(title_pattern, team=selected_team, version=version, jira_key=jira_key, summary=s))
                                            expected_v2 = sanitize_title(format_page_title(title_pattern, team=selected_team, version=selected_fix_version, jira_key=jira_key, summary=s))
                                            
                                            is_valid = (_is_likely_container(child_title, expected_v1) or 
                                                       _is_likely_container(child_title, expected_v2))
                                            
                                            if is_valid:
                                                existing_containers[jira_key] = child
                                                st.caption(f"📦 Found container: {jira_key} - {child_title[:40]}...")
                                            else:
                                                st.caption(f"❓ Skipped potential container: {jira_key} - {child_title[:40]}...")
                                        else:
                                            # Fallback: accept if we can't find the issue (shouldn't happen)
                                            existing_containers[jira_key] = child
                                            st.caption(f"📦 Found container (no validation): {jira_key}")
                            
                            st.write(f"📊 Found {len(existing_containers)} containers, {sum(len(gates) for gates in existing_gates.values())} gate pages")
                            
                            # Debug: Show which containers were found
                            if existing_containers:
                                found_keys = list(existing_containers.keys())
                                st.caption(f"✅ Containers found: {', '.join(found_keys[:5])}{'...' if len(found_keys) > 5 else ''}")
                            
                            # Debug: Show which tickets are missing containers (before CQL search)
                            missing_containers = [issue['key'] for issue in issues if issue['key'] not in existing_containers]
                            if missing_containers:
                                st.caption(f"🔍 Need CQL search for: {', '.join(missing_containers[:5])}{'...' if len(missing_containers) > 5 else ''}")
                                
                                # Show sample expected titles for debugging
                                if len(missing_containers) > 0:
                                    sample_key = missing_containers[0]
                                    sample_issue = next((i for i in issues if i['key'] == sample_key), None)
                                    if sample_issue:
                                        sample_summary = sample_issue.get('fields', {}).get('summary', '')
                                        st.caption(f"📋 Sample expectations for {sample_key}:")
                                        st.caption(f"   Summary: '{sample_summary}'")
                                        sample_v1 = format_page_title(title_pattern, team=selected_team, version=version, jira_key=sample_key, summary=sample_summary)
                                        sample_v2 = format_page_title(title_pattern, team=selected_team, version=selected_fix_version, jira_key=sample_key, summary=sample_summary)
                                        st.caption(f"   Expected v1: '{sample_v1}'")
                                        st.caption(f"   Expected v2: '{sample_v2}'")
                                
                                # CQL search for containers not found as direct children
                                st.write("🔍 Searching entire space for missing containers...")
                                
                                # Build expected titles for validation (support both version formats)
                                expected_titles = {}
                                for issue in issues:
                                    jk = issue['key']
                                    s = issue.get('fields', {}).get('summary', '')
                                    
                                    # Generate expected titles for both version formats
                                    # Format 1: version (e.g., "2.11")
                                    expected_titles[f"{jk}_v1"] = sanitize_title(
                                        format_page_title(title_pattern, team=selected_team, version=version,
                                                         jira_key=jk, summary=s)
                                    )
                                    
                                    # Format 2: fix_version (e.g., "NDB-2.11") 
                                    expected_titles[f"{jk}_v2"] = sanitize_title(
                                        format_page_title(title_pattern, team=selected_team, version=selected_fix_version,
                                                         jira_key=jk, summary=s)
                                    )
                                    
                                    # Store the best expected title for this JIRA key
                                    expected_titles[jk] = expected_titles[f"{jk}_v1"]
                                
                                st.caption(f"🔍 Generated {len(missing_containers)} expected title pairs for validation")
                                
                                # Batch CQL search with enhanced query (groups of 10 to avoid query length limits)
                                cql_found = 0
                                for i in range(0, len(missing_containers), 10):
                                    batch = missing_containers[i:i + 10]
                                    
                                    # Create more comprehensive CQL search including team and version variations
                                    jira_clauses = ' OR '.join(f'title ~ "{k}"' for k in batch)
                                    team_version_clauses = ' OR '.join([
                                        f'title ~ "{selected_team} Project Update - {version}"',
                                        f'title ~ "{selected_team} Project Update - {selected_fix_version}"'
                                    ])
                                    
                                    cql = f'space = "{space_key}" AND ({jira_clauses}) AND ({team_version_clauses}) AND type = page'
                                    
                                    try:
                                        st.caption(f"   🔎 CQL Query: {cql}")
                                        found_pages = confluence.search_pages(cql)
                                        st.caption(f"   📄 CQL returned {len(found_pages)} candidate pages for batch: {', '.join(batch)}")
                                        
                                        # Show first few page titles for debugging
                                        if found_pages:
                                            sample_titles = [p['title'] for p in found_pages[:3]]
                                            st.caption(f"   📋 Sample results: {'; '.join(sample_titles)}")
                                        
                                        for page in found_pages:
                                            pk = extract_jira_key_from_title(page['title'])
                                            if pk and pk in [issue['key'] for issue in issues] and pk not in existing_containers:
                                                # Try both version formats for validation
                                                expected_v1 = expected_titles.get(f"{pk}_v1", '')
                                                expected_v2 = expected_titles.get(f"{pk}_v2", '')
                                                
                                                is_valid_container = False
                                                matched_expected = ""
                                                
                                                # Check against version format (2.11)
                                                if expected_v1 and _is_likely_container(page['title'], expected_v1):
                                                    is_valid_container = True
                                                    matched_expected = expected_v1
                                                    expected_titles[pk] = expected_v1  # Update primary expected
                                                
                                                # Check against fix_version format (NDB-2.11)
                                                elif expected_v2 and _is_likely_container(page['title'], expected_v2):
                                                    is_valid_container = True  
                                                    matched_expected = expected_v2
                                                    expected_titles[pk] = expected_v2  # Update primary expected
                                                
                                                if is_valid_container:
                                                    existing_containers[pk] = page
                                                    cql_found += 1
                                                    st.caption(f"✅ CQL found container: {pk} - {page['title'][:50]}...")
                                                    st.caption(f"   Matched pattern: {matched_expected[:50]}...")
                                                else:
                                                    st.caption(f"❌ Page rejected: {pk} - {page['title'][:50]}...")
                                                    st.caption(f"   Expected v1: {expected_v1[:50]}...")
                                                    st.caption(f"   Expected v2: {expected_v2[:50]}...")
                                                    # Additional debugging for rejection reasons
                                                    if _is_gate_page_title(page['title']):
                                                        st.caption(f"   Rejection reason: Detected as gate page")
                                                    else:
                                                        st.caption(f"   Rejection reason: Title pattern mismatch")
                                    except Exception as e:
                                        st.caption(f"⚠️ CQL search error: {e}")
                                
                                if cql_found > 0:
                                    st.caption(f"🎯 CQL search found {cql_found} additional containers")
                                else:
                                    st.caption(f"❌ CQL search found 0 containers from {len(missing_containers)} missing keys")
                                    
                                    # Try a fallback simpler search for debugging
                                    if len(missing_containers) > 0:
                                        st.caption(f"🔄 Trying fallback search for first missing container...")
                                        test_key = missing_containers[0]
                                        fallback_cql = f'space = "{space_key}" AND title ~ "{test_key}" AND type = page'
                                        try:
                                            fallback_results = confluence.search_pages(fallback_cql)
                                            st.caption(f"   Fallback CQL: {fallback_cql}")
                                            st.caption(f"   Fallback found {len(fallback_results)} pages for {test_key}")
                                            if fallback_results:
                                                for fr in fallback_results[:3]:
                                                    st.caption(f"     - {fr['title']}")
                                        except Exception as e:
                                            st.caption(f"   Fallback search failed: {e}")
                                    
                                # Final debug: Show updated container counts
                                final_missing = [issue['key'] for issue in issues if issue['key'] not in existing_containers]
                                if final_missing:
                                    st.caption(f"⚠️ Still missing after CQL search: {', '.join(final_missing[:10])}{'...' if len(final_missing) > 10 else ''}")
                                    st.caption(f"   Total still missing: {len(final_missing)}/{len(issues)}")
                            
                            progress.progress(0.7)
                            
                            # Create ticket status objects
                            for issue in issues:
                                jira_key = issue['key']
                                summary = issue.get('fields', {}).get('summary', '')
                                ts = TicketStatus(jira_key=jira_key, summary=summary)
                                
                                if jira_key in existing_containers:
                                    container = existing_containers[jira_key]
                                    ts.container_id = container['id']
                                    ts.container_url = confluence.page_url(container)
                                    ts.container_action = 'exists'
                                else:
                                    ts.container_action = 'create'
                                
                                # Check for gate pages
                                ticket_gates = existing_gates.get(jira_key, {})
                                for gate_type in ['ccm', 'cg', 'pg']:
                                    if gate_type in ticket_gates:
                                        gate_page = ticket_gates[gate_type]
                                        ts.gates[gate_type] = {
                                            'exists': True,
                                            'page_id': gate_page['id'],
                                            'url': confluence.page_url(gate_page),
                                            'needs_sync': False,
                                        }
                                    else:
                                        ts.gates[gate_type] = {
                                            'exists': False,
                                            'page_id': '',
                                            'url': '',
                                            'needs_sync': False,
                                        }
                                
                                ticket_statuses_list.append(ts)
                            
                            progress.progress(1.0)
                            containers_found = len(existing_containers)
                            gates_found = sum(len(gates) for gates in existing_gates.values())
                            st.write(f"✅ Found {containers_found} containers, {gates_found} gate pages")
                            st.caption("💡 Quick scanning complete. For detailed sync status, use Team & Release page.")
                            
                        except Exception as e:
                            st.error(f"Scanning failed: {str(e)}")
                            # Create empty ticket statuses so the dashboard can still load
                            ticket_statuses_list = []
                            for issue in issues:
                                jira_key = issue['key']
                                summary = issue.get('fields', {}).get('summary', '')
                                ts = TicketStatus(jira_key=jira_key, summary=summary)
                                ts.container_action = 'create'  # Assume all need creation
                                for gate_type in ['ccm', 'cg', 'pg']:
                                    ts.gates[gate_type] = {'exists': False, 'page_id': '', 'url': '', 'needs_sync': False}
                                ticket_statuses_list.append(ts)
                            st.warning("Using fallback mode - dashboard will show all items as missing.")
                else:
                    st.warning(
                        f"Parent page '{parent_title}' not found in space '{space_key}'. "
                        "Confluence links will show as Not Available."
                    )
            except Exception as e:
                st.warning(f"Confluence scan error: {e}")

            # Discover templates automatically
            st.write("🎨 Discovering release templates...")
            discovered_templates = discover_release_templates(
                confluence=confluence,
                space_key=space_key,
                team=selected_team,
                version=version
            )
            
            # Apply discovered templates to session state
            templates_found = 0
            for gate_type, template_config in discovered_templates.items():
                if template_config:
                    st.session_state[f'template_config_{gate_type}'] = template_config
                    templates_found += 1
                    
            if templates_found > 0:
                st.write(f"✅ Found {templates_found} template(s) in 00-{selected_team}-{version}")

            st.session_state.dash_issues = issues
            st.session_state.dash_ticket_statuses = ticket_statuses_list
            st.session_state.dash_exec_id = exec_id
            st.session_state.dash_tcms_field = tcms_field
            st.session_state.dash_jira_url = jira.base_url
            st.session_state.dash_version = version
            st.session_state.dash_current_fix_version = selected_fix_version  # Use different key to avoid conflict
            st.session_state.dash_selected_team = selected_team
            st.session_state.dash_current_space_key = space_key
            st.session_state.dash_title_pattern = title_pattern
            st.session_state.dash_parent_page = parent_page if 'parent_page' in locals() else None
            load_status.update(
                label=f"✅ Dashboard Ready - {len(issues)} tickets", state="complete", expanded=False,
        )

# --- Enhanced Dashboard Display ---

if 'dash_issues' not in st.session_state:
    st.info("Select a team and version, then click **Load Dashboard**.")
    st.stop()

# Get session data
issues = st.session_state.get('dash_issues', [])
ticket_statuses = st.session_state.get('dash_ticket_statuses', [])
exec_id = st.session_state.get('dash_exec_id', '')
space_key = st.session_state.get('dash_current_space_key', '')
selected_team = st.session_state.get('dash_selected_team', '')
version = st.session_state.get('dash_version', '')
selected_fix_version = st.session_state.get('dash_current_fix_version', '')
title_pattern = st.session_state.get('dash_title_pattern', '')

st.divider()

# Compact header with stats
st.markdown(f"**{selected_team} {selected_fix_version}**")

# Condensed stats in fewer columns
stats_col1, stats_col2, stats_col3 = st.columns(3)

total_tickets = len(issues)
containers_needed_list = [ts.jira_key for ts in ticket_statuses if hasattr(ts, 'container_action') and ts.container_action == 'create']
containers_needed = len(containers_needed_list)
containers_exist = sum(1 for ts in ticket_statuses if hasattr(ts, 'container_action') and ts.container_action == 'exists')

with stats_col1:
    st.metric("Features", total_tickets)
    st.metric("Containers", f"{containers_exist}/{total_tickets}")
    if containers_needed > 0:
        st.caption(f"⚠ {containers_needed} missing")

# Gate statistics
gates_stats = {'ccm': {'exist': 0, 'sync': 0, 'missing': 0, 'missing_tickets': [], 'sync_tickets': []}, 
               'cg': {'exist': 0, 'sync': 0, 'missing': 0, 'missing_tickets': [], 'sync_tickets': []},
               'pg': {'exist': 0, 'sync': 0, 'missing': 0, 'missing_tickets': [], 'sync_tickets': []}}

for ts in ticket_statuses:
    if hasattr(ts, 'gates'):
        for gate_type in ['ccm', 'cg', 'pg']:
            gate_info = ts.gates.get(gate_type, {})
            if gate_info.get('exists'):
                if gate_info.get('needs_sync'):
                    gates_stats[gate_type]['sync'] += 1
                    gates_stats[gate_type]['sync_tickets'].append(ts.jira_key)
                else:
                    gates_stats[gate_type]['exist'] += 1
            elif hasattr(ts, 'container_id') and ts.container_id:
                gates_stats[gate_type]['missing'] += 1
                gates_stats[gate_type]['missing_tickets'].append(ts.jira_key)

with stats_col2:
    cg_total = gates_stats['cg']['exist'] + gates_stats['cg']['sync'] + gates_stats['cg']['missing']
    st.metric("CG Gates", f"{gates_stats['cg']['exist']}/{cg_total}")
    if gates_stats['cg']['missing'] > 0:
        st.caption(f"⚠ {gates_stats['cg']['missing']} missing")
    elif gates_stats['cg']['sync'] > 0:
        st.caption(f"↻ {gates_stats['cg']['sync']} need sync")

with stats_col3:
    pg_total = gates_stats['pg']['exist'] + gates_stats['pg']['sync'] + gates_stats['pg']['missing']
    st.metric("PG Gates", f"{gates_stats['pg']['exist']}/{pg_total}")
    if gates_stats['pg']['missing'] > 0:
        st.caption(f"⚠ {gates_stats['pg']['missing']} missing")
    elif gates_stats['pg']['sync'] > 0:
        st.caption(f"↻ {gates_stats['pg']['sync']} need sync")

st.divider()

# Detailed Missing Items (Expandable)
total_missing_items = containers_needed + sum(gates_stats[gt]['missing'] for gt in ['ccm', 'cg', 'pg'])
total_sync_items = sum(gates_stats[gt]['sync'] for gt in ['ccm', 'cg', 'pg'])

if total_missing_items > 0 or total_sync_items > 0:
    with st.expander(f"📋 **Details: {total_missing_items} missing, {total_sync_items} need sync**", expanded=False):
        # Create a compact grid showing exactly what's missing per ticket
        detail_col1, detail_col2 = st.columns(2)
        
        with detail_col1:
            if total_missing_items > 0:
                st.markdown("**🟠 Missing Pages**")
                
                # Group by ticket to show what each ticket is missing
                ticket_missing = {}
                
                # Add container info
                for ticket in containers_needed_list:
                    if ticket not in ticket_missing:
                        ticket_missing[ticket] = []
                    ticket_missing[ticket].append("📦 Container")
                
                # Add gate info
                for gate_type in ['ccm', 'cg', 'pg']:
                    gate_icon = {'ccm': '📝', 'cg': '🛡️', 'pg': '🚀'}[gate_type]
                    for ticket in gates_stats[gate_type]['missing_tickets']:
                        if ticket not in ticket_missing:
                            ticket_missing[ticket] = []
                        ticket_missing[ticket].append(f"{gate_icon} {gate_type.upper()}")
                
                # Display in a clean, dense format
                for ticket, missing_items in ticket_missing.items():
                    items_text = " + ".join(missing_items)
                    st.markdown(f"**{ticket}**: {items_text}")
        
        with detail_col2:
            if total_sync_items > 0:
                st.markdown("**🟡 Need Sync**")
                
                # Group sync items by ticket
                ticket_sync = {}
                for gate_type in ['ccm', 'cg', 'pg']:
                    gate_icon = {'ccm': '📝', 'cg': '🛡️', 'pg': '🚀'}[gate_type]
                    for ticket in gates_stats[gate_type]['sync_tickets']:
                        if ticket not in ticket_sync:
                            ticket_sync[ticket] = []
                        ticket_sync[ticket].append(f"{gate_icon} {gate_type.upper()}")
                
                # Display in a clean, dense format
                for ticket, sync_items in ticket_sync.items():
                    items_text = " + ".join(sync_items)
                    st.markdown(f"**{ticket}**: {items_text}")

st.divider()

# Compact actions  
if exec_id and ticket_statuses:
    total_missing = sum(gates_stats[gt]['missing'] for gt in ['ccm', 'cg', 'pg'])
    total_sync_needed = sum(gates_stats[gt]['sync'] for gt in ['ccm', 'cg', 'pg'])
    
    # Show actions only if needed
    actions_needed = containers_needed > 0 or total_missing > 0 or total_sync_needed > 0
    
    if actions_needed:
        action_col1, action_col2, action_col3 = st.columns(3)
        
        if containers_needed > 0:
            with action_col1:
                if st.button(f"Create Containers ({containers_needed})", 
                            type="primary", use_container_width=True, key="dash_create_containers"):
                    _create_all_containers_dashboard(confluence, space_key, exec_id, ticket_statuses, 
                                                   issues, selected_team, version, title_pattern)
        
        if total_missing > 0:
            with action_col2:
                if st.button(f"Create Pages ({total_missing})", 
                            type="primary", use_container_width=True, key="dash_create_missing"):
                    _create_missing_pages_dashboard(confluence, space_key, ticket_statuses, 
                                                   issues, selected_team, version)
        
        if total_sync_needed > 0:
            with action_col3:
                if st.button(f"Sync Pages ({total_sync_needed})", 
                            type="secondary", use_container_width=True, key="dash_sync_pages"):
                    _sync_pages_dashboard(confluence, ticket_statuses, selected_team, version)
    
    st.divider()

# Simplified feature list - remove redundant grid section since we have detailed table below
pass

issues = st.session_state.dash_issues
ticket_statuses = st.session_state.get('dash_ticket_statuses', [])
ts_by_key = {ts.jira_key: ts for ts in ticket_statuses}
issues_by_key = {i['key']: i for i in issues}
tcms_field_id = st.session_state.get('dash_tcms_field', '')
jira_base = st.session_state.get('dash_jira_url', '')
exec_id = st.session_state.get('dash_exec_id', '')
dash_version = st.session_state.get('dash_version', '')
dash_fix_version = st.session_state.get('dash_current_fix_version', '')
dash_team = st.session_state.get('dash_selected_team', '')
dash_space = st.session_state.get('dash_current_space_key', '')
server_id = team_cfg.get('jira_server_id', '')
title_pattern = team_cfg.get(
    'page_title_pattern',
    '{team} Project Update - {version} - {jira_key} - {summary}',
)
tag = generate_tag(dash_team, dash_version) if dash_team and dash_version else ''

if not issues:
    st.warning("No tickets found for this release.")
    st.stop()

st.markdown(f"**Features ({len(issues)})**")

# Compact header row
hdr = st.columns([0.3, 2.2, 0.7, 1, 1, 1, 1])
hdr[0].markdown("**#**")
hdr[1].markdown("**Key / Summary**")
hdr[2].markdown("**Status**")
hdr[3].markdown("**CC**")
hdr[4].markdown("**CG**")
hdr[5].markdown("**PG**")
hdr[6].markdown("**TCMS**")

for idx, issue in enumerate(issues, 1):
    f = issue.get('fields', {})
    key = issue['key']
    summary = f.get('summary', '')
    summary_short = summary[:60] + '...' if len(summary) > 60 else summary
    status_name = f.get('status', {}).get('name', '')

    ts = ts_by_key.get(key)
    container_id = ts.container_id if ts else ''

    cols = st.columns([0.3, 2.2, 0.7, 1, 1, 1, 1])

    cols[0].markdown(f"{idx}")
    jira_link = f"[{key}]({jira_base}/browse/{key})" if jira_base else key
    cols[1].markdown(f"{jira_link}")
    cols[1].caption(f"{summary_short}")
    cols[2].caption(status_name)

    # Gate columns: CC, CG, PG
    for col_idx, gate_type in enumerate(['ccm', 'cg', 'pg']):
        gate_col = cols[3 + col_idx]
        gate_info = ts.gates.get(gate_type, {}) if ts else {}

        if gate_info.get('exists') and gate_info.get('url'):
            gate_col.markdown(f"[✓]({gate_info['url']})")
        elif container_id and exec_id:
            gate_config = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
            default_ready = gate_type in ('ccm', 'cg')
            gate_ready = gate_config.get('ready', default_ready)
            template_config = gate_config if gate_config.get('gate_type') == gate_type else get_default_config(gate_type)
            _ci = template_config.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
            if _ci:
                template_config = {**template_config, 'compliance_items': _ci}

            if gate_ready:
                if gate_col.button("➕", key=f"dash_create_{gate_type}_{key}", use_container_width=True, help=f"Create {gate_type.upper()}"):
                    with st.spinner(f"Creating {GATE_TYPES[gate_type]['label']}..."):
                        ti = _extract_team_info(f)
                        result = create_gate_page(
                            confluence=confluence,
                            space_key=dash_space,
                            container_id=container_id,
                            jira_key=key,
                            summary=summary,
                            team=dash_team,
                            version=dash_version,
                            fix_version=dash_fix_version,
                            server_id=server_id,
                            title_pattern=title_pattern,
                            tag=tag,
                            gate_type=gate_type,
                            template_config=template_config,
                            team_info=ti,
                        )
                        if result.action == 'created':
                            ts.gates[gate_type] = {
                                'exists': True,
                                'page_id': result.page_id,
                                'url': result.page_url,
                                'needs_sync': False,
                            }
                            st.rerun()
                        else:
                            st.error(f"Failed: {result.details}")
            else:
                gate_col.caption("—")
        elif not container_id and exec_id:
            if gate_col.button("🏗️", key=f"dash_create_container_and_{gate_type}_{key}", use_container_width=True,
                               help="Create container + gate"):
                with st.spinner(f"Creating container + {GATE_TYPES[gate_type]['label']}..."):
                    c_result = create_container_page(
                        confluence=confluence,
                        space_key=dash_space,
                        execution_folder_id=exec_id,
                        jira_key=key,
                        summary=summary,
                        team=dash_team,
                        version=dash_version,
                        server_id=server_id,
                        title_pattern=title_pattern,
                        tag=tag,
                    )
                    if c_result.action == 'created':
                        ts.container_id = c_result.page_id
                        ts.container_url = c_result.page_url
                        ts.container_action = 'exists'

                        gate_config = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
                        template_config = gate_config if gate_config.get('gate_type') == gate_type else get_default_config(gate_type)
                        _ci = template_config.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
                        if _ci:
                            template_config = {**template_config, 'compliance_items': _ci}
                        ti = _extract_team_info(f)
                        g_result = create_gate_page(
                            confluence=confluence,
                            space_key=dash_space,
                            container_id=c_result.page_id,
                            jira_key=key,
                            summary=summary,
                            team=dash_team,
                            version=dash_version,
                            fix_version=dash_fix_version,
                            server_id=server_id,
                            title_pattern=title_pattern,
                            tag=tag,
                            gate_type=gate_type,
                            template_config=template_config,
                            team_info=ti,
                        )
                        if g_result.action == 'created':
                            ts.gates[gate_type] = {
                                'exists': True,
                                'page_id': g_result.page_id,
                                'url': g_result.page_url,
                                'needs_sync': False,
                            }
                        st.rerun()
                    else:
                        st.error(f"Container creation failed: {c_result.details}")
        else:
            gate_col.caption("—")

    # TCMS column
    tcms_url = ''
    if tcms_field_id:
        raw = f.get(tcms_field_id)
        if raw and isinstance(raw, str) and raw.strip():
            tcms_url = raw.strip()
    if tcms_url:
        cols[6].markdown(f"[↗]({tcms_url})")
    else:
        cols[6].caption("—")


