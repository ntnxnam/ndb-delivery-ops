"""Manages Confluence page hierarchy, creation, duplicate detection, and fixing.

Handles the full page tree:
  Parent Page (e.g., NDB Project Updates - 2.11)
  ├── Planning (Concept Commit)
  ├── Commitment (Execute Commit)
  └── Execution
      ├── Feature Page (container)
      │   ├── Code Complete
      │   ├── CG Checklist
      │   └── PG Checklist
      └── ...
"""

import html
import json
import re
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from src.confluence_client import ConfluenceClient
from src.template_engine import (
    render_gate_checklist_page,
    render_feature_container_page,
    render_execution_folder_page,
    render_gate_page,
    get_expected_macro_ids,
    get_gate_commitments_block,
    get_gate_commitments_default_cell_for_column,
    get_team_table_jira_macro,
    get_summary_section_html,
    has_static_team_table,
    has_separate_key_dates_and_team,
    has_summary_with_key_macro,
    GATE_COMMITMENTS_HEADERS,
    CONTAINER_EXPECTED_COLUMN_IDS,
)
from src.template_data import GATE_TYPES
from src.utils import (
    extract_jira_key_from_title,
    format_folder_name,
    format_page_title,
    generate_tag,
    sanitize_title,
)


GATE_PAGE_SUFFIXES = {
    "ccm": "Code Complete",
    "cg": "CG Checklist",
    "pg": "PG Checklist",
}


def discover_release_templates(confluence: ConfluenceClient, space_key: str, 
                               team: str, version: str) -> Dict[str, Optional[dict]]:
    """
    Discover template configurations from 00-{team}-{version} folders in Confluence.
    
    Args:
        confluence: ConfluenceClient instance
        space_key: Confluence space key to search in
        team: Team name (e.g., "NDB")
        version: Version string (e.g., "2.11")
        
    Returns:
        Dict with keys 'ccm', 'cg', 'pg' containing template configs or None if not found
    """
    templates = {"ccm": None, "cg": None, "pg": None}
    
    # Search for the template folder with pattern 00-{team}-{version}
    folder_pattern = f"00-{team}-{version}"
    
    try:
        # Use CQL to search for pages with the folder pattern in the title
        cql = f'space = "{space_key}" AND title ~ "{folder_pattern}" AND type = page'
        template_pages = confluence.search_pages(cql, expand='body.storage,children.page')
        
        template_folder = None
        
        # Find the main template folder page
        for page in template_pages:
            if folder_pattern in page.get('title', ''):
                template_folder = page
                break
        
        if not template_folder:
            print(f"Warning: No template folder found matching pattern '{folder_pattern}'")
            return templates
            
        print(f"Found template folder: {template_folder['title']}")
        
        # Get children of the template folder to find individual gate templates
        folder_id = template_folder['id']
        children_cql = f'space = "{space_key}" AND ancestor = "{folder_id}" AND type = page'
        child_pages = confluence.search_pages(children_cql, expand='body.storage')
        
        # Map each gate type to its template page
        for child in child_pages:
            title = child.get('title', '').lower()
            
            # Check for CCM template
            if any(keyword in title for keyword in ['ccm', 'code complete', 'codecomplete']):
                templates['ccm'] = _extract_template_config(child, 'ccm')
                print(f"Found CCM template: {child['title']}")
                
            # Check for CG template  
            elif any(keyword in title for keyword in ['cg checklist', 'cg-checklist', 'cgchecklist']):
                templates['cg'] = _extract_template_config(child, 'cg')
                print(f"Found CG template: {child['title']}")
                
            # Check for PG template
            elif any(keyword in title for keyword in ['pg checklist', 'pg-checklist', 'pgchecklist', 'pg readiness']):
                templates['pg'] = _extract_template_config(child, 'pg')
                print(f"Found PG template: {child['title']}")
                
    except Exception as e:
        print(f"Error discovering templates: {e}")
        
    return templates


def _extract_template_config(page: dict, gate_type: str) -> dict:
    """
    Extract template configuration from a Confluence page's content.
    
    Args:
        page: Confluence page dict with body.storage content
        gate_type: 'ccm', 'cg', or 'pg'
        
    Returns:
        Template configuration dict compatible with existing template system
    """
    try:
        body_content = page.get('body', {}).get('storage', {}).get('value', '')
        title = page.get('title', '')
        
        # Basic template structure
        template_config = {
            "template_name": title,
            "gate_type": gate_type,
            "ready": True,
            "template_description": f"Template extracted from {title}",
            "sections": []
        }
        
        # Parse key sections from the HTML content
        sections = _parse_confluence_sections(body_content, gate_type)
        template_config["sections"] = sections
        
        return template_config
        
    except Exception as e:
        print(f"Error extracting template config from page: {e}")
        return _get_fallback_template(gate_type)


def _parse_confluence_sections(html_content: str, gate_type: str) -> list:
    """
    Parse Confluence HTML content to extract template sections and checklist items.
    
    Args:
        html_content: Raw HTML from Confluence storage format
        gate_type: Gate type for context
        
    Returns:
        List of section dictionaries
    """
    sections = []
    
    try:
        # Look for structured macro tables (common in checklist templates)
        if 'ac:structured-macro' in html_content and 'table' in html_content:
            # This is likely a table-based checklist
            checklist_section = {
                "id": "checklist",
                "title": f"{gate_type.upper()} Checklist",
                "type": "checklist",
                "items": _extract_checklist_items_from_html(html_content)
            }
            sections.append(checklist_section)
        
        # Look for key dates section (JIRA macro)
        if 'jira' in html_content.lower() and ('key dates' in html_content.lower() or 'key-dates' in html_content.lower()):
            key_dates_section = {
                "id": "key_dates", 
                "title": "Key Dates",
                "type": "key_dates",
                "columns": ["Summary", "Status", "Assignee", "Due Date"]
            }
            sections.append(key_dates_section)
            
        # Add summary section for PG templates
        if gate_type == 'pg' and 'summary' in html_content.lower():
            summary_section = {
                "id": "summary",
                "title": "PG Summary", 
                "type": "summary"
            }
            sections.append(summary_section)
            
    except Exception as e:
        print(f"Error parsing sections: {e}")
        
    # If no sections found, provide a basic checklist
    if not sections:
        sections.append({
            "id": "checklist",
            "title": f"{gate_type.upper()} Checklist",
            "type": "checklist", 
            "items": [
                {
                    "id": "item_1",
                    "label": "Basic checklist item",
                    "evidence_type": "text",
                    "evidence_query": "",
                    "approver_role": "dev_lead"
                }
            ]
        })
        
    return sections


def _extract_checklist_items_from_html(html_content: str) -> list:
    """Extract checklist items from HTML table content."""
    items = []
    
    try:
        # Look for table rows and extract checklist items
        # This is a simplified parser - in production you might want a more robust HTML parser
        import re
        
        # Find table cells that might contain checklist items
        cell_pattern = r'<td[^>]*>(.*?)</td>'
        cells = re.findall(cell_pattern, html_content, re.DOTALL | re.IGNORECASE)
        
        item_counter = 1
        for cell in cells:
            # Clean up cell content
            clean_text = re.sub(r'<[^>]+>', '', cell).strip()
            if clean_text and len(clean_text) > 5:  # Skip empty or very short cells
                items.append({
                    "id": f"item_{item_counter}",
                    "label": clean_text[:100],  # Limit length
                    "evidence_type": "text",
                    "evidence_query": "",
                    "approver_role": "dev_lead"
                })
                item_counter += 1
                
    except Exception as e:
        print(f"Error extracting checklist items: {e}")
        
    return items if items else [{
        "id": "item_1",
        "label": "Template item from Confluence",
        "evidence_type": "text", 
        "evidence_query": "",
        "approver_role": "dev_lead"
    }]


