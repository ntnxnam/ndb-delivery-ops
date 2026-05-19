"""Generates Confluence Storage Format XHTML from structured template config.

Builds each section of the gate checklist page programmatically,
replacing placeholders with actual JIRA keys and version info.
Supports CCM, CG, and PG gate types.
"""

import html
from src.utils import portfolio_jql, portfolio_jql_in, version_no_dots


def _x(s) -> str:
    """Escape for Confluence storage (XHTML): & < > \" so the parser does not break."""
    if s is None:
        return ''
    return html.escape(str(s), quote=True)


def _x_content(s) -> str:
    """Escape for XML element content only: & < > (no quote). Use for JQL etc. where quotes must stay."""
    if s is None:
        return ''
    return html.escape(str(s), quote=False)

_CONFLUENCE_COLORS = {
    '#4c9aff': 'blue',
    '#2684ff': 'blue',
    '#00875a': 'green',
    '#ff991f': 'yellow',
    '#de350b': 'red',
    '#6554c0': 'purple',
    '#ff5630': 'red',
    '#36b37e': 'green',
    '#0052cc': 'blue',
    '#172b4d': 'grey',
}


def _hex_to_confluence_color(hex_color: str) -> str:
    return _CONFLUENCE_COLORS.get(hex_color, 'blue')


def _macro_id(team: str, version: str, suffix: str) -> str:
    """Normalized macro ID: lowercase, no dots, consistent with tag format."""
    return f'{team.lower()}-{version_no_dots(version)}-{suffix}'


def get_expected_macro_ids(team: str, version: str, gate_type: str) -> list:
    """Return expected macro IDs (details/table-excerpt) for a gate page. Used for content validation."""
    ids = [_macro_id(team, version, f'{gate_type}-checklist')]
    if gate_type == 'cg':
        ids.extend([
            _macro_id(team, version, 'cg-text-summary'),
            _macro_id(team, version, 'cg-serv-checklist'),
        ])
    return ids


def _status_macros():
    """YES / NO / NA status macro group — compact; order YES first so red NO is not the first/default impression."""
    return (
        _status_macro('Green', 'YES') + '<br/>'
        + _status_macro('Red', 'No') + '<br/>'
        + _status_macro('Grey', 'NA')
    )


def _status_macro(colour, title):
    return (
        f'<ac:structured-macro ac:name="status" ac:schema-version="1">'
        f'<ac:parameter ac:name="subtle">true</ac:parameter>'
        f'<ac:parameter ac:name="colour">{colour}</ac:parameter>'
        f'<ac:parameter ac:name="title">{title}</ac:parameter>'
        f'</ac:structured-macro>'
    )


def _jira_key_macro(key, server_id, column_ids=None, columns=None):
    parts = [
        '<ac:structured-macro ac:name="jira" ac:schema-version="1">',
        '<ac:parameter ac:name="server">Jira</ac:parameter>',
    ]
    if column_ids:
        parts.append(f'<ac:parameter ac:name="columnIds">{_x(column_ids)}</ac:parameter>')
    if columns:
        parts.append(f'<ac:parameter ac:name="columns">{_x(columns)}</ac:parameter>')
    parts.append(f'<ac:parameter ac:name="serverId">{_x(server_id)}</ac:parameter>')
    parts.append(f'<ac:parameter ac:name="key">{_x(key)}</ac:parameter>')
    parts.append('</ac:structured-macro>')
    return ''.join(parts)


def _jira_jql_macro(jql, server_id, columns=None, column_ids=None,
                    count=False, max_issues=None):
    parts = [
        '<ac:structured-macro ac:name="jira" ac:schema-version="1">',
        '<ac:parameter ac:name="server">Jira</ac:parameter>',
    ]
    if column_ids:
        parts.append(f'<ac:parameter ac:name="columnIds">{_x(column_ids)}</ac:parameter>')
    if columns:
        parts.append(f'<ac:parameter ac:name="columns">{_x(columns)}</ac:parameter>')
    if max_issues:
        parts.append(f'<ac:parameter ac:name="maximumIssues">{_x(max_issues)}</ac:parameter>')
    parts.append(f'<ac:parameter ac:name="jqlQuery">{_x_content(jql)}</ac:parameter>')
    if count:
        parts.append('<ac:parameter ac:name="count">true</ac:parameter>')
    parts.append(f'<ac:parameter ac:name="serverId">{_x(server_id)}</ac:parameter>')
    parts.append('</ac:structured-macro>')
    return ''.join(parts)


def _render_legend():
    return (
        '<p>Legend:</p>'
        '<p>'
        + _status_macro('Green', 'YES') + ' '
        + _status_macro('Red', 'No') + ' '
        + _status_macro('Grey', 'NA')
        + '</p>'
    )


