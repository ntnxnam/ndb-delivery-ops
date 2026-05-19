import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class ConfluenceClient:
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
            resp = self.session.get(f'{self.base_url}/rest/api/user/current')
            if resp.status_code == 200:
                user = resp.json()
                return True, user.get('displayName', user.get('username', 'Unknown'))
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as e:
            return False, str(e)

    def get_page_by_id(self, page_id: str, expand: str = 'version,metadata.labels') -> dict:
        resp = self.session.get(
            f'{self.base_url}/rest/api/content/{page_id}',
            params={'expand': expand}
        )
        resp.raise_for_status()
        return resp.json()

    def get_page_by_title(self, space_key: str, title: str, expand: str = 'version,metadata.labels') -> dict | None:
        resp = self.session.get(
            f'{self.base_url}/rest/api/content',
            params={
                'spaceKey': space_key,
                'title': title,
                'expand': expand
            }
        )
        resp.raise_for_status()
        results = resp.json().get('results', [])
        return results[0] if results else None

    def get_child_pages(self, parent_id: str, expand: str = 'version,metadata.labels') -> list:
        pages = []
        start = 0
        limit = 200

        while True:
            resp = self.session.get(
                f'{self.base_url}/rest/api/content/{parent_id}/child/page',
                params={'expand': expand, 'start': start, 'limit': limit}
            )
            resp.raise_for_status()
            data = resp.json()
            pages.extend(data.get('results', []))
            if data.get('size', 0) < limit:
                break
            start += limit

        return pages

    def search_pages(self, cql: str, expand: str = 'version,metadata.labels,ancestors') -> list:
        pages = []
        start = 0
        limit = 200

        while True:
            resp = self.session.get(
                f'{self.base_url}/rest/api/content/search',
                params={'cql': cql, 'expand': expand, 'start': start, 'limit': limit}
            )
            resp.raise_for_status()
            data = resp.json()
            pages.extend(data.get('results', []))
            if data.get('size', 0) < limit:
                break
            start += limit

        return pages

    def create_page(self, space_key: str, title: str, body: str,
                    parent_id: str = None, labels: list = None) -> dict:
        payload = {
            'type': 'page',
            'title': title,
            'space': {'key': space_key},
            'body': {
                'storage': {
                    'value': body,
                    'representation': 'storage'
                }
            }
        }

        if parent_id:
            payload['ancestors'] = [{'id': parent_id}]

        resp = self.session.post(
            f'{self.base_url}/rest/api/content',
            json=payload
        )
        if not resp.ok:
            detail = resp.text[:500] if resp.text else ''
            raise Exception(f"Confluence API {resp.status_code}: {detail}")
        page = resp.json()

        if labels:
            self.add_labels(page['id'], labels)

        return page

    def update_page(self, page_id: str, title: str, body: str,
                    version_number: int, parent_id: str = None) -> dict:
        payload = {
            'type': 'page',
            'title': title,
            'version': {'number': version_number},
            'body': {
                'storage': {
                    'value': body,
                    'representation': 'storage'
                }
            }
        }

        if parent_id:
            payload['ancestors'] = [{'id': parent_id}]

        resp = self.session.put(
            f'{self.base_url}/rest/api/content/{page_id}',
            json=payload
        )
        if not resp.ok:
            detail = resp.text[:500] if resp.text else ''
            raise Exception(f"Confluence API {resp.status_code}: {detail}")
        return resp.json()

    def add_labels(self, page_id: str, labels: list) -> dict:
        payload = [{'name': label, 'prefix': 'global'} for label in labels]
        resp = self.session.post(
            f'{self.base_url}/rest/api/content/{page_id}/label',
            json=payload
        )
        resp.raise_for_status()
        return resp.json()

    def get_labels(self, page_id: str) -> list:
        resp = self.session.get(
            f'{self.base_url}/rest/api/content/{page_id}/label'
        )
        resp.raise_for_status()
        return resp.json().get('results', [])

    def remove_label(self, page_id: str, label_name: str):
        resp = self.session.delete(
            f'{self.base_url}/rest/api/content/{page_id}/label/{label_name}'
        )
        resp.raise_for_status()

    def move_page(self, page_id: str, new_parent_id: str) -> dict:
        page = self.get_page_by_id(page_id, expand='body.storage,version')
        return self.update_page(
            page_id=page_id,
            title=page['title'],
            body=page['body']['storage']['value'],
            version_number=page['version']['number'] + 1,
            parent_id=new_parent_id
        )

    def rename_page(self, page_id: str, new_title: str) -> dict:
        page = self.get_page_by_id(page_id, expand='body.storage,version')
        return self.update_page(
            page_id=page_id,
            title=new_title,
            body=page['body']['storage']['value'],
            version_number=page['version']['number'] + 1
        )

    def page_url(self, page: dict) -> str:
        if '_links' in page and 'webui' in page['_links']:
            return f"{self.base_url}{page['_links']['webui']}"
        return f"{self.base_url}/pages/viewpage.action?pageId={page['id']}"