def _get_fallback_template(gate_type: str) -> dict:
    """Get a basic fallback template if parsing fails."""
    from src.template_data import get_default_config
    return get_default_config(gate_type)


@dataclass
class PageAction:
    jira_key: str
    summary: str
    action: str  # 'create', 'skip', 'fix', 'error', 'created', 'fixed'
    details: str = ''
    page_url: str = ''
    page_id: str = ''
    issues: list = field(default_factory=list)
    page_type: str = ''  # 'container' | 'ccm' | 'cg' | 'pg' for reporting


@dataclass
class TicketStatus:
    """Status of a single JIRA ticket across all gate types."""
    jira_key: str
    summary: str
    container_id: str = ''
    container_url: str = ''
    container_action: str = ''  # 'exists', 'create', 'fix'
    container_issues: list = field(default_factory=list)
    container_needs_sync: bool = False
    gates: dict = field(default_factory=dict)  # gate_type -> {'exists': bool, 'page_id': str, 'url': str, 'needs_sync': bool}


@dataclass
class CleanupItem:
    """A page that needs cleanup: wrong parent, orphan, or content issue."""
    page_id: str
    title: str
    jira_key: str
    item_type: str  # 'misplaced_gate' | 'orphan_container'
    gate_type: str = ''  # for misplaced_gate: 'ccm'|'cg'|'pg'
    container_id: str = ''  # for misplaced_gate: target container to move under
    page_url: str = ''


def ensure_folder(confluence: ConfluenceClient, space_key: str,
                  parent_id: str, folder_name: str,
                  body: str | None = None) -> tuple[str, str]:
    """Ensure a folder page exists under parent. Create if missing.

    If *body* is provided it is used as the page content when creating;
    otherwise a default children-macro page is generated.

    Returns (page_id, status) where status is 'found', 'renamed', or 'created'.
    """
    # FIRST: Check if a page with this exact title already exists anywhere in the space
    try:
        existing_page = confluence.get_page_by_title(space_key, folder_name)
        if existing_page:
            print(f"Found existing page '{folder_name}' in space, checking parent...")
            # Check if it's under the correct parent
            page_ancestors = existing_page.get('ancestors', [])
            if not page_ancestors:
                # Get full page info with ancestors if not included
                try:
                    full_page = confluence.get_page_by_id(existing_page['id'], expand='ancestors')
                    page_ancestors = full_page.get('ancestors', [])
                except:
                    pass
            
            # If it's under the correct parent, return it
            if page_ancestors and page_ancestors[-1]['id'] == parent_id:
                print(f"Page '{folder_name}' is already under correct parent")
                return existing_page['id'], 'found'
            else:
                print(f"Page '{folder_name}' exists but under different parent")
                # Don't try to create - it will fail. Return the existing one.
                return existing_page['id'], 'found'
    except Exception as e:
        # Page doesn't exist by title, continue with child checking
        print(f"Page '{folder_name}' not found by title: {e}")
        pass

    # SECOND: Check children under the intended parent (in case title search missed it)
    children = confluence.get_child_pages(parent_id)
    normalized_target = folder_name.lower().strip()

    for child in children:
        child_title_lower = child['title'].lower().strip()
        if child_title_lower == normalized_target:
            return child['id'], 'found'
        if _titles_match_fuzzy(child['title'], folder_name):
            if child['title'] != folder_name:
                try:
                    confluence.rename_page(child['id'], folder_name)
                    return child['id'], 'renamed'
                except Exception as e:
                    print(f"Could not rename page: {e}")
                    # If rename fails, treat as found
                    return child['id'], 'found'
            return child['id'], 'found'

    if body is None:
        body = (
            f'<p>Auto-generated folder page for {folder_name}</p>'
            '<p>'
            '<ac:structured-macro ac:name="children" ac:schema-version="2">'
            '<ac:parameter ac:name="all">true</ac:parameter>'
            '</ac:structured-macro>'
            '</p>'
        )
    
    # Try to create the page, but handle conflicts gracefully
    try:
        page = confluence.create_page(
            space_key=space_key,
            title=folder_name,
            body=body,
            parent_id=parent_id
        )
        return page['id'], 'created'
    except Exception as e:
        error_msg = str(e)
        if "already exists" in error_msg.lower() or "page with this title" in error_msg.lower():
            # Try to find the existing page and check if we can use it
            try:
                existing_page = confluence.get_page_by_title(space_key, folder_name)
                if existing_page:
                    print(f"Found existing page '{folder_name}' after create failure")
                    return existing_page['id'], 'found'
            except:
                pass
            
            # If we can't find it, try with a timestamp suffix
            import time
            suffix = int(time.time()) % 10000
            new_folder_name = f"{folder_name}-{suffix}"
            print(f"Page '{folder_name}' conflicts, creating as '{new_folder_name}'")
            
            try:
                page = confluence.create_page(
                    space_key=space_key,
                    title=new_folder_name,
                    body=body,
                    parent_id=parent_id
                )
                return page['id'], 'created'
            except Exception as e2:
                print(f"Failed to create page with suffix: {e2}")
                raise e  # Raise original error
        else:
            raise e  # Re-raise if not a title conflict


def _titles_match_fuzzy(existing: str, target: str) -> bool:
    """Enhanced fuzzy matching for page titles with multiple strategies."""
    # Strategy 1: Exact match
    if existing == target:
        return True
        
    # Strategy 2: Case-insensitive exact match
    if existing.lower() == target.lower():
        return True
    
    # Strategy 3: Alphanumeric-only comparison (original logic)
    existing_clean = re.sub(r'[^a-z0-9]', '', existing.lower())
    target_clean = re.sub(r'[^a-z0-9]', '', target.lower())
    if existing_clean == target_clean:
        return True
    
    # Strategy 4: Gate-specific pattern matching for better detection
    # Extract key components: JIRA key, gate type indicators
    jira_key_pattern = r'[A-Z]+-\d+'
    
    existing_jira = re.search(jira_key_pattern, existing)
    target_jira = re.search(jira_key_pattern, target)
    
    # If both have JIRA keys and they match
    if existing_jira and target_jira and existing_jira.group() == target_jira.group():
        existing_lower = existing.lower()
        target_lower = target.lower()
        
        # Check for gate type indicators
        gate_indicators = {
            'pg': ['pg', 'promotion gate', 'readiness', 'pg checklist'],
            'cg': ['cg', 'commit gate', 'cg checklist'],
            'ccm': ['ccm', 'code complete', 'codecomplete']
        }
        
        for gate_type, indicators in gate_indicators.items():
            existing_has_gate = any(indicator in existing_lower for indicator in indicators)
            target_has_gate = any(indicator in target_lower for indicator in indicators)
            
            # If both titles indicate the same gate type, they likely match
            if existing_has_gate and target_has_gate:
                return True
    
    return False


def ensure_phase_folders(confluence: ConfluenceClient, space_key: str,
                         parent_id: str, team: str, version: str,
                         phase_patterns: dict,
                         jql: str | None = None,
                         server_id: str | None = None,
                         fix_version: str | None = None) -> dict:
    """Ensure all phase folders exist.

    When *jql* and *server_id* are provided, the **execution** folder is
    created with a JIRA table showing all features for the release, followed
    by a children macro.  Other folders get the default body.

    Returns dict of phase -> {'id': page_id, 'status': 'found'|'renamed'|'created'}.
    """
    folder_info = {}
    for phase, pattern in phase_patterns.items():
        folder_name = format_folder_name(pattern, team=team, version=version, fix_version=fix_version)
        body = None
        if phase == 'execution' and jql and server_id:
            body = render_execution_folder_page(jql, server_id, folder_name)
        page_id, status = ensure_folder(confluence, space_key, parent_id, folder_name, body=body)
        folder_info[phase] = {'id': page_id, 'status': status}
    return folder_info