def _render_ccm_process_note(jira_key: str, server_id: str, summary: str = '') -> str:
    """Render CCM process note: [CCM] FEAT-xxx: <Feature Name> and info block (Timing, Goal, Next Step)."""
    title_line = f'[CCM] {_x(jira_key)}: {_x(summary)}' if summary else f'[CCM] {_x(jira_key)}'
    return (
        f'<p><strong>{title_line}</strong></p>'
        '<ac:structured-macro ac:name="info">'
        '<ac:parameter ac:name="title">Process Note</ac:parameter>'
        '<ac:rich-text-body>'
        '<p>This is the <strong>Code Complete Met (CCM)</strong> soft gate.</p>'
        '<ul>'
        '<li><strong>Timing:</strong> T-4 Weeks to Commit Gate (CG).</li>'
        '<li><strong>Goal:</strong> Confirm Development is 100% done and handed off to QA.</li>'
        '<li><strong>Next Step:</strong> Once MET, move to Phase 5 (Manual Testing).</li>'
        '</ul>'
        '</ac:rich-text-body>'
        '</ac:structured-macro>'
    )


def _render_ccm_gate_tracking(section_title: str = 'Gate Tracking') -> str:
    """Render CCM Gate Tracking table: Role | Owner | Milestone | Date | Status (current snapshot vs target)."""
    return (
        f'<h1>{section_title}</h1>'
        '<p>Current snapshot vs. Target Dates.</p>'
        '<table class="wrapped">'
        '<colgroup><col/><col/><col/><col/><col/></colgroup>'
        '<thead><tr>'
        '<th>Role</th><th>Owner</th><th>Milestone</th><th>Date</th><th>Status</th>'
        '</tr></thead><tbody>'
        '<tr><td>FEAT Manager</td><td>@Mention Name</td><td>Code Complete Target</td><td>2026-xx-xx</td><td><strong>MET</strong></td></tr>'
        '<tr><td>Dev Lead</td><td>@Mention Name</td><td>Code Merge Date</td><td>2026-xx-xx</td><td><strong>DONE</strong></td></tr>'
        '<tr><td>QA Lead</td><td>@Mention Name</td><td>QA Handoff Date</td><td>2026-xx-xx</td><td><strong>READY</strong></td></tr>'
        '</tbody></table>'
    )


def _render_ccm_signoff() -> str:
    """Render CCM Sign-Off section: logic and Final Status (CODE COMPLETE MET / CONDITIONAL / MISSED)."""
    return (
        '<h1>CCM Sign-Off</h1>'
        '<p>Is this feature ready for full QA execution?</p>'
        '<p><strong>Logic:</strong></p>'
        '<ul>'
        '<li>If D1–D5 are YES → Code is ready.</li>'
        '<li>If Q1 is YES → QA is ready.</li>'
        '<li>If G1–G4 are YES → Release Prep has started.</li>'
        '</ul>'
        '<p><strong>Final Status:</strong> <strong>CODE COMPLETE MET</strong> / <strong>CONDITIONAL</strong> / <strong>MISSED</strong></p>'
    )


TEAM_TABLE_COLUMNS = [
    {'field_id': 'assignee', 'display': 'Dev Lead'},
    {'field_id': 'customfield_11065', 'display': 'QA Lead'},
    {'field_id': 'customfield_27764', 'display': 'TPM'},
    {'field_id': 'reporter', 'display': 'Product Manager'},
    {'field_id': 'customfield_23461', 'display': 'System Test Lead'},
    {'field_id': 'components', 'display': 'Dev Team'},
]


def _render_team_table(section_title='Summary', jira_key: str = '',
                       server_id: str = '', team_info: dict | None = None):
    """Render team table as a JIRA macro that dynamically fetches fields.

    Falls back to a static HTML table if jira_key/server_id are not provided.
    Legacy: used by CCM Gate Tracking and sync upgrade path.
    """
    if jira_key and server_id:
        column_ids = ','.join(c['field_id'] for c in TEAM_TABLE_COLUMNS)
        column_names = ','.join(c['display'] for c in TEAM_TABLE_COLUMNS)
        return (
            f'<h1>{section_title}</h1>'
            '<h2>Team</h2>'
            '<p>'
            + _jira_key_macro(jira_key, server_id,
                              column_ids=column_ids, columns=column_names)
            + '</p>'
        )

    if team_info is None:
        team_info = {}
    not_provided = '<td><em>Not provided</em></td>'
    cells = ''.join(
        f'<td>{_x(team_info[r])}</td>' if team_info.get(r) else not_provided
        for r in [c['display'] for c in TEAM_TABLE_COLUMNS]
    )
    headers = ''.join(f'<th scope="col">{_x(c["display"])}</th>' for c in TEAM_TABLE_COLUMNS)
    return (
        f'<h1>{section_title}</h1>'
        '<h2>Team</h2>'
        '<table class="wrapped">'
        f'<colgroup>{"<col/>" * len(TEAM_TABLE_COLUMNS)}</colgroup>'
        '<tbody>'
        f'<tr>{headers}</tr>'
        f'<tr>{cells}</tr>'
        '</tbody>'
        '</table>'
    )


