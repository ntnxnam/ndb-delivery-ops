"""
Authentication manager for the Confluence Page Creator application.
Handles centralized authentication state, persistent sessions, and login/logout functionality.
"""

import json
import streamlit as st
from pathlib import Path
from typing import Optional, Tuple, Dict, Any


class AuthManager:
    """Centralized authentication manager for the application."""
    
    def __init__(self):
        self.cred_path = Path(__file__).parent.parent / '.credentials.json'
        self._initialize_session_state()
    
    def _initialize_session_state(self):
        """Initialize authentication-related session state variables."""
        if 'authenticated' not in st.session_state:
            st.session_state.authenticated = False
        if 'jira_client' not in st.session_state:
            st.session_state.jira_client = None
        if 'confluence_client' not in st.session_state:
            st.session_state.confluence_client = None
        if 'user_display_name' not in st.session_state:
            st.session_state.user_display_name = None
        if 'jira_user' not in st.session_state:
            st.session_state.jira_user = None
        if 'confluence_user' not in st.session_state:
            st.session_state.confluence_user = None
    
    def save_credentials(self, jira_url: str, jira_pat: str, confluence_url: str, confluence_pat: str):
        """Save credentials to encrypted file."""
        credentials = {
            'jira_url': jira_url,
            'jira_pat': jira_pat,
            'confluence_url': confluence_url,
            'confluence_pat': confluence_pat,
        }
        self.cred_path.write_text(json.dumps(credentials))
    
    def load_credentials(self) -> Optional[Dict[str, str]]:
        """Load saved credentials from file."""
        if self.cred_path.exists():
            try:
                return json.loads(self.cred_path.read_text())
            except (json.JSONDecodeError, OSError):
                return None
        return None
    
    def clear_credentials(self):
        """Remove saved credentials file."""
        if self.cred_path.exists():
            self.cred_path.unlink()
    
    def connect(self, jira_url: str, jira_pat: str, confluence_url: str, confluence_pat: str) -> Tuple[bool, str, bool, str]:
        """
        Validate connections and update session state.
        
        Returns:
            Tuple of (jira_success, jira_message, confluence_success, confluence_message)
        """
        from src.jira_client import JiraClient
        from src.confluence_client import ConfluenceClient
        from src.utils import load_custom_fields

        jira = JiraClient(jira_url, jira_pat)
        jira_ok, jira_msg = jira.test_connection()

        confluence = ConfluenceClient(confluence_url, confluence_pat)
        conf_ok, conf_msg = confluence.test_connection()

        if jira_ok and conf_ok:
            # Update session state
            st.session_state.authenticated = True
            st.session_state.jira_client = jira
            st.session_state.confluence_client = confluence
            st.session_state.jira_url = jira_url
            st.session_state.confluence_url = confluence_url
            st.session_state.jira_user = jira_msg
            st.session_state.confluence_user = conf_msg
            
            # Set display name for UI
            if jira_msg and isinstance(jira_msg, str):
                st.session_state.user_display_name = jira_msg.split('@')[0] if '@' in jira_msg else jira_msg
            else:
                st.session_state.user_display_name = 'Unknown User'

            # Load custom fields
            try:
                live_fields = jira.get_custom_fields()
                st.session_state.custom_fields = live_fields
            except Exception:
                st.session_state.custom_fields = load_custom_fields()

        return jira_ok, jira_msg, conf_ok, conf_msg
    
    def auto_connect(self) -> bool:
        """
        Attempt to auto-connect using saved credentials.
        
        Returns:
            True if auto-connection succeeded, False otherwise
        """
        # Ensure session state is initialized first
        self._initialize_session_state()
        
        if st.session_state.authenticated:
            return True
            
        saved = self.load_credentials()
        if not saved:
            return False
            
        try:
            j_ok, j_msg, c_ok, c_msg = self.connect(
                saved['jira_url'], saved['jira_pat'],
                saved['confluence_url'], saved['confluence_pat']
            )
            
            if j_ok and c_ok:
                # Show success message for auto-connection
                if not st.session_state.get('_auto_connect_notified', False):
                    st.toast("🎉 Auto-connected successfully!", icon="✅")
                    st.session_state._auto_connect_notified = True
                return True
            else:
                # Clear invalid credentials
                self.clear_credentials()
                if not st.session_state.get('_auth_failed_notified', False):
                    st.toast("⚠️ Saved credentials expired. Please log in again.", icon="⚠️")
                    st.session_state._auth_failed_notified = True
                return False
        except Exception:
            self.clear_credentials()
            return False
    
    def logout(self):
        """Clear all authentication data and session state."""
        # Clear credentials
        self.clear_credentials()
        
        # Clear authentication session state
        st.session_state.authenticated = False
        st.session_state.jira_client = None
        st.session_state.confluence_client = None
        st.session_state.user_display_name = None
        st.session_state.jira_user = None
        st.session_state.confluence_user = None
        
        # Clear any workflow/app specific session data
        keys_to_clear = [
            'team_select', 'selected_fix_version', 'confluence_space',
            'dash_issues', 'dash_ticket_statuses', 'dash_exec_id',
            'custom_fields', '_stay_on_login'
        ]
        
        for key in keys_to_clear:
            st.session_state.pop(key, None)
        
        # Clear any cached version data
        cache_keys = [k for k in st.session_state.keys() if k.startswith('available_versions_')]
        for key in cache_keys:
            st.session_state.pop(key, None)
    
    def is_authenticated(self) -> bool:
        """Check if user is currently authenticated."""
        self._initialize_session_state()
        return st.session_state.get('authenticated', False)
    
    def get_user_info(self) -> Dict[str, Any]:
        """Get current user information."""
        self._initialize_session_state()
        return {
            'display_name': st.session_state.get('user_display_name', 'Unknown User'),
            'jira_user': st.session_state.get('jira_user', 'Unknown'),
            'confluence_user': st.session_state.get('confluence_user', 'Unknown'),
            'jira_url': st.session_state.get('jira_url', ''),
            'confluence_url': st.session_state.get('confluence_url', ''),
        }
    
    def require_authentication(self, redirect_message: str = "Please log in to access this page."):
        """
        Ensure user is authenticated, redirect to login if not.
        Call this at the top of pages that require authentication.
        """
        if not self.is_authenticated():
            st.warning(redirect_message)
            if st.button("Go to Login", type="primary"):
                st.switch_page("app.py")
            st.stop()


# Global instance for easy access
auth_manager = AuthManager()