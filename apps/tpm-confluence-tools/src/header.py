"""
Header component for the Confluence Page Creator application.
Provides navigation, authentication status, and logout functionality.
"""

import streamlit as st
from src.auth_manager import auth_manager
from src.styles import load_custom_css


def render_header():
    """Render the application header with navigation and authentication controls."""
    
    # Load custom CSS
    load_custom_css()
    
    # Try auto-connection on first load
    if not st.session_state.get('_auth_checked', False):
        auth_manager.auto_connect()
        st.session_state._auth_checked = True
    
    # Compact header
    header_col1, header_col2 = st.columns([0.7, 0.3])
    
    with header_col1:
        st.markdown("**Confluence Page Creator**")
        
        # Compact navigation (only show if authenticated)
        if auth_manager.is_authenticated():
            nav_col1, nav_col2, nav_col3, nav_col4 = st.columns(4)
            
            with nav_col1:
                if st.button("Home", key="nav_home", use_container_width=True):
                    st.switch_page("app.py")
            
            with nav_col2:
                if st.button("Dashboard", key="nav_dashboard", use_container_width=True):
                    st.switch_page("pages/1_Dashboard.py")
            
            with nav_col3:
                if st.button("Templates", key="nav_template", use_container_width=True):
                    st.switch_page("pages/2_Template_Editor.py")
            
            with nav_col4:
                if st.button("Team & Release", key="nav_team", use_container_width=True):
                    st.switch_page("pages/3_Team_Release.py")
    
    with header_col2:
        if auth_manager.is_authenticated():
            user_info = auth_manager.get_user_info()
            
            # Compact user info
            st.caption(f"**{user_info['display_name']}**")
            st.caption("Connected")
            
            if st.button("Logout", key="header_logout", type="secondary", use_container_width=True):
                auth_manager.logout()
                st.success("Logged out")
                st.rerun()
        else:
            st.caption("**Not Connected**")
            
            if st.button("Login", key="header_login", type="primary", use_container_width=True):
                st.switch_page("app.py")
    
    st.divider()


def check_authentication():
    """
    Check authentication and show appropriate UI.
    Returns True if authenticated, False otherwise.
    """
    if not auth_manager.is_authenticated():
        st.warning("Authentication required")
        
        col1, col2, col3 = st.columns([1, 1, 1])
        with col2:
            if st.button("Login", type="primary", use_container_width=True):
                st.switch_page("app.py")
        
        return False
    
    return True


def render_connection_status():
    """Render connection status in sidebar."""
    if auth_manager.is_authenticated():
        user_info = auth_manager.get_user_info()
        
        st.sidebar.success("Connected")
        with st.sidebar.expander("Details", expanded=False):
            st.caption(f"JIRA: {user_info['jira_user']}")
            st.caption(f"Confluence: {user_info['confluence_user']}")
    else:
        st.sidebar.warning("Not Connected")
        if st.sidebar.button("Connect", key="sidebar_connect", use_container_width=True):
            st.switch_page("app.py")