def _render_summary(jira_key, server_id, config_section):
    """Render merged Summary section: Team + Key Dates in a single JIRA table macro.

    Uses a JQL query (key = FEAT-XXX) so Confluence renders a full table
    with all columns visible, rather than the compact single-issue link
    that the key-based macro produces.
    """
    section_title = config_section.get('title', 'Summary')
    date_cols = config_section.get('date_columns', [])

    team_ids = [c['field_id'] for c in TEAM_TABLE_COLUMNS]
    team_names = [c['display'] for c in TEAM_TABLE_COLUMNS]

    date_ids = [c['field_id'] for c in date_cols]
    date_names = [c['display'] for c in date_cols]

    all_ids = team_ids + date_ids
    all_names = team_names + date_names

    column_ids = ','.join(all_ids)
    column_names = ','.join(all_names)

    return (
        f'<h1>{_x(section_title)}</h1>'
        '<p>'
        + _jira_jql_macro(
            f'key = {jira_key}', server_id,
            column_ids=column_ids, columns=column_names,
            max_issues=1)
        + '</p>'
    )


def _render_key_dates(jira_key, server_id, config_section):
    """Legacy: render standalone Key Dates section. Kept for backward compatibility."""
    cols = config_section.get('columns', [])
    column_ids = ','.join(c['field_id'] for c in cols)
    column_names = ','.join(c['display'] for c in cols)

    return (
        '<h1>Key Dates</h1>'
        '<p>'
        + _jira_key_macro(jira_key, server_id, column_ids=column_ids, columns=column_names)
        + '</p>'
    )


# Gate Commitments table: canonical column headers (for sync). Order must match _render_gate_commitments.
# Policy: sync only ADDS missing content; never overwrite or remove. If omission is needed, user does it in Confluence.
GATE_COMMITMENTS_HEADERS = (
    'FEAT Number',
    'Planned Code Complete Date',
    'Code Complete Met on Time?',
    'Planned CG Date',
    'CG Review Date',
    'CG Met as on Planned Date?',
    'Short reason',
    'Date that we will meet CG on',
    'Legal, Compliance Checklist',
    'Planned PG Date',
    'PG Met as on Planned PG Date?',
    'Path To Green',
    'Will we meet PG on time?',
)


DEFAULT_COMPLIANCE_ITEMS = [
    "Legal review",
    "SDL Review",
    "SDL | Pentest",
    "SDL | Tools (Ticket created)",
    "Serviceability",
]


def _build_compliance_cell(items: list[str] | None = None) -> str:
    """Build the Legal, Compliance Checklist <td> with configurable task items."""
    if not items:
        items = DEFAULT_COMPLIANCE_ITEMS
    tasks = ''.join(
        f'<ac:task><ac:task-status>incomplete</ac:task-status>'
        f'<ac:task-body>{_x(item)}</ac:task-body></ac:task>'
        for item in items
    )
    return (
        '<td><div class="content-wrapper">'
        f'<ac:task-list>{tasks}</ac:task-list>'
        '</div></td>'
    )


def _gate_commitments_default_cells(compliance_items: list[str] | None = None):
    """Default cell HTML for Gate Commitments data row (columns 1..12 after FEAT). Returns tuple of 12 strings for reuse in sync."""
    empty = '<td><br/></td>'
    tbd = '<td>' + _status_macro("Grey", "TBD") + '</td>'
    legal_cell = _build_compliance_cell(compliance_items)
    return (
        empty,   # Planned Code Complete Date
        tbd,     # Code Complete Met on Time?
        empty,   # Planned CG Date
        empty,   # CG Review Date
        tbd,     # CG Met as on Planned Date?
        empty,   # Short reason
        empty,   # Date that we will meet CG on
        legal_cell,  # Legal, Compliance Checklist
        empty,   # Planned PG Date
        tbd,     # PG Met as on Planned PG Date?
        empty,   # Path To Green
        tbd,     # Will we meet PG on time?
    )


def get_gate_commitments_default_cell_for_column(col_index: int) -> str:
    """Return default <td>...</td> for column col_index (0-based; 0 = first column after FEAT). For sync: append-only, never overwrite."""
    cells = _gate_commitments_default_cells()
    if 0 <= col_index < len(cells):
        return cells[col_index]
    return '<td><br/></td>'


def get_gate_commitments_block(jira_key: str, server_id: str, team: str, version: str,
                               compliance_items: list[str] | None = None) -> str:
    """Return full Gate Commitments section HTML (for inserting when block is missing). Used by sync; never overwrites existing content."""
    return _render_gate_commitments(jira_key, server_id, team, version, compliance_items=compliance_items)


def _render_gate_commitments(jira_key, server_id, team, version, compliance_items=None):
    mid = _macro_id(team, version, 'cg-text-summary')
    ncols = len(GATE_COMMITMENTS_HEADERS)
    colgroup = ''.join(['<col/>'] * ncols)
    headers_row = ''.join(f'<th>{_x(h)}</th>' for h in GATE_COMMITMENTS_HEADERS)
    default_cells = _gate_commitments_default_cells(compliance_items)
    return (
        '<h1>Gate Commitments</h1>'
        f'<ac:structured-macro ac:name="details" ac:schema-version="1">'
        f'<ac:parameter ac:name="id">{_x(mid)}</ac:parameter>'
        '<ac:rich-text-body>'
        '<table class="wrapped">'
        f'<colgroup>{colgroup}</colgroup>'
        '<tbody>'
        '<tr>'
        f'{headers_row}'
        '</tr>'
        '<tr>'
        '<td><div class="content-wrapper"><p>'
        + _jira_key_macro(jira_key, server_id,
                          column_ids='issuekey,summary,issuetype,created,updated,duedate,assignee,reporter,priority,status,resolution',
                          columns='key,summary,type,created,updated,due,assignee,reporter,priority,status,resolution')
        + '</p></div></td>'
        + ''.join(default_cells)
        + '</tr>'
        '</tbody></table>'
        '</ac:rich-text-body>'
        '</ac:structured-macro>'
    )