def _gate_title_matches(existing_title: str, expected_title: str, gate_type: str, suffix: str) -> bool:
    """Enhanced gate title matching with gate-type-specific logic."""
    
    # Strategy 1: Exact fuzzy match
    if _titles_match_fuzzy(existing_title, expected_title):
        return True
    
    # Strategy 2: Check if the suffix appears in the title (original logic)
    if suffix.lower() in existing_title.lower():
        return True
    
    # Strategy 3: Gate-specific pattern matching
    existing_lower = existing_title.lower()
    
    # Extract JIRA key from both titles
    jira_key_pattern = r'[A-Z]+-\d+'
    existing_jira = re.search(jira_key_pattern, existing_title)
    expected_jira = re.search(jira_key_pattern, expected_title)
    
    # If JIRA keys match, check for gate-specific indicators
    if existing_jira and expected_jira and existing_jira.group() == expected_jira.group():
        if gate_type == 'pg':
            # PG pages can have various naming patterns
            pg_indicators = [
                'pg', 'promotion gate', 'readiness', 'pg checklist', 
                'pg-checklist', 'pgchecklist', 'pg readiness',
                'promotion-gate', 'promotiongate'
            ]
            if any(indicator in existing_lower for indicator in pg_indicators):
                return True
                
        elif gate_type == 'cg':
            # CG page patterns
            cg_indicators = [
                'cg', 'commit gate', 'cg checklist', 'cg-checklist', 
                'cgchecklist', 'commit-gate', 'commitgate'
            ]
            if any(indicator in existing_lower for indicator in cg_indicators):
                return True
                
        elif gate_type == 'ccm':
            # CCM page patterns  
            ccm_indicators = [
                'ccm', 'code complete', 'codecomplete', 'code-complete',
                'cc', 'code comp'
            ]
            if any(indicator in existing_lower for indicator in ccm_indicators):
                return True
    
    # Strategy 4: Check if title ends with a gate-like pattern
    # Sometimes titles have different prefixes but same suffix patterns
    gate_suffix_patterns = {
        'pg': [r'pg\s*checklist', r'pg\s*readiness', r'promotion\s*gate'],
        'cg': [r'cg\s*checklist', r'commit\s*gate'],
        'ccm': [r'code\s*complete', r'ccm']
    }
    
    if gate_type in gate_suffix_patterns:
        for pattern in gate_suffix_patterns[gate_type]:
            if re.search(pattern, existing_lower):
                return True
    
    return False


def ensure_parent_page(confluence: ConfluenceClient, space_key: str,
                       parent_title: str, root_page_id: str = None) -> dict | None:
    """Search for the parent page by title. Create under root if not found and root_page_id given."""
    page = confluence.get_page_by_title(space_key, parent_title)
    if page:
        return page

    if root_page_id:
        body = (
            f'<p>Release tracking page for {parent_title}</p>'
            '<p>'
            '<ac:structured-macro ac:name="children" ac:schema-version="2">'
            '<ac:parameter ac:name="all">true</ac:parameter>'
            '</ac:structured-macro>'
            '</p>'
        )
        try:
            page = confluence.create_page(
                space_key=space_key,
                title=parent_title,
                body=body,
                parent_id=root_page_id
            )
            return page
        except Exception as e:
            error_msg = str(e)
            if "already exists" in error_msg.lower() or "page with this title" in error_msg.lower():
                # Try to find the existing page
                try:
                    existing_page = confluence.get_page_by_title(space_key, parent_title)
                    if existing_page:
                        print(f"Found existing parent page '{parent_title}' after create failure")
                        return existing_page
                except:
                    pass
            raise e

    return None


def _is_gate_page_title(title: str) -> bool:
    """True if title looks like a gate sub-page (has suffix like ' - Code Complete'), not the container."""
    t = (title or '').strip()
    for suffix in GATE_PAGE_SUFFIXES.values():
        if t.endswith(' - ' + suffix) or suffix.lower() in t.lower().split(' - ')[-1]:
            return True
    return False


def _is_likely_container(title: str, expected_title: str) -> bool:
    """Check if a page is likely the actual container vs an unrelated page that shares the JIRA key.

    Rejects:
    - Gate pages (Code Complete / CG / PG Checklist)
    - Pages with a completely different title structure (e.g. "FEAT-123: Design Doc")
    - Pages that extend the expected title with extra suffixes (e.g. "... - Weekly Status Update")
    """
    if _is_gate_page_title(title):
        return False
    if title == expected_title:
        return True
    if _titles_match_fuzzy(title, expected_title):
        return True

    # The expected title follows the pattern "{team} Project Update - {version} - {JIRA_KEY} - {summary}".
    # Extract the prefix through the JIRA key (e.g. "NDB Project Update - 2.11 - FEAT-18614").
    # A valid container must at least start with this prefix.
    key_match = re.search(r'[A-Z]+-\d+', expected_title)
    if key_match:
        prefix_through_key = expected_title[:key_match.end()]
        if not title.startswith(prefix_through_key):
            return False

    # A page whose title starts with the expected container title but tacks on
    # extra segments (e.g. " - Weekly Status Update") is a different page type.
    if len(title) > len(expected_title) and title.startswith(expected_title):
        extra = title[len(expected_title):].lstrip()
        if extra.startswith('-') or extra.startswith('–'):
            return False
    return True


def _compute_needs_sync(body: str, gate_type: str, team: str, version: str) -> bool:
    """Determine if a gate page needs sync based on its HTML body. Pure logic, no API calls."""
    if has_static_team_table(body):
        return True
    if has_separate_key_dates_and_team(body):
        return True
    if has_summary_with_key_macro(body):
        return True
    if gate_type != 'cg':
        return False
    expected_ids = get_expected_macro_ids(team, version, 'cg')
    cg_text_id = next((i for i in expected_ids if 'cg-text-summary' in i), None)
    if not cg_text_id:
        return False
    if cg_text_id not in body:
        return True
    expected_cols = len(GATE_COMMITMENTS_HEADERS)
    id_param = re.escape(f'<ac:parameter ac:name="id">{cg_text_id}</ac:parameter>')
    macro_match = re.search(
        rf'<ac:structured-macro\s+ac:name="details"[^>]*>.*?{id_param}.*?<ac:rich-text-body>(.*?)</ac:rich-text-body>',
        body, re.DOTALL | re.IGNORECASE,
    )
    if macro_match:
        inner = macro_match.group(1)
        first_row = re.search(r'<tr>(.*?)</tr>', inner, re.DOTALL)
        if first_row:
            current_cols = len(re.findall(r'<th[^>]*>', first_row.group(0)))
            if 0 < current_cols < expected_cols:
                return True
    return False


def _container_needs_sync(body: str) -> bool:
    """Check if a container page's JIRA macro is missing team/date columns."""
    for col_id in CONTAINER_EXPECTED_COLUMN_IDS:
        if col_id not in body:
            return True
    return False


