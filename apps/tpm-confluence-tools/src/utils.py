import copy
import csv
import json
import os
import re
import time
import uuid

TEMPLATE_OVERRIDES_FILENAME = 'template_overrides.json'
WORKFLOW_STATE_FILENAME = 'last_workflow_state.json'
REPORT_STATE_FILENAME = 'last_report.json'


def _template_overrides_path():
    return os.path.join(os.path.dirname(__file__), '..', 'config', TEMPLATE_OVERRIDES_FILENAME)


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into a copy of base. Lists are replaced (not merged)."""
    result = copy.deepcopy(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = copy.deepcopy(v)
    return result


def load_template_overrides() -> dict:
    """Load template overrides from config/template_overrides.json if it exists.

    Returns dict with keys 'ccm', 'cg', 'pg' (each a template config dict), or empty dict.
    """
    path = _template_overrides_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_template_overrides(data: dict) -> None:
    """Write template overrides to config/template_overrides.json.

    data should have keys 'ccm', 'cg', 'pg' with template config dicts.
    Also stamps a 'saved_at' Unix timestamp at the top level.
    """
    path = _template_overrides_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = {**data, 'saved_at': time.time()}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def get_template_saved_at() -> float | None:
    """Return the Unix timestamp when templates were last saved, or None."""
    path = _template_overrides_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('saved_at')
    except (json.JSONDecodeError, OSError):
        return None


def _workflow_state_path():
    return os.path.join(os.path.dirname(__file__), '..', 'config', WORKFLOW_STATE_FILENAME)


def load_workflow_state() -> dict:
    """Load last workflow state (team, version, space, parent, etc.) so refresh doesn't lose progress."""
    path = _workflow_state_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_workflow_state(state: dict) -> None:
    """Persist workflow state so it can be restored after a browser refresh."""
    path = _workflow_state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2)


def _report_state_path():
    return os.path.join(os.path.dirname(__file__), '..', 'config', REPORT_STATE_FILENAME)


def load_report_state() -> list:
    """Load persisted creation results from disk. Returns list of dicts."""
    path = _report_state_path()
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def save_report_state(results: list) -> None:
    """Persist creation results to disk so the report survives a browser refresh."""
    path = _report_state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    serializable = []
    for r in results:
        if hasattr(r, '__dict__'):
            serializable.append(r.__dict__)
        elif isinstance(r, dict):
            serializable.append(r)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(serializable, f, indent=2)


def load_team_config():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'config', 'teams.json')
    with open(config_path, 'r') as f:
        return json.load(f)


def load_custom_fields() -> list[dict]:
    """Load JIRA custom field definitions from the bundled CSV.

    Returns a list of dicts with keys: id, name, description, type.
    The id is normalized to 'customfield_NNNNN' format.
    """
    csv_path = os.path.join(os.path.dirname(__file__), '..', 'config', 'jira_custom_fields.csv')
    if not os.path.exists(csv_path):
        return []

    fields = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw_id = (row.get('customfield_id') or row.get('id') or '').strip()
            name = (row.get('customfield_name') or row.get('name') or '').strip()
            if not raw_id:
                continue
            field_id = raw_id if raw_id.startswith('customfield_') else f'customfield_{raw_id}'
            fields.append({
                'id': field_id,
                'name': name or field_id,
                'description': (row.get('description') or '').strip(),
                'type': (row.get('customfieldtypekey') or '').strip(),
            })
    return fields


def get_version_from_fix_version(fix_version: str, prefix: str) -> str:
    if fix_version.upper().startswith(prefix.upper()):
        return fix_version[len(prefix):]
    return fix_version


def version_no_dots(version: str) -> str:
    return version.replace('.', '')


def generate_tag(team: str, version: str, template_type: str = 'execution') -> str:
    return f"{team.lower()}-{version_no_dots(version)}-{template_type}"


def generate_deferred_label(fix_version: str) -> str:
    return f"{fix_version}-deferred"


def format_page_title(pattern: str, team: str, version: str, jira_key: str, summary: str) -> str:
    return pattern.format(
        team=team,
        version=version,
        jira_key=jira_key,
        summary=summary
    )


def format_folder_name(pattern: str, team: str, version: str, fix_version: str = None) -> str:
    # Use fix_version if provided and pattern contains it, otherwise fallback to team/version
    if fix_version and '{fix_version}' in pattern:
        return pattern.format(team=team, version=version, fix_version=fix_version)
    return pattern.format(team=team, version=version)


def generate_uuid():
    return str(uuid.uuid4())


def sanitize_title(title: str) -> str:
    title = re.sub(r'\s+', ' ', title).strip()
    if len(title) > 255:
        title = title[:252] + '...'
    return title


def extract_jira_key_from_title(title: str) -> str | None:
    match = re.search(r'([A-Z]+-\d+)', title)
    return match.group(1) if match else None


def portfolio_jql(key: str) -> str:
    return (
        f'(key = {key} OR ("Parent Link" = {key}) OR ("FEAT Number" = {key}) '
        f'OR (issueFunction in portfolioChildrenOf("key={key}")) '
        f"OR (issueFunction in issuesInEpics(\"issueFunction in portfolioChildrenOf('key={key}')\")) "
        f'OR (issueFunction in subtasksOf("key={key}")) '
        f"OR issueFunction in subtasksOf(\"issueFunction in issuesInEpics(\\\"issueFunction in portfolioChildrenOf('key={key}')\\\")\"))"
    )


def portfolio_jql_in(key: str) -> str:
    return (
        f'(key = {key} OR ("Parent Link" in ({key})) OR ("FEAT Number" in ({key})) '
        f'OR (issueFunction in portfolioChildrenOf("key in ({key})")) '
        f"OR (issueFunction in issuesInEpics(\"issueFunction in portfolioChildrenOf('key in ({key})')\")) "
        f'OR (issueFunction in subtasksOf("key in ({key})")) '
        f"OR issueFunction in subtasksOf(\"issueFunction in issuesInEpics(\\\"issueFunction in portfolioChildrenOf('key in ({key})')\\\")\"))"
    )
