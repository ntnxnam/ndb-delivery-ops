import streamlit as st

# Import authentication components
from src.header import render_header, check_authentication

from src.utils import (
    load_team_config,
    load_template_overrides,
    load_workflow_state,
    save_workflow_state,
    save_report_state,
    get_version_from_fix_version,
    generate_tag,
    _deep_merge,
)
from src.page_manager import (
    ensure_phase_folders,
    scan_tickets,
    rescan_single_ticket,
    create_container_page,
    create_gate_page,
    recreate_gate_page,
    fix_container,
    fix_gate_page,
    sync_gate_page_content,
    sync_container_content,
    CleanupItem,
    validate_page_macro_ids,
    get_linked_confluence_pages,
    linked_pages_not_under_container,
    move_linked_pages_under_container,
    discover_release_templates,
)
from src.template_data import get_default_config, GATE_TYPES


def _extract_team_info(issue_fields: dict) -> dict:
    """Build team_info dict from JIRA issue fields. Returns role -> display name, or empty for unknown."""
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


st.set_page_config(page_title="Team & Release", page_icon="🏢", layout="wide")

# Render header and check authentication
render_header()
if not check_authentication():
    st.stop()

st.title("Team & Release")
st.caption("Team, version, space, and parent page are saved and restored after a browser refresh.")

# Load saved template overrides so Create buttons use persisted config
overrides = load_template_overrides()
for gate_type in GATE_TYPES:
    config_key = f'template_config_{gate_type}'
    if config_key not in st.session_state and overrides:
        default = get_default_config(gate_type)
        st.session_state[config_key] = _deep_merge(default, overrides.get(gate_type, {}))

team_config = load_team_config()
teams = team_config['teams']
team_names = list(teams.keys())

# Restore last workflow state only on a fresh session (browser refresh / first visit).
# Once restored, set a flag so reruns triggered by version/team changes don't
# re-inject stale values that were intentionally cleared.
if '_workflow_restored' not in st.session_state:
    _saved = load_workflow_state()
    if _saved:
        if 'team_select' not in st.session_state and _saved.get('team_select') in team_names:
            st.session_state.team_select = _saved['team_select']
        for _k in ('primary_project_input', 'confluence_space_input',
                    'parent_page_id', 'parent_page_title', 'jql_input', 'fix_version_select'):
            if _k not in st.session_state and _saved.get(_k) is not None:
                st.session_state[_k] = _saved[_k]

        # Recompute parent_page_input from the restored fix_version_select
        # rather than restoring the saved value, which can be out of sync.
        _restored_team = _saved.get('team_select')
        _restored_fv = st.session_state.get('fix_version_select')
        if _restored_team and _restored_team in teams and _restored_fv:
            _restored_cfg = teams[_restored_team]
            _restored_ver = get_version_from_fix_version(_restored_fv, _restored_cfg['fix_version_prefix'])
            st.session_state['parent_page_input'] = _restored_cfg['parent_page_title_pattern'].format(
                team=_restored_team, version=_restored_ver, fix_version=_restored_fv
            )
            st.session_state['_last_fix_version'] = _restored_fv
        elif 'parent_page_input' not in st.session_state and _saved.get('parent_page_input') is not None:
            st.session_state['parent_page_input'] = _saved['parent_page_input']

    st.session_state['_workflow_restored'] = True

# Quick Setup Section
st.subheader("🚀 Quick Setup")
st.markdown("*Setup everything automatically with just team and version selection*")

quick_col1, quick_col2, quick_col3 = st.columns([1, 1, 2])

with quick_col1:
    quick_team = st.selectbox(
        "Team",
        team_names,
        format_func=lambda t: teams[t]['display_name'],
        key="quick_team_select",
        index=team_names.index(st.session_state.get('team_select', team_names[0])) if st.session_state.get('team_select') in team_names else 0
    )

with quick_col2:
    if quick_team:
        quick_team_cfg = teams[quick_team]
        quick_fix_versions = quick_team_cfg.get('fix_versions', [])
        quick_selected_fix_version = st.selectbox(
            "Fix Version",
            quick_fix_versions,
            key="quick_fix_version_select",
            index=quick_fix_versions.index(st.session_state.get('fix_version_select', quick_fix_versions[0] if quick_fix_versions else '')) if st.session_state.get('fix_version_select') in quick_fix_versions else 0
        )
        quick_version = get_version_from_fix_version(quick_selected_fix_version, quick_team_cfg['fix_version_prefix']) if quick_selected_fix_version else ""

with quick_col3:
    if quick_team and quick_selected_fix_version:
        if not st.session_state.get('smart_setup_complete'):
            if st.button("⚡ **Auto Setup & Go**", type="primary", use_container_width=True,
                         help="Automatically discover templates, setup pages, and fetch tickets"):
                with st.status("Setting up your release...", expanded=True) as status:
                    try:
                        # Auto-populate all session state from selections
                        st.session_state.team_select = quick_team
                        st.session_state.fix_version_select = quick_selected_fix_version
                        st.session_state.selected_team = quick_team
                        st.session_state.team_config = quick_team_cfg
                        st.session_state.selected_fix_version = quick_selected_fix_version
                        st.session_state.version = quick_version
                        
                        # Step 1: Auto-configure basic settings
                        st.write("⚙️ Configuring team settings...")
                        primary_project = quick_team_cfg['primary_project']
                        confluence_space = quick_team_cfg.get('confluence_space', '')
                        st.session_state.confluence_space = confluence_space
                        st.session_state.primary_project_input = primary_project
                        st.session_state.confluence_space_input = confluence_space
                        st.session_state.primary_project = primary_project
                        
                        # Step 2: Auto-discover parent page
                        st.write("📄 Finding parent page...")
                        parent_page_title = quick_team_cfg['parent_page_title_pattern'].format(
                            team=quick_team, version=quick_version, fix_version=quick_selected_fix_version
                        )
                        st.session_state.parent_page_input = parent_page_title
                        
                        confluence = st.session_state.confluence_client
                        page = ensure_parent_page(
                            confluence=confluence,
                            space_key=confluence_space,
                            parent_title=parent_page_title,
                            root_page_id=quick_team_cfg.get('root_page_id')
                        )
                        
                        if not page:
                            raise Exception(f"Could not find or create parent page: {parent_page_title}")
                            
                        st.session_state.parent_page_id = page['id']
                        st.session_state.parent_page_title = page['title']
                        
                        # Step 3: Auto-discover templates from 00-{team}-{version} folder
                        st.write("🎨 Discovering release templates...")
                        discovered_templates = discover_release_templates(
                            confluence=confluence,
                            space_key=confluence_space,
                            team=quick_team,
                            version=quick_version
                        )
                        
                        # Apply discovered templates to session state
                        templates_found = 0
                        for gate_type, template_config in discovered_templates.items():
                            if template_config:
                                st.session_state[f'template_config_{gate_type}'] = template_config
                                templates_found += 1
                                
                        if templates_found > 0:
                            st.write(f"✅ Found {templates_found} template(s) in 00-{quick_team}-{quick_version}")
                        else:
                            st.write("⚠️ No templates found - using defaults")
                        
                        # Step 4: Auto-generate and execute JQL
                        st.write("🔍 Fetching tickets from JIRA...")
                        jira = st.session_state.jira_client
                        jql_template = quick_team_cfg['jql_template']
                        jql = jql_template.format(
                            project=primary_project,
                            fix_version=quick_selected_fix_version
                        )
                        st.session_state.jql = jql
                        st.session_state.jql_input = jql
                        
                        issues = jira.search_issues(jql)
                        st.session_state.fetched_issues = issues
                        
                        # Step 5: Auto-setup Confluence folders and scan
                        st.write("🏗️ Setting up Confluence structure...")
                        folder_info = ensure_phase_folders(
                            confluence=confluence,
                            space_key=confluence_space,
                            parent_id=page['id'],
                            team=quick_team,
                            version=quick_version,
                            phase_patterns=quick_team_cfg.get('phase_folders', {}),
                            jql=jql,
                            server_id=quick_team_cfg.get('jira_server_id', ''),
                            fix_version=quick_selected_fix_version,
                        )
                        st.session_state.folder_info = folder_info
                        
                        # Step 6: Scan existing pages
                        execution_folder_id = folder_info.get('execution', {}).get('id', '')
                        if execution_folder_id:
                            st.write("🔎 Scanning for existing pages...")
                            title_pattern = quick_team_cfg.get('page_title_pattern', '{team} Project Update - {version} - {jira_key} - {summary}')
                            
                            ticket_statuses, misplaced_gates, orphan_containers = scan_tickets(
                                confluence=confluence,
                                space_key=confluence_space,
                                execution_folder_id=execution_folder_id,
                                issues=issues,
                                team=quick_team,
                                version=quick_version,
                                title_pattern=title_pattern,
                            )
                            
                            st.session_state.ticket_statuses = ticket_statuses
                            st.session_state.cleanup_misplaced = misplaced_gates
                            st.session_state.cleanup_orphans = orphan_containers
                        
                        # Mark setup as complete
                        st.session_state.smart_setup_complete = True
                        
                        status.update(
                            label=f"🎉 Setup Complete - {len(issues)} tickets ready!", 
                            state="complete", 
                            expanded=False
                        )
                        st.rerun()
                        
                    except Exception as e:
                        status.update(label="⚠️ Setup failed", state="error", expanded=True)
                        st.error(f"Setup failed: {e}")
        else:
            # Show setup summary when complete
            issues_count = len(st.session_state.get('fetched_issues', []))
            st.success(f"✅ **Setup Complete** - {issues_count} tickets ready")
            if st.button("🔄 Reset", help="Reset to do setup again", key="reset_smart_setup"):
                st.session_state.smart_setup_complete = False
                st.rerun()