def sync_container_content(
    confluence: ConfluenceClient,
    page_id: str,
    jira_key: str,
    server_id: str,
) -> PageAction:
    """Sync a container page to include the full team + date JIRA macro."""
    try:
        page = confluence.get_page_by_id(page_id, expand='body.storage,version')
        body = (page.get('body') or {}).get('storage', {}).get('value', '') or ''
        version_num = page.get('version', {}).get('number', 1)
        title = page.get('title', '')

        new_body = render_feature_container_page(jira_key, '', server_id)

        if not _container_needs_sync(body):
            return PageAction(
                jira_key=jira_key, summary='', action='fixed',
                details='Container already has full template.',
                page_url=confluence.page_url(page), page_id=page_id,
                page_type='container',
            )

        updated = confluence.update_page(
            page_id=page_id,
            title=title,
            body=new_body,
            version_number=version_num + 1,
        )
        return PageAction(
            jira_key=jira_key, summary='', action='fixed',
            details='Synced container: added team & date columns.',
            page_url=confluence.page_url(updated), page_id=page_id,
            page_type='container',
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary='', action='error',
            details=f'Container sync failed: {str(e)}',
            page_id=page_id, page_type='container',
        )


def scan_tickets(confluence: ConfluenceClient, space_key: str,
                 execution_folder_id: str, issues: list,
                 team: str, version: str,
                 title_pattern: str) -> tuple[list, list, list]:
    """Scan existing pages for all tickets and check sub-page (gate) status.

    Also computes cleanup issues (misplaced gates + orphan containers) and
    needs_sync flags so the UI never needs live API calls after scan.

    Returns (ticket_statuses, misplaced_gates, orphan_containers).
    """
    children = confluence.get_child_pages(execution_folder_id, expand='version,metadata.labels,ancestors')

    # Build a map of expected titles so we can validate container candidates
    expected_titles = {}
    for issue in issues:
        jk = issue['key']
        s = issue.get('fields', {}).get('summary', '')
        expected_titles[jk] = sanitize_title(
            format_page_title(title_pattern, team=team, version=version,
                              jira_key=jk, summary=s)
        )

    # Collect direct children by JIRA key, preferring pages that look like real containers
    existing_by_key = {}
    for child in children:
        found_key = extract_jira_key_from_title(child['title'])
        if not found_key:
            continue
        if _is_gate_page_title(child['title']):
            continue
        et = expected_titles.get(found_key, '')
        is_container = _is_likely_container(child['title'], et) if et else True
        if found_key in existing_by_key:
            # Keep the page that better matches the expected title
            if is_container and not _is_likely_container(existing_by_key[found_key]['title'], et):
                existing_by_key[found_key] = child
            elif is_container and len(child['title']) < len(existing_by_key[found_key]['title']):
                existing_by_key[found_key] = child
        else:
            if is_container:
                existing_by_key[found_key] = child

    # --- Batch CQL for tickets not found as direct children ---
    fetched_keys = set(issue['key'] for issue in issues)
    missing_keys = [issue['key'] for issue in issues if issue['key'] not in existing_by_key]
    if missing_keys:
        for i in range(0, len(missing_keys), 10):
            batch = missing_keys[i:i + 10]
            title_clauses = ' OR '.join(f'title ~ "{k}"' for k in batch)
            cql = f'space = "{space_key}" AND ({title_clauses}) AND type = page'
            try:
                found_pages = confluence.search_pages(cql)
            except Exception:
                found_pages = []
            for p in found_pages:
                pk = extract_jira_key_from_title(p['title'])
                if pk and pk in fetched_keys and pk not in existing_by_key:
                    et = expected_titles.get(pk, '')
                    if et and _is_likely_container(p['title'], et):
                        existing_by_key[pk] = p

    # --- Build ticket statuses ---
    results = []
    expected_tag = generate_tag(team, version)
    issues_map = {issue['key']: issue for issue in issues}

    for issue in issues:
        jira_key = issue['key']
        summary = issue.get('fields', {}).get('summary', '')
        ts = TicketStatus(jira_key=jira_key, summary=summary)

        if jira_key in existing_by_key:
            container = existing_by_key[jira_key]
            ts.container_id = container['id']
            ts.container_url = confluence.page_url(container)
            ts.container_action = 'exists'

            expected_prefix = f'{team} Project Update - {version} - {jira_key}'
            issues_list = []
            if not container['title'].startswith(expected_prefix):
                issues_list.append(f"Title: '{container['title']}'")
            labels = [l['name'] for l in container.get('metadata', {}).get('labels', {}).get('results', [])]
            if expected_tag not in labels:
                issues_list.append(f"Missing tag '{expected_tag}'")
            ancestors = container.get('ancestors', [])
            if not ancestors:
                try:
                    page_with_ancestors = confluence.get_page_by_id(container['id'], expand='ancestors')
                    ancestors = page_with_ancestors.get('ancestors', [])
                except Exception:
                    pass
            if ancestors and ancestors[-1]['id'] != execution_folder_id:
                issues_list.append("Wrong parent (should be under Execution)")
            if issues_list:
                ts.container_action = 'fix'
                ts.container_issues = issues_list

            try:
                container_data = confluence.get_page_by_id(container['id'], expand='body.storage')
                container_body = (container_data.get('body') or {}).get('storage', {}).get('value', '') or ''
                ts.container_needs_sync = _container_needs_sync(container_body)
            except Exception:
                pass

            sub_pages = confluence.get_child_pages(container['id'],
                                                    expand='version,metadata.labels')
            sub_titles = {p['title']: p for p in sub_pages}

            page_title = sanitize_title(
                format_page_title(title_pattern, team=team, version=version,
                                  jira_key=jira_key, summary=summary)
            )

            # Collect gate page IDs that need body.storage for needs_sync
            gate_pages_to_check = {}
            for gate_type, suffix in GATE_PAGE_SUFFIXES.items():
                gate_title = f'{page_title} - {suffix}'
                found = False
                found_page = None
                for st_title, st_page in sub_titles.items():
                    if _gate_title_matches(st_title, gate_title, gate_type, suffix):
                        found = True
                        found_page = st_page
                        break

                gate_issues = []
                if found and found_page:
                    gate_labels = [
                        l['name'] for l in
                        found_page.get('metadata', {}).get('labels', {}).get('results', [])
                    ]
                    expected_gate_tag = generate_tag(
                        team, version, GATE_TYPES[gate_type]['suffix']
                    )
                    if expected_gate_tag not in gate_labels:
                        gate_issues.append(f"Missing tag '{expected_gate_tag}'")
                    gate_pages_to_check[gate_type] = found_page['id']

                ts.gates[gate_type] = {
                    'exists': found,
                    'page_id': found_page['id'] if found_page else '',
                    'url': confluence.page_url(found_page) if found_page else '',
                    'issues': gate_issues,
                    'needs_sync': False,
                }

            # Fetch body.storage for existing gates to compute needs_sync
            for gate_type, page_id in gate_pages_to_check.items():
                try:
                    page_data = confluence.get_page_by_id(page_id, expand='body.storage')
                    body = (page_data.get('body') or {}).get('storage', {}).get('value', '') or ''
                    ts.gates[gate_type]['needs_sync'] = _compute_needs_sync(body, gate_type, team, version)
                except Exception:
                    pass
        else:
            ts.container_action = 'create'
            for gate_type in GATE_PAGE_SUFFIXES:
                ts.gates[gate_type] = {'exists': False, 'page_id': '', 'url': '', 'needs_sync': False}

        results.append(ts)

    # --- Cleanup detection (reuse already-fetched children) ---
    key_to_container_id = {ts.jira_key: ts.container_id for ts in results if ts.container_id}
    misplaced_gates = []
    orphan_containers = []
    for child in children:
        title = child['title']
        jira_key = extract_jira_key_from_title(title)
        child_ancestors = child.get('ancestors', [])
        parent_id = child_ancestors[-1]['id'] if child_ancestors else None

        for gate_type, suffix in GATE_PAGE_SUFFIXES.items():
            if f' - {suffix}' in title or suffix.lower() in title.lower():
                if parent_id == execution_folder_id:
                    container_id = key_to_container_id.get(jira_key or '') if jira_key else ''
                    misplaced_gates.append(CleanupItem(
                        page_id=child['id'],
                        title=title,
                        jira_key=jira_key or '',
                        item_type='misplaced_gate',
                        gate_type=gate_type,
                        container_id=container_id,
                        page_url=confluence.page_url(child)
                    ))
                break
        else:
            if jira_key and jira_key not in fetched_keys:
                orphan_containers.append(CleanupItem(
                    page_id=child['id'],
                    title=title,
                    jira_key=jira_key,
                    item_type='orphan_container',
                    page_url=confluence.page_url(child)
                ))

    return results, misplaced_gates, orphan_containers


