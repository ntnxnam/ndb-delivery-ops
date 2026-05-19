import time
import streamlit as st
from src.template_data import (
    get_default_config,
    GATE_TYPES,
    EVIDENCE_TYPES,
    EVIDENCE_TYPE_IDS,
)
from src.utils import load_template_overrides, save_template_overrides, get_template_saved_at, _deep_merge

st.set_page_config(page_title="Template Editor", page_icon="📝", layout="wide")

# Import authentication components
from src.header import render_header, check_authentication

# Render header and check authentication
render_header()
if not check_authentication():
    st.stop()

_title_col, _saved_col = st.columns([0.7, 0.3])
with _title_col:
    st.title("Template Editor")
with _saved_col:
    _saved_ts = get_template_saved_at()
    if _saved_ts:
        _saved_dt = time.strftime('%d %b %Y, %H:%M', time.localtime(_saved_ts))
        st.caption(f"Last saved: **{_saved_dt}**")
    else:
        st.caption("Not yet saved")

# Load persisted overrides into session when not already in session (e.g. after refresh)
overrides = load_template_overrides()
for gate_type in GATE_TYPES:
    config_key = f'template_config_{gate_type}'
    if config_key not in st.session_state:
        default = get_default_config(gate_type)
        st.session_state[config_key] = _deep_merge(default, overrides.get(gate_type, {})) if overrides else default


def _renumber_items(groups: list):
    """Re-assign sequential numeric IDs after add/remove. Preserve prefix-based IDs (e.g. D1, Q1, G1)."""
    counter = 0
    for grp in groups:
        for item in grp.get('items', []):
            current_id = item.get('id', '')
            if isinstance(current_id, str) and current_id.isdigit():
                counter += 1
                item['id'] = str(counter)


def _render_field_picker(item_key: str, ev_config: dict, custom_fields: list) -> tuple[str, str]:
    """Render a searchable multiselect for JIRA custom fields.

    Returns (columns_csv, column_ids_csv).
    """
    field_map = {f['id']: f for f in custom_fields}
    display = {f['id']: f"{f['name']} ({f['id']})" for f in custom_fields}

    current_ids = [x.strip() for x in ev_config.get('column_ids', '').split(',') if x.strip()]

    selected = st.multiselect(
        "Select columns",
        options=[f['id'] for f in custom_fields],
        default=[fid for fid in current_ids if fid in field_map],
        format_func=lambda x: display.get(x, x),
        key=f"{item_key}_field_select",
        help="Type to search by field name or ID"
    )

    cols_csv = ','.join(field_map[fid]['name'] for fid in selected if fid in field_map)
    ids_csv = ','.join(selected)
    return cols_csv, ids_csv


# --- Custom fields from session ---
custom_fields = st.session_state.get('custom_fields', [])
if not custom_fields:
    st.sidebar.info("Custom fields not loaded. Re-connect on the Login page to load them.")

# --- Gate Type Tabs ---
gate_tabs = st.tabs([GATE_TYPES[g]['label'] for g in GATE_TYPES])