def validate_gate_commitments_consistency(html_fragment: str) -> list[str]:
    """Detect logical errors: 'Met = Yes' or 'PG on time = Yes' when dates are empty or in future.

    Only set Met = Yes / PG on time = Yes after the planned date has passed; otherwise use TBD or No.
    Returns a list of warning messages.
    """
    import re
    warnings = []
    # Confluence status macro: colour Green + title Yes (case-insensitive)
    green_yes = re.compile(
        r'<ac:parameter ac:name="colour">Green</ac:parameter>\s*'
        r'<ac:parameter ac:name="title">Yes</ac:parameter>',
        re.IGNORECASE | re.DOTALL
    )
    # Empty date cell: <td><br/></td> or <td></td>
    empty_td = re.compile(r'<td>\s*(?:<br\s*/?>)?\s*</td>')
    # Heuristic: if we see Green/Yes for Met columns and nearby we have empty <td>s for dates, flag it.
    if green_yes.search(html_fragment):
        empty_count = len(empty_td.findall(html_fragment))
        if empty_count >= 2:
            warnings.append(
                "Gate Commitments: 'CG Met as on Planned Date?' or 'Will we meet PG on time?' is set to Yes while "
                "planned dates are empty. Only set Met = Yes after the planned date has passed; otherwise use TBD or No."
            )
    return warnings


def _render_checklist_evidence(item, jira_key, server_id, fix_version):
    """Render the evidence cell for a checklist item."""
    ev_type = item.get('evidence_type', 'none')
    ev_config = item.get('evidence_config', {})

    if ev_type == 'none':
        return '<div class="content-wrapper"><br/></div>'

    if ev_type == 'jql_table':
        jql = ev_config.get('jql', '').replace('{{JIRA_KEY}}', jira_key)
        return (
            '<div class="content-wrapper"><p>'
            + _jira_jql_macro(
                jql, server_id,
                columns=ev_config.get('columns'),
                column_ids=ev_config.get('column_ids'),
                max_issues=ev_config.get('max_issues', 20)
            )
            + '</p></div>'
        )

    if ev_type == 'jql_count':
        base_jql = portfolio_jql(jira_key)
        suffix = ev_config.get('jql_suffix', '')
        full_jql = f'{base_jql} {suffix}'
        return (
            '<div class="content-wrapper"><p>'
            + _jira_jql_macro(full_jql, server_id, count=True)
            + '</p></div>'
        )

    if ev_type == 'field_value':
        field_id = ev_config.get('field_id', '')
        field_name = ev_config.get('field_name', field_id)
        if field_id:
            return (
                '<div class="content-wrapper"><p>'
                + _jira_key_macro(
                    jira_key, server_id,
                    column_ids=field_id,
                    columns=field_name
                )
                + '</p></div>'
            )
        return '<div class="content-wrapper"><br/></div>'

    if ev_type == 'text':
        text = ev_config.get('text', '')
        return f'<div class="content-wrapper">{_x(text)}</div>'

    if ev_type == 'test_summary':
        base_jql = portfolio_jql(jira_key)
        base_jql_in = portfolio_jql_in(jira_key)
        return (
            '<div class="content-wrapper">'
            '<p><span>Manual TCMS Link:<br/></span></p>'
            '<p><span>QI: </span></p>'
            '<p style="text-align: left;">Reported bugs: '
            + _jira_jql_macro(f'{base_jql} and type = Bug', server_id, count=True)
            + '</p>'
            '<p style="text-align: left;">Open bugs: '
            + _jira_jql_macro(
                f'{base_jql_in} and type = Bug and statusCategory!=Done '
                f'AND fixversion in ("{fix_version}", triage, master) '
                f'and (labels is empty or labels != {fix_version}-deferred)',
                server_id, count=True)
            + '</p>'
            '<p style="text-align: left;">Open P0: '
            + _jira_jql_macro(
                f'{base_jql_in} and type = Bug and statusCategory!=Done '
                f'AND fixversion in ("{fix_version}", triage, master) '
                f'and priority ="Blocker - P0" '
                f'and (labels is empty or labels != {fix_version}-deferred)',
                server_id, count=True)
            + '</p>'
            '<p style="text-align: left;">Open P1: '
            + _jira_jql_macro(
                f'{base_jql_in} and type = Bug and statusCategory!=Done '
                f'AND fixversion in ("{fix_version}", triage, master) '
                f'and priority ="Critical - P1" '
                f'and (labels is empty or labels != {fix_version}-deferred)',
                server_id, count=True)
            + '</p>'
            '<p style="text-align: left;">Reported improvements: '
            + _jira_jql_macro(f'{base_jql} and type = Improvement', server_id, count=True)
            + '</p></div>'
        )

    if ev_type == 'sdl':
        base_jql = portfolio_jql(jira_key)
        return (
            '<div class="content-wrapper"><p>'
            + _jira_jql_macro(
                f'{base_jql} and project in (LEG, SDL)',
                server_id,
                column_ids='issuekey,summary,issuetype,created,status,resolution',
                columns='key,summary,type,created,status,resolution',
                max_issues=20)
            + '</p>'
            '<ul>'
            '<li>Is the security design review done with security team?</li>'
            '<li>Tools scanning (Blackduck and Static code analysis)</li>'
            '<li>Security Testing (Pen test, DAST)</li>'
            '</ul></div>'
        )

    if ev_type == 'shared':
        return ''

    return '<div class="content-wrapper"><br/></div>'