def rescan_single_ticket(confluence: ConfluenceClient, space_key: str,
                         execution_folder_id: str, issue: dict,
                         team: str, version: str,
                         title_pattern: str) -> TicketStatus:
    """Re-scan a single ticket's Confluence status (container + gates + needs_sync).

    This is the per-ticket equivalent of scan_tickets, used for the Refresh button.
    """
    jira_key = issue['key']
    summary = issue.get('fields', {}).get('summary', '')
    ts = TicketStatus(jira_key=jira_key, summary=summary)
    expected_tag = generate_tag(team, version)
    expected_title = sanitize_title(
        format_page_title(title_pattern, team=team, version=version,
                          jira_key=jira_key, summary=summary)
    )

    # Try to find the container page among direct children
    container_page = None
    children = confluence.get_child_pages(execution_folder_id, expand='version,metadata.labels,ancestors')
    for child in children:
        found_key = extract_jira_key_from_title(child['title'])
        if found_key == jira_key and _is_likely_container(child['title'], expected_title):
            if container_page is None or len(child['title']) < len(container_page['title']):
                container_page = child

    if not container_page:
        cql = f'space = "{space_key}" AND title ~ "{jira_key}" AND type = page'
        try:
            found_pages = confluence.search_pages(cql)
            candidates = [p for p in found_pages
                          if extract_jira_key_from_title(p['title']) == jira_key
                          and _is_likely_container(p['title'], expected_title)]
            if candidates:
                exact = next((p for p in candidates if p['title'] == expected_title), None)
                container_page = exact or candidates[0]
        except Exception:
            pass

    if container_page:
        ts.container_id = container_page['id']
        ts.container_url = confluence.page_url(container_page)
        ts.container_action = 'exists'

        issues_list = []
        expected_prefix = f'{team} Project Update - {version} - {jira_key}'
        if not container_page['title'].startswith(expected_prefix):
            issues_list.append(f"Title: '{container_page['title']}'")
        labels = [l['name'] for l in container_page.get('metadata', {}).get('labels', {}).get('results', [])]
        if expected_tag not in labels:
            issues_list.append(f"Missing tag '{expected_tag}'")
        ancestors = container_page.get('ancestors', [])
        if not ancestors:
            try:
                page_with_ancestors = confluence.get_page_by_id(container_page['id'], expand='ancestors')
                ancestors = page_with_ancestors.get('ancestors', [])
            except Exception:
                pass
        if ancestors and ancestors[-1]['id'] != execution_folder_id:
            issues_list.append("Wrong parent (should be under Execution)")
        if issues_list:
            ts.container_action = 'fix'
            ts.container_issues = issues_list

        try:
            container_data = confluence.get_page_by_id(container_page['id'], expand='body.storage')
            container_body = (container_data.get('body') or {}).get('storage', {}).get('value', '') or ''
            ts.container_needs_sync = _container_needs_sync(container_body)
        except Exception:
            pass

        sub_pages = confluence.get_child_pages(container_page['id'], expand='version,metadata.labels')
        sub_titles = {p['title']: p for p in sub_pages}
        page_title = sanitize_title(
            format_page_title(title_pattern, team=team, version=version,
                              jira_key=jira_key, summary=summary)
        )

        for gate_type, suffix in GATE_PAGE_SUFFIXES.items():
            gate_title = f'{page_title} - {suffix}'
            found = False
            found_page = None
            for st_title, st_page in sub_titles.items():
                if _gate_title_matches(st_title, gate_title, gate_type, suffix):
                    found = True
                    found_page = st_page
                    break

            gate_issues = []
            needs_sync = False
            if found and found_page:
                gate_labels = [
                    l['name'] for l in
                    found_page.get('metadata', {}).get('labels', {}).get('results', [])
                ]
                expected_gate_tag = generate_tag(team, version, GATE_TYPES[gate_type]['suffix'])
                if expected_gate_tag not in gate_labels:
                    gate_issues.append(f"Missing tag '{expected_gate_tag}'")
                try:
                    page_data = confluence.get_page_by_id(found_page['id'], expand='body.storage')
                    body = (page_data.get('body') or {}).get('storage', {}).get('value', '') or ''
                    needs_sync = _compute_needs_sync(body, gate_type, team, version)
                except Exception:
                    pass

            ts.gates[gate_type] = {
                'exists': found,
                'page_id': found_page['id'] if found_page else '',
                'url': confluence.page_url(found_page) if found_page else '',
                'issues': gate_issues,
                'needs_sync': needs_sync,
            }
    else:
        ts.container_action = 'create'
        for gate_type in GATE_PAGE_SUFFIXES:
            ts.gates[gate_type] = {'exists': False, 'page_id': '', 'url': '', 'needs_sync': False}

    return ts


def create_container_page(confluence: ConfluenceClient, space_key: str,
                          execution_folder_id: str, jira_key: str,
                          summary: str, team: str, version: str,
                          server_id: str, title_pattern: str,
                          tag: str) -> PageAction:
    """Create just the feature container page (no sub-pages)."""
    try:
        page_title = sanitize_title(
            format_page_title(title_pattern, team=team, version=version,
                              jira_key=jira_key, summary=summary)
        )
        body = render_feature_container_page(jira_key, summary, server_id)
        page = confluence.create_page(
            space_key=space_key,
            title=page_title,
            body=body,
            parent_id=execution_folder_id,
            labels=[tag]
        )
        return PageAction(
            jira_key=jira_key, summary=summary, action='created',
            details='Container page created',
            page_url=confluence.page_url(page), page_id=page['id'],
            page_type='container'
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary=summary, action='error',
            details=str(e), page_type='container'
        )


def create_gate_page(confluence: ConfluenceClient, space_key: str,
                     container_id: str, jira_key: str, summary: str,
                     team: str, version: str, fix_version: str,
                     server_id: str, title_pattern: str, tag: str,
                     gate_type: str, template_config: dict,
                     team_info: dict | None = None) -> PageAction:
    """Create a single gate sub-page (CC, CG, or PG) under the container."""
    suffix = GATE_PAGE_SUFFIXES.get(gate_type, gate_type)
    gate_tag = generate_tag(team, version, GATE_TYPES[gate_type]['suffix'])

    try:
        page_title = sanitize_title(
            format_page_title(title_pattern, team=team, version=version,
                              jira_key=jira_key, summary=summary)
        )
        gate_title = sanitize_title(f'{page_title} - {suffix}')

        body = render_gate_page(
            gate_type=gate_type,
            jira_key=jira_key,
            team=team,
            version=version,
            fix_version=fix_version,
            server_id=server_id,
            config=template_config,
            summary=summary or '',
            team_info=team_info,
        )

        page = confluence.create_page(
            space_key=space_key,
            title=gate_title,
            body=body,
            parent_id=container_id,
            labels=[tag, gate_tag]
        )

        return PageAction(
            jira_key=jira_key, summary=summary, action='created',
            details=f'{suffix} page created',
            page_url=confluence.page_url(page), page_id=page['id'],
            page_type=gate_type
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary=summary, action='error',
            details=f'{suffix} creation failed: {str(e)}',
            page_type=gate_type
        )