# Show detailed manual setup in collapsible section
with st.expander("🔧 Manual Setup (Advanced)", expanded=not st.session_state.get('smart_setup_complete', False)):
    st.subheader("1. Select Team")
selected_team = st.selectbox(
    "Team",
    team_names,
    format_func=lambda t: teams[t]['display_name'],
    key="team_select"
)

team_cfg = teams[selected_team]
if st.session_state.get('selected_team') != selected_team:
    for _stale_key in ('folder_info', 'ticket_statuses', 'creation_results',
                       'parent_page_id', 'parent_page_title', '_last_fix_version',
                       'available_versions', 'selected_fix_version',
                       'parent_page_input', 'fix_version_select', 'jql_input',
                       'fetched_issues', 'cleanup_misplaced', 'cleanup_orphans'):
        st.session_state.pop(_stale_key, None)
    # Clear linked page caches
    for _k in list(st.session_state.keys()):
        if _k.startswith('_linked_pages_'):
            st.session_state.pop(_k, None)
    st.session_state.selected_team = selected_team
    st.rerun()
st.session_state.selected_team = selected_team
st.session_state.team_config = team_cfg

st.subheader("2. Primary Project")
primary_project = st.text_input(
    "Primary JIRA Project Key",
    value=team_cfg['primary_project'],
    key="primary_project_input",
    help="JIRA project key for this team (e.g. ERA, NCI). Used to fetch fix versions and run JQL."
)
st.session_state.primary_project = primary_project

st.subheader("3. Select Fix Version")

jira = st.session_state.jira_client

# Auto-fetch versions when team or project changes (no button needed)
_version_cache_key = f'available_versions_{selected_team}_{primary_project}'
if _version_cache_key not in st.session_state:
    with st.spinner(f"Fetching fix versions for {primary_project}..."):
        try:
            versions = jira.get_fix_versions(primary_project)
            prefix = team_cfg['fix_version_prefix']
            filtered = [v for v in versions if v['name'].upper().startswith(prefix.upper())]
            st.session_state[_version_cache_key] = filtered if filtered else versions
            st.session_state.available_versions = st.session_state[_version_cache_key]
        except Exception as e:
            st.error(f"Failed to fetch versions: {e}")
            st.session_state[_version_cache_key] = []
            st.session_state.available_versions = []
else:
    st.session_state.available_versions = st.session_state[_version_cache_key]

col_ver_refresh, col_ver_spacer = st.columns([0.15, 0.85])
with col_ver_refresh:
    if st.button("↻ Refresh", key="refresh_versions", help="Re-fetch fix versions from JIRA"):
        st.session_state.pop(_version_cache_key, None)
        st.rerun()