def _render_checklist_row(item, jira_key, server_id, fix_version):
    """Render a single checklist table row."""
    label = _x(item.get('label', ''))
    approver = _x(item.get('approver', ''))
    item_id = _x(item.get('id', ''))
    evidence = _render_checklist_evidence(item, jira_key, server_id, fix_version)

    ev_type = item.get('evidence_type', 'none')
    rowspan_attr = ''
    if ev_type == 'sdl':
        rowspan_attr = ' rowspan="3"'

    evidence_cell = f'<td{rowspan_attr}>{evidence}</td>' if ev_type != 'shared' else ''
    comment_cell = f'<td{rowspan_attr}><br/></td>' if ev_type != 'shared' else ''

    return (
        '<tr>'
        f'<th scope="row"><p>{item_id}. {label}</p></th>'
        f'<td>{_status_macros()}</td>'
        f'<td>{approver}</td>'
        '<td><br/></td>'
        f'{evidence_cell}'
        f'{comment_cell}'
        '</tr>'
    )


def _render_section_header(title, color):
    """Render a colored section header row spanning all columns."""
    conf_color = _hex_to_confluence_color(color)
    return (
        f'<tr>'
        f'<th class="highlight-{conf_color}" colspan="5" data-highlight-colour="{_x(color)}" scope="row">'
        f'<strong>{_x(title)}</strong></th>'
        f'<th class="highlight-{conf_color}" data-highlight-colour="{_x(color)}" scope="row">'
        f'<strong> </strong></th>'
        f'</tr>'
    )


def _render_checklist(jira_key, server_id, fix_version, team, version,
                     config_section, gate_type='cg'):
    mid = _macro_id(team, version, f'{gate_type}-checklist')
    groups = config_section.get('groups', [])
    section_title = _x(config_section.get('title', 'Checklist Details'))

    gate_labels = {
        'cg': ('CG Criteria', 'CG Met Y/N', 'If CG Not Met, will complete by (est. date)'),
        'ccm': ('Code Complete Criteria', 'Code Complete Met Y/N', 'If Code Complete Not Met, will complete by (est. date)'),
        'pg': ('PG Criteria', 'PG Met Y/N', 'If PG Not Met, will complete by (est. date)'),
    }
    criteria_label, met_label, not_met_label = gate_labels.get(
        gate_type, gate_labels['cg']
    )

    rows = []
    for group in groups:
        if group.get('title') and group.get('color'):
            rows.append(_render_section_header(group['title'], group['color']))

        for item in group.get('items', []):
            if not item.get('enabled', True):
                continue
            rows.append(_render_checklist_row(item, jira_key, server_id, fix_version))

    return (
        f'<h1>{section_title}</h1>'
        f'<ac:structured-macro ac:name="details" ac:schema-version="1">'
        f'<ac:parameter ac:name="id">{_x(mid)}</ac:parameter>'
        '<ac:rich-text-body>'
        '<table class="relative-table wrapped" style="width: 100%;">'
        '<colgroup>'
        '<col style="width: 25%;"/>'
        '<col style="width: 11%;"/>'
        '<col style="width: 8%;"/>'
        '<col style="width: 6%;"/>'
        '<col style="width: 30%;"/>'
        '<col style="width: 20%;"/>'
        '</colgroup>'
        '<tbody>'
        '<tr>'
        '<th scope="row"><div class="content-wrapper">'
        f'<h4><strong><span style="color:var(--ds-text,#333333);">{_x(criteria_label)}</span></strong></h4>'
        '</div></th>'
        f'<td><p><strong>{_x(met_label)}</strong></p></td>'
        '<td><p><strong>Approver</strong></p></td>'
        f'<td><p><strong>{_x(not_met_label)}</strong></p></td>'
        '<td><p><strong>Evidence</strong></p></td>'
        '<td><p><strong>Comments/Explanations</strong></p></td>'
        '</tr>'
        + ''.join(rows)
        + '</tbody></table>'
        '</ac:rich-text-body>'
        '</ac:structured-macro>'
    )