def recreate_gate_page(confluence: ConfluenceClient,
                       page_id: str, jira_key: str, summary: str,
                       team: str, version: str, fix_version: str,
                       server_id: str, gate_type: str,
                       template_config: dict,
                       team_info: dict | None = None) -> PageAction:
    """Overwrite an existing gate page body with freshly rendered content from the current template.

    Title and labels are preserved. Only the body is replaced.
    Use this to apply checklist item reordering or template edits to already-created pages.
    """
    suffix = GATE_PAGE_SUFFIXES.get(gate_type, gate_type)
    try:
        page = confluence.get_page_by_id(page_id, expand='body.storage,version,metadata.labels')
        version_num = page.get('version', {}).get('number', 1)
        title = page.get('title', '')

        body = render_gate_page(
            gate_type=gate_type,
            jira_key=jira_key,
            team=team,
            version=version,
            fix_version=fix_version,
            server_id=server_id,
            config=template_config,
            summary=summary or '',
            team_info=team_info,
        )

        confluence.update_page(
            page_id=page_id,
            title=title,
            body=body,
            version_number=version_num + 1,
        )
        page_url = confluence.page_url(page)
        return PageAction(
            jira_key=jira_key, summary=summary, action='fixed',
            details=f'{suffix} page recreated from current template',
            page_url=page_url, page_id=page_id,
            page_type=gate_type
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary=summary, action='error',
            details=f'{suffix} recreate failed: {str(e)}',
            page_type=gate_type
        )


def fix_container(confluence: ConfluenceClient, space_key: str,
                  execution_folder_id: str, page_id: str,
                  jira_key: str, summary: str,
                  team: str, version: str, title_pattern: str,
                  tag: str,
                  detected_issues: list | None = None) -> PageAction:
    """Fix a container page's title, parent, and tags.

    Only performs fixes that were detected during scan. If detected_issues is
    provided, only title/parent/tag fixes corresponding to flagged issues are
    applied. This prevents accidental renames when only a label is missing.
    """
    has_title_issue = detected_issues is None or any('Title:' in i for i in detected_issues)
    has_parent_issue = detected_issues is None or any('Wrong parent' in i for i in detected_issues)
    has_tag_issue = detected_issues is None or any('Missing tag' in i for i in detected_issues)

    try:
        fixes = []
        page = confluence.get_page_by_id(page_id, expand='version,metadata.labels,ancestors')

        if has_title_issue:
            expected_title = sanitize_title(
                format_page_title(title_pattern, team=team, version=version,
                                  jira_key=jira_key, summary=summary)
            )
            if page['title'] != expected_title:
                existing = confluence.get_page_by_title(space_key, expected_title)
                if existing and str(existing['id']) != str(page_id):
                    page_id = existing['id']
                    page = existing
                    fixes.append('Switched to existing page with correct title')
                else:
                    page = confluence.rename_page(page_id, expected_title)
                    fixes.append(f"Renamed")

        if has_parent_issue:
            ancestors = page.get('ancestors', [])
            if ancestors and ancestors[-1]['id'] != execution_folder_id:
                page = confluence.move_page(page_id, execution_folder_id)
                fixes.append('Moved')

        if has_tag_issue:
            labels = [l['name'] for l in page.get('metadata', {}).get('labels', {}).get('results', [])]
            if tag not in labels:
                confluence.add_labels(page_id, [tag])
                fixes.append(f"Tagged '{tag}'")

        return PageAction(
            jira_key=jira_key, summary=summary, action='fixed',
            details='; '.join(fixes) if fixes else 'No fixes needed',
            page_url=confluence.page_url(page), page_id=page_id,
            page_type='container'
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary=summary, action='error',
            details=f'Fix failed: {str(e)}', page_id=page_id,
            page_type='container'
        )


def fix_gate_page(confluence: ConfluenceClient, page_id: str,
                  jira_key: str, summary: str,
                  team: str, version: str,
                  tag: str, gate_type: str,
                  container_id: str = None) -> PageAction:
    """Fix a gate sub-page: optionally move under correct container, then fix tags (container tag + gate-specific tag)."""
    suffix = GATE_PAGE_SUFFIXES.get(gate_type, gate_type)
    gate_tag = generate_tag(team, version, GATE_TYPES[gate_type]['suffix'])

    try:
        fixes = []
        page = confluence.get_page_by_id(page_id, expand='version,metadata.labels,ancestors')
        ancestors = page.get('ancestors', [])
        current_parent_id = ancestors[-1]['id'] if ancestors else None

        if container_id and current_parent_id != container_id:
            page = confluence.move_page(page_id, container_id)
            fixes.append('Moved under container')

        labels = [l['name'] for l in page.get('metadata', {}).get('labels', {}).get('results', [])]
        missing_labels = []
        if tag not in labels:
            missing_labels.append(tag)
            fixes.append(f"Tagged '{tag}'")
        if gate_tag not in labels:
            missing_labels.append(gate_tag)
            fixes.append(f"Tagged '{gate_tag}'")
        if missing_labels:
            confluence.add_labels(page_id, missing_labels)

        return PageAction(
            jira_key=jira_key, summary=summary, action='fixed',
            details='; '.join(fixes) if fixes else 'No fixes needed',
            page_url=confluence.page_url(page), page_id=page_id,
            page_type=gate_type
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary=summary, action='error',
            details=f'{suffix} fix failed: {str(e)}', page_id=page_id,
            page_type=gate_type
        )


def gate_page_needs_sync(
    confluence: ConfluenceClient,
    page_id: str,
    team: str,
    version: str,
    gate_type: str,
) -> bool:
    """Check if a gate page needs sync. Fetches the page body — prefer using
    the pre-computed needs_sync flag from scan_tickets() to avoid this call."""
    try:
        page = confluence.get_page_by_id(page_id, expand='body.storage')
        body = (page.get('body') or {}).get('storage', {}).get('value', '') or ''
        return _compute_needs_sync(body, gate_type, team, version)
    except Exception:
        return False


def _sync_team_table(body: str, jira_key: str, server_id: str) -> tuple[str, bool]:
    """Replace old static team table with JIRA macro version. Returns (new_body, changed)."""
    if not has_static_team_table(body):
        return body, False

    team_h2_idx = body.index('<h2>Team</h2>')
    # Find the section heading (<h1>) preceding <h2>Team</h2>
    h1_start = body.rfind('<h1>', 0, team_h2_idx)
    if h1_start == -1:
        return body, False
    h1_end = body.find('</h1>', h1_start)
    if h1_end == -1:
        return body, False
    section_title_raw = body[h1_start + 4:h1_end]

    # Find the static <table> after <h2>Team</h2>
    table_start = body.find('<table', team_h2_idx)
    if table_start == -1:
        return body, False
    table_end = body.find('</table>', table_start)
    if table_end == -1:
        return body, False
    table_end += len('</table>')

    replacement = get_team_table_jira_macro(
        jira_key=jira_key, server_id=server_id,
        section_title=section_title_raw,
    )
    new_body = body[:h1_start] + replacement + body[table_end:]
    return new_body, True