if 'available_versions' in st.session_state and st.session_state.available_versions:
    version_names = [v['name'] for v in st.session_state.available_versions]

    # If the restored fix_version_select isn't in the fetched list, discard it
    # so the selectbox doesn't silently fall back while other state stays stale.
    if st.session_state.get('fix_version_select') not in version_names:
        st.session_state.pop('fix_version_select', None)

    selected_fix_version = st.selectbox(
        "Fix Version",
        version_names,
        key="fix_version_select"
    )
    st.session_state.selected_fix_version = selected_fix_version

    version = get_version_from_fix_version(selected_fix_version, team_cfg['fix_version_prefix'])
    st.session_state.version = version

    # Detect fix-version change and clear all downstream state *before*
    # the dependent widgets render, then rerun so widgets pick up fresh defaults.
    if st.session_state.get('_last_fix_version') != selected_fix_version:
        st.session_state['_last_fix_version'] = selected_fix_version
        for _stale_key in ('folder_info', 'ticket_statuses', 'creation_results',
                           'parent_page_id', 'parent_page_title',
                           'jql_input', 'fetched_issues',
                           'cleanup_misplaced', 'cleanup_orphans'):
            st.session_state.pop(_stale_key, None)
        for _k in list(st.session_state.keys()):
            if _k.startswith('_linked_pages_'):
                st.session_state.pop(_k, None)
        # Set the widget key to the correct value BEFORE rerun so Streamlit
        # uses it as the widget's value on the next render cycle.
        _new_parent = team_cfg['parent_page_title_pattern'].format(
            team=selected_team, version=version, fix_version=selected_fix_version
        )
        st.session_state['parent_page_input'] = _new_parent
        st.rerun()

    st.divider()
    st.subheader("4. Confluence Space & Parent Page")

    confluence_space = st.text_input(
        "Confluence Space Key",
        value=team_cfg.get('confluence_space', ''),
        key="confluence_space_input",
        help="Confluence space where the parent page lives (e.g. ED). Find it in the space URL or space settings."
    )
    st.session_state.confluence_space = confluence_space

    parent_title_default = team_cfg['parent_page_title_pattern'].format(
        team=selected_team, version=version, fix_version=selected_fix_version
    )

    parent_page_input = st.text_input(
        "Parent Page Title (or Page ID)",
        value=st.session_state.get('parent_page_input', parent_title_default),
        help="Enter the title of the parent page, or its numeric page ID",
        key="parent_page_input"
    )

    confluence = st.session_state.confluence_client

    col_validate, col_auto = st.columns(2)

    with col_validate:
        if st.button("Find Parent Page", key="validate_parent", use_container_width=True):
            with st.spinner("Searching..."):
                try:
                    if parent_page_input.isdigit():
                        page = confluence.get_page_by_id(parent_page_input)
                    else:
                        page = confluence.get_page_by_title(confluence_space, parent_page_input)

                    if page:
                        st.success(f"Found: **{page['title']}** (ID: {page['id']})")
                        st.session_state.parent_page_id = page['id']
                        st.session_state.parent_page_title = page['title']
                    else:
                        st.warning(f"Page not found: '{parent_page_input}' in space '{confluence_space}'")
                        st.caption("You can paste the numeric Page ID from the Confluence URL (e.g. …/pages/417927296/…) into the Parent Page field and click Find Parent Page.")
                except Exception as e:
                    st.error(f"Error: {e}")

    with col_auto:
        if st.button("Create If Missing", key="auto_create_parent", use_container_width=True,
                      help="Search for the parent page; create it if it doesn't exist"):
            with st.spinner("Searching / creating..."):
                try:
                    from src.page_manager import ensure_parent_page

                    root_id = team_cfg.get('root_page_id', None)
                    page = ensure_parent_page(
                        confluence=confluence,
                        space_key=confluence_space,
                        parent_title=parent_page_input,
                        root_page_id=root_id
                    )

                    if page:
                        st.success(f"Ready: **{page['title']}** (ID: {page['id']})")
                        st.session_state.parent_page_id = page['id']
                        st.session_state.parent_page_title = page['title']
                    else:
                        st.error(
                            f"Page '{parent_page_input}' not found and no `root_page_id` is configured "
                            f"for team {selected_team} to auto-create under. "
                            f"Add `root_page_id` to config/teams.json or create the page manually. "
                            f"You can also paste the numeric Page ID from the Confluence URL (e.g. …/pages/417927296/…) into the Parent Page field and click Find Parent Page."
                        )
                except Exception as e:
                    st.error(f"Error: {e}")

    # Persist workflow state only when values actually changed
    _workflow_keys = (
        'team_select', 'primary_project_input', 'confluence_space_input',
        'parent_page_input', 'parent_page_id', 'parent_page_title',
        'fix_version_select', 'jql_input',
    )
    _state_to_save = {k: st.session_state[k] for k in _workflow_keys if k in st.session_state}
    if _state_to_save and _state_to_save != st.session_state.get('_last_saved_workflow'):
        save_workflow_state(_state_to_save)
        st.session_state['_last_saved_workflow'] = _state_to_save

    if st.session_state.get('parent_page_id'):
        st.divider()
        st.subheader("5. JQL Query")

        jql_default = team_cfg['jql_template'].format(
            project=primary_project,
            fix_version=selected_fix_version
        )
        jql = st.text_area(
            "JQL Query",
            value=jql_default,
            height=100,
            key="jql_input",
            help="JIRA query for features in this fix version. Click Fetch Tickets to load issues. Use standard JQL (e.g. project, fixVersion, issuetype)."
        )
        st.session_state.jql = jql

        if st.button("Fetch Tickets", type="primary", key="fetch_tickets"):
            with st.spinner("Querying JIRA..."):
                try:
                    issues = jira.search_issues(jql)
                    st.session_state.fetched_issues = issues
                    st.success(f"Found **{len(issues)}** tickets")
                except Exception as e:
                    st.error(f"JQL query failed: {e}")

        if 'fetched_issues' in st.session_state and st.session_state.fetched_issues:
            issues = st.session_state.fetched_issues
            parent_page_id = st.session_state.parent_page_id
            space_key = st.session_state.confluence_space
            title_pattern = team_cfg.get('page_title_pattern', '{team} Project Update - {version} - {jira_key} - {summary}')
            tag = generate_tag(selected_team, version)
            server_id = team_cfg.get('jira_server_id', '')

