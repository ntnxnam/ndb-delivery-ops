import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class JiraClient:
    def __init__(self, base_url: str, pat: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {pat}',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })
        self.session.verify = False

    def test_connection(self) -> tuple[bool, str]:
        try:
            resp = self.session.get(f'{self.base_url}/rest/api/2/myself')
            if resp.status_code == 200:
                user = resp.json()
                return True, user.get('displayName', user.get('name', 'Unknown'))
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as e:
            return False, str(e)

    def get_fix_versions(self, project_key: str) -> list:
        resp = self.session.get(
            f'{self.base_url}/rest/api/2/project/{project_key}/versions'
        )
        resp.raise_for_status()
        versions = resp.json()
        return sorted(
            [v for v in versions if not v.get('released', False) and not v.get('archived', False)],
            key=lambda v: v.get('name', '')
        )

    def search_issues(self, jql: str, fields: str = 'key,summary,assignee,reporter,components,status,issuetype') -> list:
        issues = []
        start_at = 0
        max_results = 50

        while True:
            resp = self.session.get(
                f'{self.base_url}/rest/api/2/search',
                params={
                    'jql': jql,
                    'startAt': start_at,
                    'maxResults': max_results,
                    'fields': fields
                }
            )
            resp.raise_for_status()
            data = resp.json()
            issues.extend(data.get('issues', []))

            if start_at + max_results >= data.get('total', 0):
                break
            start_at += max_results

        return issues

    def get_issue(self, issue_key: str, fields: str = None) -> dict:
        params = {}
        if fields:
            params['fields'] = fields
        resp = self.session.get(
            f'{self.base_url}/rest/api/2/issue/{issue_key}',
            params=params
        )
        resp.raise_for_status()
        return resp.json()

    def get_remote_links(self, issue_key: str) -> list[dict]:
        """Return remote links for an issue (e.g. Confluence page links).

        Each item has: id, url, title (from object.url and object.title).
        """
        resp = self.session.get(
            f'{self.base_url}/rest/api/2/issue/{issue_key}/remotelink'
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        links = resp.json() if isinstance(resp.json(), list) else []
        out = []
        for link in links:
            obj = link.get('object') or {}
            url = (obj.get('url') or '').strip()
            title = (obj.get('title') or url or '').strip()
            out.append({'id': link.get('id'), 'url': url, 'title': title})
        return out

    def get_custom_fields(self) -> list[dict]:
        """Fetch all custom field definitions from the JIRA instance.

        Returns a list of dicts with keys: id, name, description, type.
        """
        resp = self.session.get(f'{self.base_url}/rest/api/2/field')
        resp.raise_for_status()
        fields = []
        for f in resp.json():
            if f.get('custom', False):
                fields.append({
                    'id': f['id'],
                    'name': f.get('name', f['id']),
                    'description': f.get('description') or '',
                    'type': f.get('schema', {}).get('custom', ''),
                })
        return sorted(fields, key=lambda x: x['name'].lower())