def _sync_merge_summary(body: str, jira_key: str, server_id: str,
                        template_config: dict | None = None) -> tuple[str, bool]:
    """Merge separate Key Dates + Team sections into a single Summary JIRA macro.

    Finds '<h1>Key Dates</h1>...(jira macro)...' and
    '<h1>...Summary...</h1><h2>Team</h2>...(jira macro)...'
    and replaces both with one merged Summary section.
    Returns (new_body, changed).
    """
    if not has_separate_key_dates_and_team(body):
        return body, False

    summary_section = None
    if template_config:
        sections = {s['id']: s for s in template_config.get('sections', [])}
        summary_section = sections.get('summary')

    if not summary_section:
        from src.template_data import get_default_config
        gate_type = (template_config or {}).get('gate_type', 'cg')
        default_cfg = get_default_config(gate_type)
        sections = {s['id']: s for s in default_cfg.get('sections', [])}
        summary_section = sections.get('summary', {
            'title': 'Summary',
            'date_columns': [],
        })

    replacement = get_summary_section_html(
        jira_key=jira_key, server_id=server_id,
        config_section=summary_section,
    )

    # --- Replace Key Dates block with merged Summary ---
    kd_match = re.search(
        r'<h1>\s*Key Dates\s*</h1>\s*<p>\s*'
        r'<ac:structured-macro ac:name="jira"[^>]*>.*?</ac:structured-macro>'
        r'\s*</p>',
        body, re.DOTALL | re.IGNORECASE,
    )
    if not kd_match:
        return body, False

    new_body = body[:kd_match.start()] + replacement + body[kd_match.end():]

    # --- Remove the now-redundant Team block ---
    # Heading is always something like "CG Summary - Team" or "Summary - Team"
    # The Team content may be a JIRA macro (already upgraded) or a static table (old format).
    team_match = re.search(
        r'<h1>[^<]*</h1>\s*<h2>\s*Team\s*</h2>\s*(?:'
        r'<p>\s*<ac:structured-macro ac:name="jira"[^>]*>.*?</ac:structured-macro>\s*</p>'
        r'|'
        r'<table[^>]*>.*?</table>'
        r')',
        new_body, re.DOTALL | re.IGNORECASE,
    )
    if not team_match:
        return body, False

    new_body = new_body[:team_match.start()] + new_body[team_match.end():]
    return new_body, True


def _sync_summary_key_to_jql(body: str, jira_key: str, server_id: str,
                             template_config: dict | None = None) -> tuple[str, bool]:
    """Upgrade a Summary section that uses a key-based JIRA macro (compact link)
    to the JQL table macro (full table with visible columns).
    Returns (new_body, changed).
    """
    if not has_summary_with_key_macro(body):
        return body, False

    summary_section = None
    if template_config:
        sections = {s['id']: s for s in template_config.get('sections', [])}
        summary_section = sections.get('summary')

    if not summary_section:
        from src.template_data import get_default_config
        gate_type = (template_config or {}).get('gate_type', 'cg')
        default_cfg = get_default_config(gate_type)
        sections = {s['id']: s for s in default_cfg.get('sections', [])}
        summary_section = sections.get('summary', {
            'title': 'Summary',
            'date_columns': [],
        })

    summary_match = re.search(
        r'<h1>[^<]*Summary[^<]*</h1>\s*<p>\s*'
        r'<ac:structured-macro ac:name="jira"[^>]*>.*?</ac:structured-macro>'
        r'\s*</p>',
        body, re.DOTALL | re.IGNORECASE,
    )
    if not summary_match:
        return body, False

    replacement = get_summary_section_html(
        jira_key=jira_key, server_id=server_id,
        config_section=summary_section,
    )
    new_body = body[:summary_match.start()] + replacement + body[summary_match.end():]
    return new_body, True


def sync_gate_page_content(
    confluence: ConfluenceClient,
    page_id: str,
    jira_key: str,
    server_id: str,
    team: str,
    version: str,
    gate_type: str,
    template_config: dict | None = None,
) -> PageAction:
    """Sync a gate page with the latest template.

    Handles three types of sync:
    - Summary merge: replaces separate Key Dates + Team sections with one JIRA macro.
    - Team table upgrade: replaces old static team table with JIRA macro (all gate types).
    - Gate Commitments: adds missing block or columns (CG pages only).
    """
    try:
        page = confluence.get_page_by_id(page_id, expand='body.storage,version')
        body = (page.get('body') or {}).get('storage', {}).get('value', '') or ''
        version_num = page.get('version', {}).get('number', 1)
        title = page.get('title', '')

        new_body = body
        changed = False
        sync_details = []

        # --- Sync 1: Merge separate Key Dates + Team into single Summary ---
        new_body, merged = _sync_merge_summary(new_body, jira_key, server_id, template_config)
        if merged:
            changed = True
            sync_details.append('merged Key Dates + Team into single Summary')

        # --- Sync 2: Upgrade key-based Summary macro to JQL table macro ---
        new_body, key_upgraded = _sync_summary_key_to_jql(new_body, jira_key, server_id, template_config)
        if key_upgraded:
            changed = True
            sync_details.append('upgraded Summary to table format')

        # --- Sync 3: Replace static team table with JIRA macro (any gate type) ---
        new_body, team_changed = _sync_team_table(new_body, jira_key, server_id)
        if team_changed:
            changed = True
            sync_details.append('upgraded team table to JIRA macro')

        # --- Sync 4: Gate Commitments (CG only) ---
        if gate_type == 'cg':
            expected_ids = get_expected_macro_ids(team, version, 'cg')
            cg_text_id = next((i for i in expected_ids if 'cg-text-summary' in i), None)
            checklist_id = next((i for i in expected_ids if 'cg-checklist' in i and 'serv' not in i), None)

            if cg_text_id and checklist_id:
                if cg_text_id not in new_body:
                    block = get_gate_commitments_block(jira_key, server_id, team, version)
                    marker = f'<ac:parameter ac:name="id">{checklist_id}</ac:parameter>'
                    idx = new_body.find(marker)
                    gc_inserted = False
                    if idx != -1:
                        macro_start = new_body.rfind('<ac:structured-macro', 0, idx)
                        if macro_start != -1:
                            new_body = new_body[:macro_start] + block + '\n' + new_body[macro_start:]
                            gc_inserted = True
                    if not gc_inserted:
                        new_body = new_body.rstrip() + '\n\n' + block + '\n'
                    changed = True
                    sync_details.append('added missing Gate Commitments block')
                else:
                    expected_cols = len(GATE_COMMITMENTS_HEADERS)
                    id_param = re.escape(f'<ac:parameter ac:name="id">{cg_text_id}</ac:parameter>')
                    macro_match = re.search(
                        rf'<ac:structured-macro\s+ac:name="details"[^>]*>.*?{id_param}.*?<ac:rich-text-body>(.*?)</ac:rich-text-body>.*?</ac:structured-macro>',
                        new_body,
                        re.DOTALL | re.IGNORECASE,
                    )
                    if macro_match:
                        inner = macro_match.group(1)
                        table_match = re.search(r'<table[^>]*class="wrapped"[^>]*>(.*?)</table>', inner, re.DOTALL | re.IGNORECASE)
                        if table_match:
                            table_html = table_match.group(0)
                            tbody_match = re.search(r'<tbody>(.*?)</tbody>', table_html, re.DOTALL | re.IGNORECASE)
                            if tbody_match:
                                tbody = tbody_match.group(1)
                                first_row = re.search(r'<tr>(.*?)</tr>', tbody, re.DOTALL)
                                if first_row:
                                    header_cells = re.findall(r'<th[^>]*>', first_row.group(0))
                                    current_cols = len(header_cells)
                                    if 0 < current_cols < expected_cols:
                                        append_headers = ''.join(
                                            f'<th>{html.escape(h)}</th>' for h in GATE_COMMITMENTS_HEADERS[current_cols:]
                                        )
                                        append_cells = ''.join(
                                            get_gate_commitments_default_cell_for_column(i)
                                            for i in range(current_cols - 1, expected_cols - 1)
                                        )
                                        new_tbody = tbody.replace('</tr>', append_headers + '</tr>', 1)
                                        pos = new_tbody.find('</tr>') + len('</tr>')
                                        while True:
                                            tr_start = new_tbody.find('<tr>', pos)
                                            if tr_start == -1:
                                                break
                                            tr_end = new_tbody.find('</tr>', tr_start)
                                            if tr_end == -1:
                                                break
                                            new_tbody = new_tbody[:tr_end] + append_cells + new_tbody[tr_end:]
                                            pos = tr_end + len(append_cells) + len('</tr>')
                                        new_table = table_html.replace(
                                            tbody_match.group(0),
                                            '<tbody>' + new_tbody + '</tbody>',
                                            1,
                                        )
                                        new_inner = inner.replace(table_html, new_table, 1)
                                        new_macro = macro_match.group(0).replace(inner, new_inner, 1)
                                        new_body = new_body.replace(macro_match.group(0), new_macro, 1)
                                        changed = True
                                        sync_details.append('added missing Gate Commitments columns')

        if not changed:
            return PageAction(
                jira_key=jira_key, summary='', action='fixed',
                details='No content sync needed (page already has full template structure).',
                page_url=confluence.page_url(page), page_id=page_id,
                page_type=gate_type,
            )
        updated = confluence.update_page(
            page_id=page_id,
            title=title,
            body=new_body,
            version_number=version_num + 1,
        )
        return PageAction(
            jira_key=jira_key, summary='', action='fixed',
            details=f'Synced: {"; ".join(sync_details)}.',
            page_url=confluence.page_url(updated), page_id=page_id,
            page_type=gate_type,
        )
    except Exception as e:
        return PageAction(
            jira_key=jira_key, summary='', action='error',
            details=f'Sync content failed: {str(e)}',
            page_id=page_id, page_type=gate_type,
        )