# Main workflow - show if we have completed either smart setup or manual setup
if st.session_state.get('smart_setup_complete') or (st.session_state.get('fetched_issues') and not st.session_state.get('smart_setup_complete')):
    
    # Get necessary variables from session state
    selected_team = st.session_state.get('team_select')
    team_cfg = teams.get(selected_team, {})
    selected_fix_version = st.session_state.get('fix_version_select')
    version = st.session_state.get('version', get_version_from_fix_version(selected_fix_version, team_cfg.get('fix_version_prefix', '')) if selected_fix_version else '')
    primary_project = st.session_state.get('primary_project')
    confluence_space = st.session_state.get('confluence_space')
    jql = st.session_state.get('jql')
    issues = st.session_state.get('fetched_issues', [])
    parent_page_id = st.session_state.get('parent_page_id')
    space_key = confluence_space
    title_pattern = team_cfg.get('page_title_pattern', '{team} Project Update - {version} - {jira_key} - {summary}')
    tag = generate_tag(selected_team, version) if selected_team and version else ''
    server_id = team_cfg.get('jira_server_id', '')

    # Only show manual confluence setup section if not using smart setup
    if not st.session_state.get('smart_setup_complete'):

        # --- Set up Confluence (folders + scan) — single button ---
        st.divider()
        st.subheader("Set up Confluence & scan")

        _col_load, _col_rescan = st.columns([0.5, 0.5])
        with _col_load:
            _load_label = "↻ Re-scan" if st.session_state.get('folder_info') else "Load Release"
            if st.button(_load_label, type="primary", key="ensure_folders", use_container_width=True,
                         help="Check/create phase folders, then scan Confluence for existing pages"):
                with st.status("Setting up Confluence...", expanded=True) as _status:
                    try:
                        st.write("Checking phase folders...")
                        folder_info = ensure_phase_folders(
                            confluence=confluence,
                            space_key=space_key,
                            parent_id=parent_page_id,
                            team=selected_team,
                            version=version,
                            phase_patterns=team_cfg.get('phase_folders', {}),
                            jql=jql,
                            server_id=server_id,
                            fix_version=selected_fix_version,
                        )
                        st.session_state.folder_info = folder_info
                        execution_folder_id = folder_info.get('execution', {}).get('id', '')
                        if execution_folder_id:
                            st.write(f"Scanning {len(issues)} tickets in Confluence...")
                            ticket_statuses, misplaced_gates, orphan_containers = scan_tickets(
                                confluence=confluence,
                                space_key=space_key,
                                execution_folder_id=execution_folder_id,
                                issues=issues,
                                team=selected_team,
                                version=version,
                                title_pattern=title_pattern,
                            )
                            st.session_state.ticket_statuses = ticket_statuses
                            st.session_state.cleanup_misplaced = misplaced_gates
                            st.session_state.cleanup_orphans = orphan_containers
                            _status.update(label=f"Ready — {len(ticket_statuses)} tickets scanned", state="complete", expanded=False)
                        else:
                            _status.update(label="Folders ready (no execution folder to scan)", state="complete", expanded=False)
                        st.rerun()
                    except Exception as e:
                        _status.update(label="Setup failed", state="error", expanded=True)
                        st.error(f"Failed: {e}")

        if st.session_state.get('folder_info'):
            with _col_rescan:
                st.write("")  # spacer to align vertically
                with st.expander("Folder details", expanded=False):
                    for phase, info in st.session_state.folder_info.items():
                        status = info['status']
                        fid = info['id']
                        if status == 'created':
                            st.success(f"**{phase.title()}** — Created `{fid}`")
                        elif status == 'renamed':
                            st.info(f"**{phase.title()}** — Renamed `{fid}`")
                        else:
                            st.caption(f"**{phase.title()}** — Exists `{fid}`")
            execution_folder_id = st.session_state.folder_info.get('execution', {}).get('id', '')
        else:
            st.info("Click **Load Release** to set up folders and scan Confluence for existing pages.")
            execution_folder_id = ''
    
    # Get execution folder ID - works for both smart and manual setup
    if st.session_state.get('folder_info'):
        execution_folder_id = st.session_state.folder_info.get('execution', {}).get('id', '')
    else:
        execution_folder_id = ''

    # Initialize creation results if needed
    if 'creation_results' not in st.session_state:
        st.session_state.creation_results = []

    # Get ticket statuses
    ticket_statuses = st.session_state.get('ticket_statuses', [])
    confluence = st.session_state.confluence_client
    ticket_statuses_by_key = {ts.jira_key: ts for ts in ticket_statuses} if ticket_statuses else {}
    issues_by_key = {i['key']: i for i in issues}
    execution_folder_id = st.session_state.get('folder_info', {}).get('execution', {}).get('id', '')

    # --- Bulk actions (when we have scan results) ---
    if ticket_statuses:
        containers_to_create = sum(1 for ts in ticket_statuses if ts.container_action == 'create')
        with st.expander("Bulk actions", expanded=False):
                    bc1, bc2, bc3, bc4 = st.columns(4)
                    with bc1:
                        if containers_to_create > 0 and st.button("Create All Containers", key="bulk_containers", use_container_width=True):
                          with st.status(f"Creating {containers_to_create} containers...", expanded=True) as _status:
                            _progress = st.progress(0.0)
                            created = 0
                            processed = 0
                            for ts in ticket_statuses:
                                if ts.container_action != 'create':
                                    continue
                                st.write(f"`{ts.jira_key}` — {ts.summary[:60]}")
                                result = create_container_page(
                                    confluence=confluence, space_key=space_key,
                                    execution_folder_id=execution_folder_id,
                                    jira_key=ts.jira_key, summary=ts.summary,
                                    team=selected_team, version=version, server_id=server_id,
                                    title_pattern=title_pattern, tag=tag
                                )
                                st.session_state.creation_results.append(result)
                                if result.action == 'created':
                                    ts.container_action = 'exists'
                                    ts.container_id = result.page_id
                                    ts.container_url = result.page_url
                                    created += 1
                                processed += 1
                                _progress.progress(processed / containers_to_create)
                            _status.update(label=f"Done — created {created} of {containers_to_create} containers", state="complete", expanded=False)
                            st.rerun()
                    for gate_idx, gate_type in enumerate(['ccm', 'cg', 'pg']):
                        with (bc2, bc3, bc4)[gate_idx]:
                            gate_config = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
                            default_ready = gate_type in ('ccm', 'cg')
                            gate_ready = gate_config.get('ready', default_ready)
                            template_config = gate_config if gate_config.get('gate_type') == gate_type else get_default_config(gate_type)
                            _ci = template_config.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
                            if _ci:
                                template_config = {**template_config, 'compliance_items': _ci}
                            missing = sum(1 for ts in ticket_statuses if ts.container_id and not ts.gates.get(gate_type, {}).get('exists'))
                            if missing > 0 and gate_ready and st.button(f"Create All {GATE_TYPES[gate_type]['label']} ({missing})", key=f"bulk_{gate_type}", use_container_width=True):
                              _gate_label = GATE_TYPES[gate_type]['label']
                              with st.status(f"Creating {missing} {_gate_label} pages...", expanded=True) as _status:
                                _progress = st.progress(0.0)
                                created = 0
                                processed = 0
                                for ts in ticket_statuses:
                                    if not ts.container_id or ts.gates.get(gate_type, {}).get('exists'):
                                        continue
                                    st.write(f"`{ts.jira_key}` — {_gate_label}")
                                    issue_data = issues_by_key.get(ts.jira_key, {})
                                    ti = _extract_team_info(issue_data.get('fields', {}))
                                    result = create_gate_page(
                                        confluence=confluence, space_key=space_key,
                                        container_id=ts.container_id, jira_key=ts.jira_key, summary=ts.summary,
                                        team=selected_team, version=version, fix_version=selected_fix_version,
                                        server_id=server_id, title_pattern=title_pattern, tag=tag,
                                        gate_type=gate_type, template_config=template_config,
                                        team_info=ti,
                                    )
                                    st.session_state.creation_results.append(result)
                                    if result.action == 'created':
                                        ts.gates[gate_type] = {'exists': True, 'page_id': result.page_id, 'url': result.page_url}
                                        created += 1
                                    processed += 1
                                    _progress.progress(processed / missing)
                                _status.update(label=f"Done — created {created} of {missing} {_gate_label} pages", state="complete", expanded=False)
                                st.rerun()

                    # --- Bulk Recreate: apply current template to all existing gate pages ---
                    st.divider()
                    st.caption("**Recreate** replaces the full page body with the current template. Use after reordering checklist items or making template edits. ⚠️ Overwrites Confluence edits.")
                    br1, br2, br3 = st.columns(3)
                    for _bri, _bgt in enumerate(['ccm', 'cg', 'pg']):
                        with (br1, br2, br3)[_bri]:
                            _bgt_label = GATE_TYPES[_bgt]['label']
                            _bgt_existing = [(ts, ts.gates[_bgt]) for ts in ticket_statuses if ts.gates.get(_bgt, {}).get('exists') and ts.gates[_bgt].get('page_id')]
                            if _bgt_existing and st.button(f"Recreate All {_bgt_label} ({len(_bgt_existing)})", key=f"bulk_recreate_{_bgt}", use_container_width=True):
                              with st.status(f"Recreating {len(_bgt_existing)} {_bgt_label} pages...", expanded=True) as _bstatus:
                                _bprogress = st.progress(0.0)
                                _brc_cfg = st.session_state.get(f'template_config_{_bgt}', get_default_config(_bgt))
                                _bci = _brc_cfg.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
                                if _bci:
                                    _brc_cfg = {**_brc_cfg, 'compliance_items': _bci}
                                _bdone = 0
                                _bsuccess = 0
                                for _bts, _bgi in _bgt_existing:
                                    st.write(f"`{_bts.jira_key}` — {_bgt_label}")
                                    _bfields = issues_by_key.get(_bts.jira_key, {}).get('fields', {})
                                    _bti = _extract_team_info(_bfields)
                                    _bres = recreate_gate_page(
                                        confluence=confluence,
                                        page_id=_bgi['page_id'],
                                        jira_key=_bts.jira_key,
                                        summary=_bts.summary,
                                        team=selected_team,
                                        version=version,
                                        fix_version=selected_fix_version,
                                        server_id=server_id,
                                        gate_type=_bgt,
                                        template_config=_brc_cfg,
                                        team_info=_bti,
                                    )
                                    st.session_state.creation_results.append(_bres)
                                    if _bres.action == 'fixed':
                                        _bsuccess += 1
                                    _bdone += 1
                                    _bprogress.progress(_bdone / len(_bgt_existing))
                                _bstatus.update(label=f"Done — recreated {_bsuccess} of {len(_bgt_existing)} {_bgt_label} pages", state="complete", expanded=False)
                                st.rerun()

                    # --- Bulk Sync: use cached needs_sync flags from scan ---
                    needs_sync_gates = []
                    needs_sync_containers = []
                    for ts in ticket_statuses:
                        if ts.container_id and ts.container_needs_sync:
                            needs_sync_containers.append(ts)
                        for gt in ['ccm', 'cg', 'pg']:
                            gi = ts.gates.get(gt, {})
                            if gi.get('exists') and gi.get('page_id') and gi.get('needs_sync'):
                                needs_sync_gates.append((ts, gt, gi))
                    _total_sync = len(needs_sync_containers) + len(needs_sync_gates)
                    if _total_sync:
                        st.divider()
                        if st.button(f"Sync All Outdated Pages ({_total_sync})", key="bulk_sync", use_container_width=True,
                                     help="Upgrade all existing pages: containers get team & date columns; gates get merged Summary, upgraded tables, missing columns."):
                          with st.status(f"Syncing {_total_sync} pages...", expanded=True) as _status:
                            _progress = st.progress(0.0)
                            synced = 0
                            _done = 0
                            for ts in needs_sync_containers:
                                st.write(f"`{ts.jira_key}` — Container")
                                result = sync_container_content(
                                    confluence=confluence,
                                    page_id=ts.container_id,
                                    jira_key=ts.jira_key,
                                    server_id=server_id,
                                )
                                st.session_state.creation_results.append(result)
                                if result.action == 'fixed':
                                    synced += 1
                                _done += 1
                                _progress.progress(_done / _total_sync)
                            for ts, gt, gi in needs_sync_gates:
                                _gt_label = GATE_TYPES.get(gt, {}).get('label', gt)
                                st.write(f"`{ts.jira_key}` — {_gt_label}")
                                sync_cfg = st.session_state.get(f'template_config_{gt}', get_default_config(gt))
                                result = sync_gate_page_content(
                                    confluence=confluence,
                                    page_id=gi['page_id'],
                                    jira_key=ts.jira_key,
                                    server_id=server_id,
                                    team=selected_team,
                                    version=version,
                                    gate_type=gt,
                                    template_config=sync_cfg,
                                )
                                st.session_state.creation_results.append(result)
                                if result.action == 'fixed':
                                    synced += 1
                                _done += 1
                                _progress.progress(_done / _total_sync)
                            _status.update(label=f"Done — synced {synced} of {_total_sync} pages", state="complete", expanded=False)
                            st.rerun()

        # --- Cleanup: misplaced gate pages and orphan containers (cached from scan) ---
        if ticket_statuses and execution_folder_id:
            misplaced_gates = st.session_state.get('cleanup_misplaced', [])
            orphan_containers = st.session_state.get('cleanup_orphans', [])
            if misplaced_gates or orphan_containers:
                with st.expander("Cleanup (wrong parents, orphans)", expanded=True):
                    st.caption("Pages under Execution that are in the wrong place or not linked to a ticket in this fetch.")
                    if misplaced_gates:
                        st.markdown("**Misplaced gate pages** (directly under Execution; should be under their container)")
                        for item in misplaced_gates:
                            gate_label = GATE_TYPES.get(item.gate_type, {}).get('label', item.gate_type)
                            col_a, col_b = st.columns([3, 1])
                            with col_a:
                                st.markdown(f"**{item.title[:70]}{'…' if len(item.title) > 70 else ''}** — {item.jira_key or '?'} ({gate_label})")
                                if item.page_url:
                                    st.markdown(f"[Open]({item.page_url})")
                            with col_b:
                                if item.container_id and st.button("Move under container", key=f"cleanup_move_{item.page_id}", use_container_width=True):
                                    with st.status(f"Moving `{item.jira_key or '?'}` {gate_label}...", expanded=True) as _status:
                                        result = fix_gate_page(
                                            confluence=confluence,
                                            page_id=item.page_id,
                                            jira_key=item.jira_key or '?',
                                            summary='',
                                            team=selected_team,
                                            version=version,
                                            tag=tag,
                                            gate_type=item.gate_type,
                                            container_id=item.container_id,
                                        )
                                        st.session_state.creation_results.append(result)
                                        _status.update(label=f"Moved `{item.jira_key or '?'}` — {result.details}", state="complete", expanded=False)
                                        st.rerun()
                                elif not item.container_id:
                                    st.caption("No container for this key")
                                if st.button("Check macros", key=f"cleanup_macros_{item.page_id}", use_container_width=True):
                                    missing = validate_page_macro_ids(
                                        confluence, item.page_id, selected_team, version, item.gate_type
                                    )
                                    if missing:
                                        st.warning(f"Missing macro IDs: {', '.join(missing)}")
                                    else:
                                        st.success("Expected macro IDs present")
                    st.caption("To fix missing template lines or macro labels, edit the page in Confluence or re-create the gate page from the accordion below.")
                    if orphan_containers:
                        st.markdown("**Orphan containers** (JIRA key in title but not in this fetch — review manually)")
                        for item in orphan_containers:
                                st.markdown(f"• **{item.jira_key}** — {item.title[:55]}{'…' if len(item.title) > 55 else ''} [Open]({item.page_url})")

        st.divider()
        
        # Dashboard Summary
        st.subheader("📊 Release Dashboard")
        
        # Calculate summary stats
        total_tickets = len(issues)
        containers_needed = sum(1 for ts in ticket_statuses if ts.container_action == 'create')
        containers_exist = sum(1 for ts in ticket_statuses if ts.container_action == 'exists')
        
        gates_missing = {'ccm': 0, 'cg': 0, 'pg': 0}
        gates_sync_needed = {'ccm': 0, 'cg': 0, 'pg': 0}
        gates_complete = {'ccm': 0, 'cg': 0, 'pg': 0}
        
        for ts in ticket_statuses:
            for gate_type in ['ccm', 'cg', 'pg']:
                gate_info = ts.gates.get(gate_type, {})
                if gate_info.get('exists'):
                    if gate_info.get('needs_sync'):
                        gates_sync_needed[gate_type] += 1
                    else:
                        gates_complete[gate_type] += 1
                elif ts.container_id:  # Only count as missing if container exists
                    gates_missing[gate_type] += 1
        
        # Summary cards
        sum_col1, sum_col2, sum_col3, sum_col4 = st.columns(4)
        
        with sum_col1:
            st.metric("📋 Total Tickets", total_tickets)
            if containers_needed > 0:
                st.error(f"🔴 {containers_needed} containers needed")
            else:
                st.success("✅ All containers ready")
                
        with sum_col2:
            ccm_total = gates_complete['ccm'] + gates_sync_needed['ccm'] + gates_missing['ccm']
            st.metric("📝 CCM Pages", f"{gates_complete['ccm']}/{ccm_total}")
            if gates_missing['ccm'] > 0:
                st.error(f"🟠 {gates_missing['ccm']} missing")
            elif gates_sync_needed['ccm'] > 0:
                st.warning(f"🟡 {gates_sync_needed['ccm']} need sync")
            else:
                st.success("✅ All complete")
                
        with sum_col3:
            cg_total = gates_complete['cg'] + gates_sync_needed['cg'] + gates_missing['cg'] 
            st.metric("🛡️ CG Pages", f"{gates_complete['cg']}/{cg_total}")
            if gates_missing['cg'] > 0:
                st.error(f"🟠 {gates_missing['cg']} missing")
            elif gates_sync_needed['cg'] > 0:
                st.warning(f"🟡 {gates_sync_needed['cg']} need sync")
            else:
                st.success("✅ All complete")
                
        with sum_col4:
            pg_total = gates_complete['pg'] + gates_sync_needed['pg'] + gates_missing['pg']
            st.metric("🚀 PG Pages", f"{gates_complete['pg']}/{pg_total}")
            if gates_missing['pg'] > 0:
                st.error(f"🟠 {gates_missing['pg']} missing")
            elif gates_sync_needed['pg'] > 0:
                st.warning(f"🟡 {gates_sync_needed['pg']} need sync")  
            else:
                st.success("✅ All complete")
        
        # Smart Bulk Actions Section
        st.divider()
        st.subheader("⚡ Smart Actions")
        
        # Calculate total actions needed
        total_missing_pages = sum(gates_missing.values())
        total_sync_needed = sum(gates_sync_needed.values())
        
        action_col1, action_col2, action_col3 = st.columns(3)
        
        with action_col1:
            if containers_needed > 0:
                if st.button(f"🏗️ **Create All Containers ({containers_needed})**", 
                            type="primary", use_container_width=True, key="smart_create_containers"):
                    with st.status(f"Creating {containers_needed} containers...", expanded=True) as status:
                        created = 0
                        progress = st.progress(0.0)
                        for i, ts in enumerate(ticket_statuses):
                            if ts.container_action == 'create':
                                issue = next(iss for iss in issues if iss['key'] == ts.jira_key)
                                summary = issue.get('fields', {}).get('summary', '')
                                st.write(f"Creating: {ts.jira_key}")
                                result = create_container_page(
                                    confluence=confluence, space_key=space_key,
                                    execution_folder_id=execution_folder_id,
                                    jira_key=ts.jira_key, summary=summary,
                                    team=selected_team, version=version, server_id=server_id,
                                    title_pattern=title_pattern, tag=tag
                                )
                                if result.action == 'created':
                                    ts.container_action = 'exists'
                                    ts.container_id = result.page_id
                                    ts.container_url = result.page_url
                                    created += 1
                            progress.progress((i + 1) / containers_needed)
                        status.update(label=f"✅ Created {created} containers", state="complete", expanded=False)
                        st.rerun()
            else:
                st.success("✅ All containers exist")
                
        with action_col2:
            if total_missing_pages > 0:
                if st.button(f"📄 **Create Missing Pages ({total_missing_pages})**",
                            type="primary", use_container_width=True, key="smart_create_missing"):
                    with st.status(f"Creating {total_missing_pages} gate pages...", expanded=True) as status:
                        created = 0
                        progress = st.progress(0.0)
                        processed = 0
                        
                        for ts in ticket_statuses:
                            if ts.container_id:  # Only create gates if container exists
                                for gate_type in ['ccm', 'cg', 'pg']:
                                    if not ts.gates.get(gate_type, {}).get('exists'):
                                        st.write(f"Creating: {ts.jira_key} {gate_type.upper()}")
                                        
                                        template_config = st.session_state.get(f'template_config_{gate_type}')
                                        if not template_config:
                                            from src.template_data import get_default_config
                                            template_config = get_default_config(gate_type)
                                            
                                        issue = next(iss for iss in issues if iss['key'] == ts.jira_key)
                                        
                                        result = create_gate_page(
                                            confluence=confluence,
                                            space_key=space_key,
                                            container_id=ts.container_id,
                                            issue=issue,
                                            team=selected_team,
                                            version=version,
                                            server_id=server_id,
                                            title_pattern=title_pattern,
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
                                        processed += 1
                                        progress.progress(processed / total_missing_pages)
                        
                        status.update(label=f"✅ Created {created} gate pages", state="complete", expanded=False)
                        st.rerun()
            else:
                st.success("✅ No missing pages")
                
        with action_col3:
            if total_sync_needed > 0:
                if st.button(f"🔄 **Sync All ({total_sync_needed})**",
                            type="secondary", use_container_width=True, key="smart_sync_all"):
                    with st.status(f"Syncing {total_sync_needed} pages...", expanded=True) as status:
                        synced = 0
                        progress = st.progress(0.0)
                        processed = 0
                        
                        for ts in ticket_statuses:
                            for gate_type in ['ccm', 'cg', 'pg']:
                                gate_info = ts.gates.get(gate_type, {})
                                if gate_info.get('needs_sync') and gate_info.get('page_id'):
                                    st.write(f"Syncing: {ts.jira_key} {gate_type.upper()}")
                                    
                                    template_config = st.session_state.get(f'template_config_{gate_type}')
                                    if not template_config:
                                        from src.template_data import get_default_config
                                        template_config = get_default_config(gate_type)
                                    
                                    try:
                                        sync_gate_page_content(
                                            confluence=confluence,
                                            page_id=gate_info['page_id'],
                                            gate_type=gate_type,
                                            template_config=template_config,
                                            team=selected_team,
                                            version=version,
                                            tag=tag
                                        )
                                        ts.gates[gate_type]['needs_sync'] = False
                                        synced += 1
                                    except Exception as e:
                                        st.error(f"Failed to sync {ts.jira_key} {gate_type}: {e}")
                                    
                                    processed += 1
                                    progress.progress(processed / total_sync_needed)
                        
                        status.update(label=f"✅ Synced {synced} pages", state="complete", expanded=False)
                        st.rerun()
            else:
                st.success("✅ All pages synced")
        
        # Individual Ticket Management (Collapsible)
        st.divider()
        with st.expander("🎯 Individual Ticket Management", expanded=False):
            st.subheader("Individual Tickets")
            with st.expander("What do the status badges mean?", expanded=False):
                st.markdown(
                    "- **🟠 Gate pages missing** — One or more checklist pages (Code Complete, CG Checklist, PG Checklist) are not created yet. Expand the ticket and click **Create** for each missing gate.\n"
                    "- **🟡 Need sync** — Checklist pages exist but the template was updated; click **Sync content** to upgrade them without losing your edits.\n"
                    "- **✅ All pages exist** — Container and all three gate pages are present and up to date.\n"
                    "- **🔴 No container page** — The main Confluence container for this ticket doesn't exist yet; create it first."
                )

            for issue in issues:
                fields = issue.get('fields', {})
                key = issue['key']
            summary = fields.get('summary', 'No summary')
            status = fields.get('status', {}).get('name', 'Unknown')
            issue_type = fields.get('issuetype', {}).get('name', 'Unknown')
            assignee = fields.get('assignee', {})
            assignee_name = assignee.get('displayName', 'Unassigned') if assignee else 'Unassigned'

            # Build status badge for the accordion label
            _ts_badge = ticket_statuses_by_key.get(key)
            if _ts_badge is None or not execution_folder_id:
                _badge = ""
            else:
                _gates_exist = sum(1 for gt in ['ccm', 'cg', 'pg'] if _ts_badge.gates.get(gt, {}).get('exists'))
                _gates_sync = sum(1 for gt in ['ccm', 'cg', 'pg'] if _ts_badge.gates.get(gt, {}).get('needs_sync'))
                _gates_missing = sum(1 for gt in ['ccm', 'cg', 'pg'] if _ts_badge.container_id and not _ts_badge.gates.get(gt, {}).get('exists'))
                _no_container = _ts_badge.container_action == 'create'
                if _no_container:
                    _badge = " 🔴 No container page"
                elif _gates_sync:
                    _sp = "s" if _gates_sync != 1 else ""
                    _badge = f" 🟡 {_gates_sync} gate page{_sp} need sync"
                elif _gates_missing:
                    _sp = "s" if _gates_missing != 1 else ""
                    _badge = f" 🟠 {_gates_missing} gate page{_sp} missing"
                elif _gates_exist == 3:
                    _badge = " ✅ All pages exist"
                else:
                    _badge = ""

            with st.expander(f"**{key}**{_badge} — {summary}", expanded=False):
                col1, col2, col3 = st.columns(3)
                col1.metric("Type", issue_type)
                col2.metric("Status", status)
                col3.metric("Assignee", assignee_name)

                ts = ticket_statuses_by_key.get(key)
                if ts is not None and execution_folder_id:
                    st.markdown("---")
                    # One-line summary so user immediately sees what's missing or needs sync
                    _missing_gates = [GATE_TYPES[gt]['label'] for gt in ['ccm', 'cg', 'pg'] if ts.container_id and not ts.gates.get(gt, {}).get('exists')]
                    _sync_gates = [GATE_TYPES[gt]['label'] for gt in ['ccm', 'cg', 'pg'] if ts.gates.get(gt, {}).get('needs_sync')]
                    if _missing_gates or _sync_gates:
                        _parts = []
                        if _missing_gates:
                            _parts.append(f"**Create:** {', '.join(_missing_gates)}")
                        if _sync_gates:
                            _parts.append(f"**Sync:** {', '.join(_sync_gates)}")
                        st.caption(" → ".join(_parts))
                    _hdr_col, _refresh_col = st.columns([3, 1])
                    with _hdr_col:
                        st.markdown("**Confluence pages**")
                    with _refresh_col:
                        if st.button("Refresh", key=f"refresh_{key}", use_container_width=True,
                                     help="Re-scan this ticket's Confluence pages"):
                            with st.spinner(f"Refreshing {key}..."):
                                updated_ts = rescan_single_ticket(
                                    confluence=confluence,
                                    space_key=space_key,
                                    execution_folder_id=execution_folder_id,
                                    issue=issue,
                                    team=selected_team,
                                    version=version,
                                    title_pattern=title_pattern,
                                )
                                for i, existing_ts in enumerate(st.session_state.ticket_statuses):
                                    if existing_ts.jira_key == key:
                                        st.session_state.ticket_statuses[i] = updated_ts
                                        break
                                st.session_state.pop(f'_linked_pages_{key}', None)
                                st.rerun()
                    c1, c2, c3, c4 = st.columns(4)

                    with c1:
                        st.caption("Container")
                        if ts.container_action == 'exists':
                            st.markdown(f"[View]({ts.container_url})")
                            if ts.container_needs_sync:
                                if st.button("Sync content", key=f"sync_container_{key}",
                                             help="Upgrade container page to include team & date columns in the JIRA macro."):
                                  with st.status(f"Syncing `{key}` container...", expanded=True) as _status:
                                    result = sync_container_content(
                                        confluence=confluence,
                                        page_id=ts.container_id,
                                        jira_key=key,
                                        server_id=server_id,
                                    )
                                    st.session_state.creation_results.append(result)
                                    if result.action == 'fixed':
                                        _status.update(label=f"Synced `{key}` container — {result.details}", state="complete", expanded=False)
                                        ts.container_needs_sync = False
                                        st.rerun()
                                    else:
                                        _status.update(label=f"Container sync failed for `{key}`", state="error", expanded=True)
                                        st.error(result.details)
                        elif ts.container_action == 'fix':
                            issues_text = ', '.join(ts.container_issues)
                            st.markdown(f"[View]({ts.container_url})")
                            st.caption(issues_text)
                            _fix_col, _create_new_col = st.columns(2)
                            with _fix_col:
                                if st.button("Fix", key=f"fix_{key}", use_container_width=True,
                                             help="Fix adds the expected label (tag) so the page is correctly tagged."):
                                  with st.status(f"Fixing `{key}` container...", expanded=True) as _status:
                                    st.write(f"Issues: {issues_text}")
                                    result = fix_container(
                                        confluence=confluence, space_key=space_key,
                                        execution_folder_id=execution_folder_id,
                                        page_id=ts.container_id, jira_key=key,
                                        summary=ts.summary, team=selected_team, version=version,
                                        title_pattern=title_pattern, tag=tag,
                                        detected_issues=ts.container_issues,
                                    )
                                    st.session_state.creation_results.append(result)
                                    if result.action == 'fixed':
                                        _status.update(label=f"Fixed `{key}` — {result.details}", state="complete", expanded=False)
                                        ts.container_action = 'exists'
                                        ts.container_url = result.page_url
                                        ts.container_id = result.page_id
                                        st.rerun()
                                    else:
                                        _status.update(label=f"Fix failed for `{key}`", state="error", expanded=True)
                                        st.error(result.details)
                                        st.caption("Check Confluence permissions and parent page; retry or use Report for links.")
                            with _create_new_col:
                                if st.button("Create new", key=f"create_new_{key}", use_container_width=True,
                                             help="Ignore the detected page and create a fresh container with the correct title."):
                                  with st.status(f"Creating new container for `{key}`...", expanded=True) as _status:
                                    result = create_container_page(
                                        confluence=confluence, space_key=space_key,
                                        execution_folder_id=execution_folder_id,
                                        jira_key=key, summary=ts.summary,
                                        team=selected_team, version=version, server_id=server_id,
                                        title_pattern=title_pattern, tag=tag
                                    )
                                    st.session_state.creation_results.append(result)
                                    if result.action == 'created':
                                        _status.update(label=f"Created new container for `{key}`", state="complete", expanded=False)
                                        ts.container_action = 'exists'
                                        ts.container_id = result.page_id
                                        ts.container_url = result.page_url
                                        ts.container_issues = []
                                        st.rerun()
                                    else:
                                        _status.update(label=f"Failed to create container for `{key}`", state="error", expanded=True)
                                        st.error(result.details)
                                        st.caption("Check Confluence permissions and parent page; retry or use Report for links.")
                            if ts.container_needs_sync:
                                if st.button("Sync content", key=f"sync_container_{key}",
                                             help="Upgrade container page to include team & date columns in the JIRA macro."):
                                  with st.status(f"Syncing `{key}` container...", expanded=True) as _status:
                                    result = sync_container_content(
                                        confluence=confluence,
                                        page_id=ts.container_id,
                                        jira_key=key,
                                        server_id=server_id,
                                    )
                                    st.session_state.creation_results.append(result)
                                    if result.action == 'fixed':
                                        _status.update(label=f"Synced `{key}` container — {result.details}", state="complete", expanded=False)
                                        ts.container_needs_sync = False
                                        st.rerun()
                                    else:
                                        _status.update(label=f"Container sync failed for `{key}`", state="error", expanded=True)
                                        st.error(result.details)
                        elif ts.container_action == 'create':
                            if st.button("Create container", key=f"create_container_{key}"):
                              with st.status(f"Creating container for `{key}`...", expanded=True) as _status:
                                result = create_container_page(
                                    confluence=confluence, space_key=space_key,
                                    execution_folder_id=execution_folder_id,
                                    jira_key=key, summary=ts.summary,
                                    team=selected_team, version=version, server_id=server_id,
                                    title_pattern=title_pattern, tag=tag
                                )
                                st.session_state.creation_results.append(result)
                                if result.action == 'created':
                                    _status.update(label=f"Created container for `{key}`", state="complete", expanded=False)
                                    ts.container_action = 'exists'
                                    ts.container_id = result.page_id
                                    ts.container_url = result.page_url
                                    st.rerun()
                                else:
                                    _status.update(label=f"Failed to create container for `{key}`", state="error", expanded=True)
                                    st.error(result.details)
                                    st.caption("Check Confluence permissions and parent page; retry or use Report for links.")

                    for gate_col_idx, gate_type in enumerate(['ccm', 'cg', 'pg']):
                        with (c2, c3, c4)[gate_col_idx]:
                            gate_label = GATE_TYPES[gate_type]['label']
                            st.caption(gate_label)
                            gate_info = ts.gates.get(gate_type, {})
                            if gate_info.get('exists'):
                                st.markdown(f"[View]({gate_info['url']})")
                                if gate_info.get('needs_sync'):
                                    if st.button(
                                        "Sync content",
                                        key=f"sync_{gate_type}_{key}",
                                        help="Upgrade template content (e.g. merge Key Dates + Team into single Summary, missing Gate Commitments columns). Never removes what you edited in Confluence.",
                                    ):
                                      with st.status(f"Syncing `{key}` {gate_label}...", expanded=True) as _status:
                                        sync_cfg = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
                                        result = sync_gate_page_content(
                                            confluence=confluence,
                                            page_id=gate_info['page_id'],
                                            jira_key=key,
                                            server_id=server_id,
                                            team=selected_team,
                                            version=version,
                                            gate_type=gate_type,
                                            template_config=sync_cfg,
                                        )
                                        st.session_state.creation_results.append(result)
                                        if result.action == 'fixed':
                                            _status.update(label=f"Synced `{key}` {gate_label} — {result.details}", state="complete", expanded=False)
                                            st.rerun()
                                        elif result.action == 'error':
                                            _status.update(label=f"Sync failed for `{key}` {gate_label}", state="error", expanded=True)
                                            st.error(result.details)
                                        else:
                                            _status.update(label=f"`{key}` {gate_label} — {result.details}", state="complete", expanded=False)
                                _recreate_key = f"recreate_{gate_type}_{key}"
                                _confirm_key = f"confirm_recreate_{gate_type}_{key}"
                                if not st.session_state.get(_confirm_key):
                                    if st.button(
                                        "Recreate",
                                        key=_recreate_key,
                                        help="Replace the entire page body with the current template. ⚠️ Overwrites any edits made directly in Confluence.",
                                    ):
                                        st.session_state[_confirm_key] = True
                                        st.rerun()
                                else:
                                    st.warning(f"⚠️ This will overwrite all edits in the {gate_label} page for `{key}`. Are you sure?")
                                    _yes_col, _no_col = st.columns(2)
                                    with _yes_col:
                                        if st.button("Yes, recreate", key=f"{_recreate_key}_yes", type="primary", use_container_width=True):
                                            st.session_state.pop(_confirm_key, None)
                                            with st.status(f"Recreating `{key}` {gate_label}...", expanded=True) as _status:
                                                _rc_cfg = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
                                                _ci = _rc_cfg.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
                                                if _ci:
                                                    _rc_cfg = {**_rc_cfg, 'compliance_items': _ci}
                                                _ti = _extract_team_info(fields)
                                                result = recreate_gate_page(
                                                    confluence=confluence,
                                                    page_id=gate_info['page_id'],
                                                    jira_key=key,
                                                    summary=ts.summary,
                                                    team=selected_team,
                                                    version=version,
                                                    fix_version=selected_fix_version,
                                                    server_id=server_id,
                                                    gate_type=gate_type,
                                                    template_config=_rc_cfg,
                                                    team_info=_ti,
                                                )
                                                st.session_state.creation_results.append(result)
                                                save_report_state(st.session_state.creation_results)
                                                if result.action == 'fixed':
                                                    _status.update(label=f"Recreated `{key}` {gate_label}", state="complete", expanded=False)
                                                    st.rerun()
                                                else:
                                                    _status.update(label=f"Recreate failed for `{key}` {gate_label}", state="error", expanded=True)
                                                    st.error(result.details)
                                    with _no_col:
                                        if st.button("Cancel", key=f"{_recreate_key}_no", use_container_width=True):
                                            st.session_state.pop(_confirm_key, None)
                                            st.rerun()
                            elif ts.container_id:
                                gate_config = st.session_state.get(f'template_config_{gate_type}', get_default_config(gate_type))
                                default_ready = gate_type in ('ccm', 'cg')
                                gate_ready = gate_config.get('ready', default_ready)
                                template_config = gate_config if gate_config.get('gate_type') == gate_type else get_default_config(gate_type)
                                _ci = template_config.get('compliance_checklist_items') or team_cfg.get('compliance_checklist')
                                if _ci:
                                    template_config = {**template_config, 'compliance_items': _ci}
                                if gate_ready:
                                    if st.button("Create", key=f"create_{gate_type}_{key}", help=f"Create {gate_label} page"):
                                      with st.status(f"Creating {gate_label} for `{key}`...", expanded=True) as _status:
                                        ti = _extract_team_info(fields)
                                        result = create_gate_page(
                                            confluence=confluence, space_key=space_key,
                                            container_id=ts.container_id, jira_key=key, summary=ts.summary,
                                            team=selected_team, version=version, fix_version=selected_fix_version,
                                            server_id=server_id, title_pattern=title_pattern, tag=tag,
                                            gate_type=gate_type, template_config=template_config,
                                            team_info=ti,
                                        )
                                        st.session_state.creation_results.append(result)
                                        if result.action == 'created':
                                            _status.update(label=f"Created {gate_label} for `{key}`", state="complete", expanded=False)
                                            ts.gates[gate_type] = {'exists': True, 'page_id': result.page_id, 'url': result.page_url}
                                            st.rerun()
                                        else:
                                            _status.update(label=f"Failed to create {gate_label} for `{key}`", state="error", expanded=True)
                                            st.error(result.details)
                                            st.caption("Check Confluence permissions and parent page; retry or use Report for links.")
                                else:
                                    st.caption("Template not configured")
                            else:
                                st.caption("—")

                    # JIRA-linked Confluence pages: on-demand check + move
                    linked_cache_key = f'_linked_pages_{key}'
                    if st.button("Check linked pages", key=f"check_linked_{key}",
                                 help="Fetch JIRA remote links and show linked Confluence pages."):
                        with st.spinner("Checking linked pages..."):
                            linked_pages = get_linked_confluence_pages(jira, confluence, key)
                            existing_linked = [p for p in linked_pages if p.exists]
                            known_ids = set()
                            if ts.container_id:
                                known_ids.add(str(ts.container_id))
                            for g_info in ts.gates.values():
                                if g_info.get('page_id'):
                                    known_ids.add(str(g_info['page_id']))
                            existing_linked = [p for p in existing_linked if str(p.page_id) not in known_ids]
                            if existing_linked:
                                if ts.container_id:
                                    needs_move = linked_pages_not_under_container(confluence, ts.container_id, existing_linked)
                                    already_under = [p for p in existing_linked if p not in needs_move]
                                else:
                                    needs_move = []
                                    already_under = existing_linked
                                st.session_state[linked_cache_key] = {
                                    'existing': existing_linked,
                                    'needs_move': needs_move,
                                    'already_under': already_under,
                                }
                            else:
                                st.session_state[linked_cache_key] = None
                                st.caption("No linked Confluence pages found.")

                    cached_linked = st.session_state.get(linked_cache_key)
                    if cached_linked:
                        existing_linked = cached_linked['existing']
                        needs_move = cached_linked['needs_move']
                        already_under = cached_linked['already_under']
                        st.markdown("---")
                        st.markdown("**Linked from JIRA**")
                        if already_under:
                            label = "Already under this feature:" if ts.container_id else "Linked Confluence pages:"
                            st.caption(label)
                            for p in already_under:
                                st.markdown(f"• [{p.title}]({p.url})")
                        if needs_move and ts.container_id:
                            st.caption("Not yet under this feature:")
                            for p in needs_move:
                                st.markdown(f"• [{p.title}]({p.url}) (page ID: {p.page_id})")
                                if st.button(f"Move", key=f"move_one_{key}_{p.page_id}", use_container_width=True):
                                  with st.status(f"Moving page under `{key}`...", expanded=True) as _status:
                                    results = move_linked_pages_under_container(
                                        confluence=confluence,
                                        linked=[p],
                                        container_id=ts.container_id,
                                        jira_key=key,
                                    )
                                    for r in results:
                                        st.session_state.creation_results.append(r)
                                    _status.update(label=f"Moved page under `{key}`", state="complete", expanded=False)
                                    st.session_state.pop(linked_cache_key, None)
                                    st.rerun()
                            if len(needs_move) > 1:
                                if st.button("Move all under this feature", key=f"move_all_{key}", use_container_width=True):
                                  _move_total = len(needs_move)
                                  with st.status(f"Moving {_move_total} pages under `{key}`...", expanded=True) as _status:
                                    results = move_linked_pages_under_container(
                                        confluence=confluence,
                                        linked=needs_move,
                                        container_id=ts.container_id,
                                        jira_key=key,
                                    )
                                    for r in results:
                                        st.session_state.creation_results.append(r)
                                    _moved = sum(1 for r in results if r.action == 'fixed')
                                    _status.update(label=f"Done — moved {_moved} of {_move_total} pages under `{key}`", state="complete", expanded=False)
                                    st.session_state.pop(linked_cache_key, None)
                                    st.rerun()

        if not ticket_statuses and st.session_state.get('folder_info'):
            st.info("Click **Load Release** to scan Confluence for existing pages.")

        if st.session_state.get('creation_results'):
            save_report_state(st.session_state.creation_results)
            st.info("Navigate to **Report** in the sidebar for the full report with links and CSV export.")