def _render_supportability_text():
    # Use explicit dark text and transparent background so text is always readable (avoids blue-on-blue in some themes)
    text_style = 'color:#172b4d; background:transparent;'
    return (
        '<h2 class="auto-cursor-target">Commit Gate - Supportability Checklist</h2>'
        f'<h5 style="text-decoration: none; {text_style}">'
        '<strong>'
        'The below supportability requirements need to be met for all FEATs, '
        'in order to meet the CG gate criteria for Supportability.</strong></h5>'
        f'<ul style="text-decoration: none; {text_style}">'
        '<li><p>The Ownership of meeting these requirements is with the FEAT Manager for the respective FEAT.</p></li>'
        '<li><p>The FEAT Manager will need to review these requirements with the respective Serviceability Engineer '
        'for the component and get their approval for &quot;CG supportability Criteria being met&quot;.</p>'
        '<ul>'
        '<li>This review with the serviceability engineer should be completed before the &quot;CG Release Management Meeting&quot;.</li>'
        '<li>If a feature overlaps across multiple components each serviceability engineer for that component '
        'will need to sign off as part of the CG review.</li>'
        '<li><p>If the approval from Serviceability is not met, please provide details on the why, with timelines where applicable.</p></li>'
        '</ul></li>'
        '<li><p><strong>Please make a copy of this page to track the CG supportability Requirement for each FEAT.</strong></p></li>'
        '</ul>'
    )


def _render_supportability_row(item):
    """Render a single supportability checklist row."""
    item_id = _x(item.get('id', ''))
    label = _x(item.get('label', ''))
    details_list = item.get('details', [])
    sub_rows = item.get('sub_rows', 0)

    details_html = '<ul>' + ''.join(f'<li>{_x(d)}</li>' for d in details_list) + '</ul>' if details_list else '<br/>'

    rowspan = f' rowspan="{sub_rows + 1}"' if sub_rows > 0 else ''

    main_row = (
        '<tr>'
        f'<td class="numberingColumn"{rowspan}>{item_id}</td>'
        f'<th{rowspan} scope="row" style="text-align: left;vertical-align: top;">{label}</th>'
        f'<td>{_status_macros()}</td>'
        f'<td style="text-align: left;vertical-align: top;">{details_html}</td>'
        '<td style="text-align: left;vertical-align: top;"><br/></td>'
        '<td style="text-align: left;vertical-align: top;"><br/></td>'
        '</tr>'
    )

    extra_rows = []
    for i in range(sub_rows):
        extra_rows.append(
            '<tr>'
            f'<td>{_status_macros()}</td>'
            '<td style="text-align: left;vertical-align: top;"><br/></td>'
            '<td style="text-align: left;vertical-align: top;"><br/></td>'
            '<td style="text-align: left;vertical-align: top;"><br/></td>'
            '</tr>'
        )

    return main_row + ''.join(extra_rows)


def _render_supportability_checklist(team, version, config_section):
    mid = _x(_macro_id(team, version, 'cg-serv-checklist'))
    items = config_section.get('items', [])

    rows = ''.join(
        _render_supportability_row(item)
        for item in items
        if item.get('enabled', True)
    )

    return (
        f'<ac:structured-macro ac:name="table-excerpt" ac:schema-version="1">'
        f'<ac:parameter ac:name="name">{mid}</ac:parameter>'
        '<ac:rich-text-body>'
        '<table class="relative-table wrapped" style="width: 100%;">'
        '<colgroup>'
        '<col style="width: 84px;"/>'
        '<col style="width: 233px;"/>'
        '<col style="width: 226px;"/>'
        '<col style="width: 740px;"/>'
        '<col style="width: 655px;"/>'
        '<col style="width: 522px;"/>'
        '</colgroup>'
        '<thead><tr>'
        '<th class="numberingColumn" style="text-align: center;vertical-align: top;"><br/></th>'
        '<th scope="row" style="text-align: center;vertical-align: top;">Supportability Coverage</th>'
        '<th style="text-align: center;vertical-align: top;">Status</th>'
        '<th style="text-align: center;vertical-align: top;">Details</th>'
        '<th style="text-align: center;vertical-align: top;">Dev/QA Lead Comments</th>'
        '<th style="text-align: center;vertical-align: top;">Serviceability Comments</th>'
        '</tr></thead>'
        '<tbody>'
        + rows
        + '</tbody></table>'
        '</ac:rich-text-body>'
        '</ac:structured-macro>'
    )