def list_cleanup_issues(confluence: ConfluenceClient, execution_folder_id: str,
                        space_key: str, team: str, version: str,
                        title_pattern: str,
                        ticket_statuses: list,
                        fetched_jira_keys: set) -> tuple[list, list]:
    """Find pages under Execution that need cleanup: misplaced gate pages and orphan containers.

    Returns (misplaced_gates: list of CleanupItem, orphan_containers: list of CleanupItem).
    - Misplaced gate: gate page (Code Complete / CG / PG) that is a direct child of Execution instead of under its container.
    - Orphan container: container-shaped page (JIRA key in title) under Execution not in fetched_jira_keys.
    """
    misplaced_gates = []
    orphan_containers = []
    children = confluence.get_child_pages(execution_folder_id, expand='version,metadata.labels,ancestors')
    key_to_container_id = {ts.jira_key: ts.container_id for ts in ticket_statuses if ts.container_id}

    for child in children:
        title = child['title']
        jira_key = extract_jira_key_from_title(title)
        ancestors = child.get('ancestors', [])
        parent_id = ancestors[-1]['id'] if ancestors else None

        # Gate page (has suffix like " - Code Complete")
        for gate_type, suffix in GATE_PAGE_SUFFIXES.items():
            if f' - {suffix}' in title or suffix.lower() in title.lower():
                if parent_id == execution_folder_id:
                    container_id = key_to_container_id.get(jira_key or '') if jira_key else ''
                    misplaced_gates.append(CleanupItem(
                        page_id=child['id'],
                        title=title,
                        jira_key=jira_key or '',
                        item_type='misplaced_gate',
                        gate_type=gate_type,
                        container_id=container_id,
                        page_url=confluence.page_url(child)
                    ))
                break
        else:
            # Not a gate page: treat as possible container
            if jira_key and jira_key not in fetched_jira_keys:
                orphan_containers.append(CleanupItem(
                    page_id=child['id'],
                    title=title,
                    jira_key=jira_key,
                    item_type='orphan_container',
                    page_url=confluence.page_url(child)
                ))

    return misplaced_gates, orphan_containers


def validate_page_macro_ids(confluence: ConfluenceClient, page_id: str,
                            team: str, version: str, gate_type: str) -> list:
    """Check that the page body contains expected macro IDs. Returns list of missing IDs."""
    try:
        page = confluence.get_page_by_id(page_id, expand='body.storage')
        body = page.get('body', {}).get('storage', {}).get('value', '') or ''
    except Exception:
        return []
    # Extract all ac:parameter name="id" values
    id_pattern = re.compile(r'<ac:parameter\s+ac:name="id">([^<]*)</ac:parameter>', re.IGNORECASE)
    found_ids = set(id_pattern.findall(body))
    expected = get_expected_macro_ids(team, version, gate_type)
    return [e for e in expected if e not in found_ids]


def _confluence_page_id_from_url(url: str) -> str | None:
    """Extract Confluence page ID from a link URL (viewpage.action?pageId= or /pages/123/)."""
    if not url:
        return None
    # viewpage.action?pageId=123456 or ?pageId=123456
    m = re.search(r'[?&]pageId=(\d+)', url, re.IGNORECASE)
    if m:
        return m.group(1)
    # /pages/123456/ or /pages/123456
    m = re.search(r'/pages/(\d+)(?:/|$)', url)
    if m:
        return m.group(1)
    return None


@dataclass
class LinkedConfluencePage:
    """A Confluence page linked from a JIRA issue (remote link)."""
    page_id: str
    title: str
    url: str
    exists: bool = True  # True if we confirmed the page exists in this Confluence instance


def linked_pages_not_under_container(confluence: ConfluenceClient,
                                     container_id: str,
                                     linked: list[LinkedConfluencePage]) -> list[LinkedConfluencePage]:
    """Return only linked pages that are not already children of the given container."""
    try:
        children = confluence.get_child_pages(container_id)
        child_ids = {str(c['id']) for c in children}
    except Exception:
        child_ids = set()
    return [p for p in linked if str(p.page_id) not in child_ids]


def get_linked_confluence_pages(jira_client, confluence: ConfluenceClient,
                                 issue_key: str) -> list[LinkedConfluencePage]:
    """Return Confluence pages linked from the JIRA issue (remote links) that exist in this Confluence.

    Only returns pages whose URL contains a Confluence pageId and that exist in the Confluence instance.
    """
    out = []
    try:
        links = jira_client.get_remote_links(issue_key)
    except Exception:
        return out
    seen_ids = set()
    for link in links:
        url = link.get('url') or ''
        title = (link.get('title') or url).strip()
        page_id = _confluence_page_id_from_url(url)
        if not page_id or page_id in seen_ids:
            continue
        seen_ids.add(page_id)
        exists = False
        page_title = title
        try:
            page_data = confluence.get_page_by_id(page_id, expand='version')
            exists = True
            page_title = page_data.get('title') or title
        except Exception:
            pass
        out.append(LinkedConfluencePage(
            page_id=page_id,
            title=page_title or f"Page {page_id}",
            url=url,
            exists=exists
        ))
    return out


def move_linked_pages_under_container(confluence: ConfluenceClient,
                                      linked: list[LinkedConfluencePage],
                                      container_id: str,
                                      jira_key: str) -> list[PageAction]:
    """Move Confluence pages (from JIRA remote links) under the feature container. Returns list of PageAction."""
    results = []
    for item in linked:
        if not item.exists:
            continue
        try:
            moved_page = confluence.move_page(item.page_id, container_id)
            results.append(PageAction(
                jira_key=jira_key,
                summary='',
                action='fixed',
                details=f"Moved '{item.title}' under container",
                page_url=confluence.page_url(moved_page),
                page_id=item.page_id,
                page_type=''
            ))
        except Exception as e:
            results.append(PageAction(
                jira_key=jira_key,
                summary='',
                action='error',
                details=f"Move failed for {item.title}: {e}",
                page_id=item.page_id,
                page_type=''
            ))
    return results