for tab_idx, (gate_type, gate_info) in enumerate(GATE_TYPES.items()):
    config_key = f'template_config_{gate_type}'
    if config_key not in st.session_state:
        st.session_state[config_key] = get_default_config(gate_type)

    with gate_tabs[tab_idx]:
        config = st.session_state[config_key]

        # Quick-save bar at the top of each tab
        _top_save_col, _top_desc_col = st.columns([0.15, 0.85])
        with _top_save_col:
            if st.button("💾 Save", key=f"{gate_type}_save_top", use_container_width=True, help="Save template configuration"):
                st.session_state[config_key] = config
                save_template_overrides({
                    'ccm': st.session_state.get('template_config_ccm', get_default_config('ccm')),
                    'cg': st.session_state.get('template_config_cg', get_default_config('cg')),
                    'pg': st.session_state.get('template_config_pg', get_default_config('pg')),
                })
                st.session_state.template_saved_this_run = True
                st.rerun()
        with _top_desc_col:
            st.markdown(f"**{config.get('template_description', '')}**")
        ready = st.checkbox(
            "Template ready for use",
            value=config.get('ready', False),
            key=f"{gate_type}_ready",
            help="Enable this to show the Create button for this gate type on Team & Release."
        )
        config['ready'] = ready
        st.divider()

        # --- Section Toggles ---
        st.subheader("Page Sections")
        sections = config.get('sections', [])

        for i, section in enumerate(sections):
            col1, col2 = st.columns([0.12, 0.88])
            with col1:
                enabled = st.checkbox(
                    "On",
                    value=section.get('enabled', True),
                    key=f"{gate_type}_sec_{section['id']}"
                )
                config['sections'][i]['enabled'] = enabled
            with col2:
                icon = "✅" if enabled else "❌"
                st.markdown(f"**{icon} {section['title']}**")
                if section.get('id') == 'gate_commitments' and enabled and gate_type == 'cg':
                    st.caption(
                        "Tip: In the Gate Commitments table, only set \"CG Met as on Planned Date?\" or \"Will we meet PG on time?\" "
                        "to **Yes** after the planned date has passed. Otherwise use **TBD** so you don’t imply "
                        "a future date is already met."
                    )
                if section.get('id') == 'gate_commitments' and enabled:
                    from src.template_engine import DEFAULT_COMPLIANCE_ITEMS
                    compliance_key = 'compliance_checklist_items'
                    current_items = config.get(compliance_key, list(DEFAULT_COMPLIANCE_ITEMS))
                    with st.expander("Legal, Compliance Checklist Items", expanded=False):
                        st.caption("These checkbox items appear in the 'Legal, Compliance Checklist' column of the Gate Commitments table.")
                        updated_items = []
                        for ci_idx, ci_val in enumerate(current_items):
                            cc1, cc2 = st.columns([0.9, 0.1])
                            with cc1:
                                new_val = st.text_input("Item", value=ci_val, key=f"{gate_type}_compliance_{ci_idx}", label_visibility="collapsed")
                                updated_items.append(new_val)
                            with cc2:
                                if st.button("\U0001F5D1", key=f"{gate_type}_compliance_del_{ci_idx}", help="Remove"):
                                    current_items.pop(ci_idx)
                                    config[compliance_key] = current_items
                                    st.rerun()
                        config[compliance_key] = updated_items
                        if st.button("\u2795 Add compliance item", key=f"{gate_type}_compliance_add", use_container_width=True):
                            current_items.append("New item")
                            config[compliance_key] = current_items
                            st.rerun()
                if section.get('id') in ('supportability_text', 'supportability_checklist') and gate_type != 'cg':
                    st.caption(
                        "This section is **CG-only**. It is not rendered on Code Complete (CCM) or PG pages."
                    )
                elif section.get('id') in ('supportability_text', 'supportability_checklist') and enabled and gate_type == 'cg':
                    st.caption(
                        "Commit Gate supportability requirements. Not used on Code Complete or PG checklists."
                    )

        st.divider()

        # --- Checklist Items (for sections that have groups) ---
        checklist_section = next(
            (s for s in sections if s.get('groups') and s.get('enabled', True)), None
        )

        if checklist_section:
            checklist_idx = next(i for i, s in enumerate(sections) if s is checklist_section)
            st.subheader(f"{checklist_section['title']} Items")

            groups = checklist_section.get('groups', [])
            for g_idx, group in enumerate(groups):
                group_title = group.get('title')
                if group_title:
                    st.markdown(f"#### {group_title}")
                else:
                    st.markdown("#### Pre-requisites")

                for item_idx, item in enumerate(items := group.get('items', [])):
                    item_key = f"{gate_type}_g{group['id']}_{item['id']}"
                    col_up, col_down, col_exp, col_del = st.columns([0.03, 0.03, 0.89, 0.05])
                    with col_up:
                        st.markdown("<div style='margin-top: 0.3rem'></div>", unsafe_allow_html=True)
                        if item_idx > 0:
                            if st.button("▲", key=f"{item_key}_up", help="Move up"):
                                grp_items = config['sections'][checklist_idx]['groups'][g_idx]['items']
                                grp_items[item_idx], grp_items[item_idx - 1] = grp_items[item_idx - 1], grp_items[item_idx]
                                _renumber_items(config['sections'][checklist_idx]['groups'])
                                st.rerun()
                    with col_down:
                        st.markdown("<div style='margin-top: 0.3rem'></div>", unsafe_allow_html=True)
                        if item_idx < len(items) - 1:
                            if st.button("▼", key=f"{item_key}_down", help="Move down"):
                                grp_items = config['sections'][checklist_idx]['groups'][g_idx]['items']
                                grp_items[item_idx], grp_items[item_idx + 1] = grp_items[item_idx + 1], grp_items[item_idx]
                                _renumber_items(config['sections'][checklist_idx]['groups'])
                                st.rerun()
                    with col_exp:
                        with st.expander(f"**{item['id']}. {item['label']}**", expanded=False):
                            col_on, col_label, col_approver = st.columns([0.08, 0.52, 0.4])

                            with col_on:
                                item_enabled = st.checkbox(
                                    "On",
                                    value=item.get('enabled', True),
                                    key=f"{item_key}_on"
                                )
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['enabled'] = item_enabled

                            with col_label:
                                new_label = st.text_input(
                                    "Label",
                                    value=item['label'],
                                    key=f"{item_key}_label"
                                )
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['label'] = new_label

                            with col_approver:
                                approver = st.text_input(
                                    "Approver",
                                    value=item.get('approver', ''),
                                    key=f"{item_key}_approver"
                                )
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['approver'] = approver

                            current_ev = item.get('evidence_type', 'none')
                            ev_options = EVIDENCE_TYPE_IDS
                            ev_labels = {e['id']: e['label'] for e in EVIDENCE_TYPES}

                            new_ev_type = st.selectbox(
                                "Evidence Type",
                                ev_options,
                                index=ev_options.index(current_ev) if current_ev in ev_options else 0,
                                format_func=lambda x: ev_labels.get(x, x),
                                key=f"{item_key}_evtype"
                            )
                            config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_type'] = new_ev_type

                            if new_ev_type != current_ev:
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_config'] = {}

                            ev_config = config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx].get('evidence_config', {})

                            if new_ev_type == 'jql_count':
                                val = st.text_input(
                                    "JQL Suffix (appended to portfolio query)",
                                    value=ev_config.get('jql_suffix', ''),
                                    key=f"{item_key}_jqlsuffix"
                                )
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_config']['jql_suffix'] = val

                            elif new_ev_type == 'jql_table':
                                jql_val = st.text_input(
                                    "JQL Query (use {{JIRA_KEY}} as placeholder)",
                                    value=ev_config.get('jql', ''),
                                    key=f"{item_key}_jql"
                                )
                                if custom_fields:
                                    cols_val, ids_val = _render_field_picker(item_key, ev_config, custom_fields)
                                else:
                                    cols_val = st.text_input(
                                        "Column display names (comma-separated)",
                                        value=ev_config.get('columns', ''),
                                        key=f"{item_key}_cols"
                                    )
                                    ids_val = st.text_input(
                                        "Column field IDs (comma-separated)",
                                        value=ev_config.get('column_ids', ''),
                                        key=f"{item_key}_colids"
                                    )
                                cfg = config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_config']
                                cfg['jql'] = jql_val
                                cfg['columns'] = cols_val
                                cfg['column_ids'] = ids_val

                            elif new_ev_type == 'field_value':
                                if custom_fields:
                                    field_map = {f['id']: f for f in custom_fields}
                                    display = {f['id']: f"{f['name']} ({f['id']})" for f in custom_fields}
                                    current_fid = ev_config.get('field_id', '')
                                    all_ids = [f['id'] for f in custom_fields]
                                    default_idx = all_ids.index(current_fid) if current_fid in all_ids else None

                                    selected_field = st.selectbox(
                                        "JIRA Field",
                                        options=all_ids,
                                        index=default_idx,
                                        format_func=lambda x: display.get(x, x),
                                        key=f"{item_key}_fieldval",
                                        placeholder="Search for a field..."
                                    )
                                    if selected_field:
                                        ev_config['field_id'] = selected_field
                                        ev_config['field_name'] = field_map[selected_field]['name']
                                else:
                                    fid = st.text_input(
                                        "JIRA Field ID (e.g. customfield_14463)",
                                        value=ev_config.get('field_id', ''),
                                        key=f"{item_key}_fieldval_id"
                                    )
                                    fname = st.text_input(
                                        "Field Display Name",
                                        value=ev_config.get('field_name', ''),
                                        key=f"{item_key}_fieldval_name"
                                    )
                                    ev_config['field_id'] = fid
                                    ev_config['field_name'] = fname
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_config'] = ev_config

                            elif new_ev_type == 'text':
                                val = st.text_input(
                                    "Evidence Text / Link placeholder",
                                    value=ev_config.get('text', ''),
                                    key=f"{item_key}_text"
                                )
                                config['sections'][checklist_idx]['groups'][g_idx]['items'][item_idx]['evidence_config']['text'] = val

                    with col_del:
                        st.markdown("<div style='margin-top: 0.3rem'></div>", unsafe_allow_html=True)
                        if st.button("🗑", key=f"{item_key}_del", help="Remove this item"):
                            config['sections'][checklist_idx]['groups'][g_idx]['items'].pop(item_idx)
                            _renumber_items(config['sections'][checklist_idx]['groups'])
                            st.rerun()

                if st.button("➕ Add Item", key=f"{gate_type}_g{group['id']}_add", use_container_width=True):
                    all_ids = [
                        int(it['id']) for grp in groups for it in grp.get('items', [])
                        if it['id'].isdigit()
                    ]
                    next_id = str(max(all_ids) + 1) if all_ids else "1"
                    config['sections'][checklist_idx]['groups'][g_idx]['items'].append({
                        "id": next_id,
                        "label": "New checklist item",
                        "approver": "",
                        "evidence_type": "none",
                        "evidence_config": {},
                        "enabled": True
                    })
                    st.rerun()

            st.divider()

        # --- Supportability Items (CG only) ---
        supp_section = next(
            (s for s in sections if s['id'] == 'supportability_checklist' and s.get('enabled', True)),
            None
        )
        if supp_section:
            supp_idx = next(i for i, s in enumerate(sections) if s['id'] == 'supportability_checklist')
            st.subheader("Supportability Checklist Items")

            for item_idx, item in enumerate(supp_section.get('items', [])):
                col1, col2 = st.columns([0.08, 0.92])
                with col1:
                    on = st.checkbox(
                        "On",
                        value=item.get('enabled', True),
                        key=f"{gate_type}_supp_{item['id']}_on"
                    )
                    config['sections'][supp_idx]['items'][item_idx]['enabled'] = on
                with col2:
                    icon = "✅" if on else "❌"
                    st.markdown(f"{icon} **{item['id']}.** {item['label']}")

            st.divider()

        # --- Actions ---
        col_reset, col_save = st.columns(2)
        with col_reset:
            if st.button("Reset to Default", key=f"{gate_type}_reset", use_container_width=True):
                st.session_state[config_key] = get_default_config(gate_type)
                st.rerun()
        with col_save:
            if st.button("Save", type="primary", key=f"{gate_type}_save", use_container_width=True):
                st.session_state[config_key] = config
                save_template_overrides({
                    'ccm': st.session_state.get('template_config_ccm', get_default_config('ccm')),
                    'cg': st.session_state.get('template_config_cg', get_default_config('cg')),
                    'pg': st.session_state.get('template_config_pg', get_default_config('pg')),
                })
                st.session_state.template_saved_this_run = True
                st.rerun()
        st.caption("Saved to config. Use **Team & Release** to create pages.")
        st.session_state[config_key] = config

if st.session_state.get('template_saved_this_run'):
    st.success("Template configurations saved to config. Navigate to **Team & Release** to select version and fetch tickets.")
    st.session_state.template_saved_this_run = False