def render_gate_checklist_page(jira_key: str, team: str, version: str,
                               fix_version: str, server_id: str,
                               config: dict, summary: str = '') -> str:
    """Render the complete gate checklist page XHTML from structured config.

    Only renders sections that are explicitly present and enabled in the config.
    summary: used for CCM process note title ([CCM] FEAT-xxx: <Feature Name>).
    """
    gate_type = config.get('gate_type', 'cg')
    sections_config = {s['id']: s for s in config.get('sections', [])}
    parts = []

    # CCM-only: process note at top ([CCM] key: summary + Timing/Goal/Next Step)
    if gate_type == 'ccm':
        sec = sections_config.get('ccm_process_note')
        if sec and sec.get('enabled', True):
            parts.append(_render_ccm_process_note(jira_key, server_id, summary or ''))

    sec = sections_config.get('legend')
    if sec and sec.get('enabled', True):
        parts.append(_render_legend())

    # Merged summary section (team + key dates in one JIRA macro)
    sec = sections_config.get('summary')
    if sec and sec.get('enabled', True):
        parts.append(_render_summary(jira_key, server_id, sec))
    else:
        # Legacy: separate key_dates and team_table sections
        sec = sections_config.get('key_dates')
        if sec and sec.get('enabled', True):
            parts.append(_render_key_dates(jira_key, server_id, sec))
    
    # For PG template: also render separate key_dates section if explicitly configured
    if gate_type == 'pg':
        sec = sections_config.get('key_dates')
        if sec and sec.get('enabled', True) and sections_config.get('summary'):
            parts.append(_render_key_dates(jira_key, server_id, sec))

    sec = sections_config.get('gate_commitments')
    if sec and sec.get('enabled', True):
        parts.append(_render_gate_commitments(jira_key, server_id, team, version,
                                              compliance_items=config.get('compliance_items')))

    # Legacy team_table: only render if no merged summary section is present
    if not sections_config.get('summary'):
        sec = sections_config.get('team_table')
        if sec and sec.get('enabled', True):
            if gate_type == 'ccm':
                parts.append(_render_ccm_gate_tracking(section_title=_x(sec.get('title', 'Gate Tracking'))))
            else:
                parts.append(_render_team_table(
                    section_title=_x(sec.get('title', 'Summary')),
                    jira_key=jira_key,
                    server_id=server_id,
                    team_info=config.get('team_info'),
                ))

    # CCM Gate Tracking is always driven by team_table section
    if gate_type == 'ccm' and sections_config.get('summary'):
        sec = sections_config.get('team_table')
        if sec and sec.get('enabled', True):
            parts.append(_render_ccm_gate_tracking(section_title=_x(sec.get('title', 'Gate Tracking'))))

    sec = sections_config.get('checklist')
    if sec and sec.get('enabled', True):
        parts.append(_render_checklist(
            jira_key, server_id, fix_version, team, version, sec,
            gate_type=gate_type
        ))

    # CCM-only: sign-off section (logic + Final Status)
    if gate_type == 'ccm':
        sec = sections_config.get('ccm_signoff')
        if sec and sec.get('enabled', True):
            parts.append(_render_ccm_signoff())

    # Supportability instructions and checklist are CG-specific (Commit Gate). They have no place
    # on CCM (Code Complete) or PG (Promotion Gate) pages — do not render them for other gates.
    if gate_type in ['cg', 'pg']:
        sec = sections_config.get('supportability_text')
        if sec and sec.get('enabled', True):
            parts.append(_render_supportability_text())

        sec = sections_config.get('supportability_checklist')
        if sec and sec.get('enabled', True):
            section_title = _x(sec.get('title', 'Supportability Checklist'))
            parts.append(f'<h1>{section_title}</h1>')
            parts.append(_render_supportability_checklist(team, version, sec))

    return '\n'.join(parts)


CONTAINER_DATE_COLUMNS = [
    {"field_id": "customfield_11067", "display": "Code Complete Date"},
    {"field_id": "customfield_35863", "display": "CG Ready Date"},
    {"field_id": "customfield_40473", "display": "CG Review Date"},
    {"field_id": "customfield_35864", "display": "PG Ready Date"},
    {"field_id": "customfield_14367", "display": "GA Date"},
]

CONTAINER_EXPECTED_COLUMN_IDS = (
    ['issuekey', 'summary', 'issuetype', 'status', 'priority']
    + [c['field_id'] for c in TEAM_TABLE_COLUMNS]
    + [c['field_id'] for c in CONTAINER_DATE_COLUMNS]
)


def render_feature_container_page(jira_key: str, summary: str,
                                  server_id: str) -> str:
    """Render a feature container page with JIRA issue details, team, and key dates."""
    overview_ids = ['issuekey', 'summary', 'issuetype', 'status', 'priority']
    overview_names = ['key', 'summary', 'type', 'status', 'priority']

    team_ids = [c['field_id'] for c in TEAM_TABLE_COLUMNS]
    team_names = [c['display'] for c in TEAM_TABLE_COLUMNS]

    date_ids = [c['field_id'] for c in CONTAINER_DATE_COLUMNS]
    date_names = [c['display'] for c in CONTAINER_DATE_COLUMNS]

    all_ids = overview_ids + team_ids + date_ids
    all_names = overview_names + team_names + date_names

    return (
        '<h1>Feature Overview</h1>'
        '<p>'
        + _jira_jql_macro(
            f'key = {jira_key}', server_id,
            column_ids=','.join(all_ids),
            columns=','.join(all_names),
            max_issues=1,
        )
        + '</p>'
        '<h2>Sub-Pages</h2>'
        '<p>'
        '<ac:structured-macro ac:name="children" ac:schema-version="2">'
        '<ac:parameter ac:name="all">true</ac:parameter>'
        '</ac:structured-macro>'
        '</p>'
    )


def render_execution_folder_page(jql: str, server_id: str,
                                 folder_name: str) -> str:
    """Render an Execution folder page with a JIRA table of all features and a children macro."""
    overview_ids = ['issuekey', 'summary', 'issuetype', 'status', 'priority']
    overview_names = ['key', 'summary', 'type', 'status', 'priority']

    team_ids = [c['field_id'] for c in TEAM_TABLE_COLUMNS]
    team_names = [c['display'] for c in TEAM_TABLE_COLUMNS]

    date_ids = [c['field_id'] for c in CONTAINER_DATE_COLUMNS]
    date_names = [c['display'] for c in CONTAINER_DATE_COLUMNS]

    all_ids = overview_ids + team_ids + date_ids
    all_names = overview_names + team_names + date_names

    return (
        f'<h1>{_x(folder_name)}</h1>'
        '<p>'
        + _jira_jql_macro(
            jql, server_id,
            column_ids=','.join(all_ids),
            columns=','.join(all_names),
            max_issues=200,
        )
        + '</p>'
        '<p>'
        '<ac:structured-macro ac:name="children" ac:schema-version="2">'
        '<ac:parameter ac:name="all">true</ac:parameter>'
        '</ac:structured-macro>'
        '</p>'
    )


def render_gate_page(gate_type: str, jira_key: str, team: str, version: str,
                     fix_version: str, server_id: str, config: dict,
                     summary: str = '', team_info: dict | None = None) -> str:
    """Render any gate type page using the same engine with gate-specific config."""
    config = {**config, 'gate_type': gate_type}
    if team_info:
        config = {**config, 'team_info': team_info}
    return render_gate_checklist_page(
        jira_key=jira_key,
        team=team,
        version=version,
        fix_version=fix_version,
        server_id=server_id,
        config=config,
        summary=summary
    )


def render_placeholder_page(title: str) -> str:
    """Render a placeholder page (e.g., for unconfigured gate templates)."""
    return (
        f'<h1>{_x(title)}</h1>'
        '<p><em>This page will be populated with the relevant checklist. '
        'Template to be configured.</em></p>'
    )


def get_team_table_jira_macro(jira_key: str, server_id: str,
                              section_title: str = 'Summary') -> str:
    """Return the JIRA-macro team table HTML for use in sync/upgrade operations."""
    return _render_team_table(section_title=section_title,
                              jira_key=jira_key, server_id=server_id)


def has_static_team_table(body: str) -> bool:
    """Detect whether a page body contains the old static team table (with <th> headers
    for the known roles) rather than a JIRA macro."""
    import re
    if '<h2>Team</h2>' not in body:
        return False
    team_heading_idx = body.index('<h2>Team</h2>')
    next_h1 = body.find('<h1>', team_heading_idx)
    section_end = next_h1 if next_h1 != -1 else team_heading_idx + 2000
    team_section = body[team_heading_idx:section_end]
    has_static = bool(re.search(
        r'<th[^>]*>Dev Lead</th>.*?<th[^>]*>Dev Team</th>',
        team_section, re.DOTALL | re.IGNORECASE,
    ))
    has_jira_macro = '<ac:structured-macro ac:name="jira"' in team_section
    return has_static and not has_jira_macro


def has_separate_key_dates_and_team(body: str) -> bool:
    """Detect old layout: separate '<h1>Key Dates</h1>' and '<h2>Team</h2>' sections
    that should be merged into a single Summary section."""
    import re
    has_key_dates = bool(re.search(r'<h1>\s*Key Dates\s*</h1>', body, re.IGNORECASE))
    has_team_section = '<h2>Team</h2>' in body
    has_summary_team_h1 = bool(re.search(
        r'<h1>[^<]*Summary[^<]*</h1>\s*<h2>Team</h2>',
        body, re.IGNORECASE | re.DOTALL,
    ))
    return has_key_dates and (has_team_section and has_summary_team_h1)


def has_summary_with_key_macro(body: str) -> bool:
    """Detect summary section using the old key-based JIRA macro (compact link)
    instead of the JQL table macro (full table with columns)."""
    import re
    summary_match = re.search(
        r'<h1>[^<]*Summary[^<]*</h1>\s*<p>\s*'
        r'<ac:structured-macro ac:name="jira"[^>]*>(.*?)</ac:structured-macro>',
        body, re.DOTALL | re.IGNORECASE,
    )
    if not summary_match:
        return False
    macro_inner = summary_match.group(1)
    has_key_param = bool(re.search(r'<ac:parameter ac:name="key">', macro_inner, re.IGNORECASE))
    has_jql_param = bool(re.search(r'<ac:parameter ac:name="jqlQuery">', macro_inner, re.IGNORECASE))
    return has_key_param and not has_jql_param


def get_summary_section_html(jira_key: str, server_id: str,
                             config_section: dict) -> str:
    """Return the merged Summary section HTML for use in sync operations."""
    return _render_summary(jira_key, server_id, config_section)
