"""
Diagnostic utilities for the Confluence Page Creator application.
Helps users troubleshoot common issues and check system status.
"""

import streamlit as st
import json
from pathlib import Path
from src.auth_manager import auth_manager


def run_diagnostics():
    """Run diagnostic checks and display results."""
    
    st.subheader("🔍 System Diagnostics")
    
    # Check 1: Credentials file
    cred_path = Path(__file__).parent.parent / '.credentials.json'
    
    if cred_path.exists():
        st.success("✅ Credentials file found")
        try:
            creds = json.loads(cred_path.read_text())
            required_keys = ['jira_url', 'jira_pat', 'confluence_url', 'confluence_pat']
            missing_keys = [key for key in required_keys if key not in creds]
            
            if not missing_keys:
                st.success("✅ All required credential fields present")
            else:
                st.warning(f"⚠️ Missing credential fields: {missing_keys}")
        except Exception as e:
            st.error(f"❌ Error reading credentials: {e}")
    else:
        st.info("ℹ️ No saved credentials found (this is normal for first-time users)")
    
    # Check 2: Authentication status
    if auth_manager.is_authenticated():
        st.success("✅ Currently authenticated")
        user_info = auth_manager.get_user_info()
        st.write(f"**User:** {user_info['display_name']}")
        st.write(f"**JIRA:** {user_info['jira_url']}")
        st.write(f"**Confluence:** {user_info['confluence_url']}")
    else:
        st.warning("⚠️ Not currently authenticated")
    
    # Check 3: Session state
    st.subheader("📊 Session State")
    auth_keys = [
        'authenticated', 'jira_client', 'confluence_client', 
        'user_display_name', 'jira_user', 'confluence_user'
    ]
    
    for key in auth_keys:
        value = st.session_state.get(key)
        if value is not None:
            if key.endswith('_client'):
                st.write(f"**{key}:** Connected")
            else:
                st.write(f"**{key}:** {value}")
        else:
            st.write(f"**{key}:** Not set")
    
    # Check 4: Configuration files
    st.subheader("⚙️ Configuration Files")
    config_files = [
        'config/teams.json',
        'config/template_overrides.json',
        'config/last_workflow_state.json'
    ]
    
    for config_file in config_files:
        config_path = Path(__file__).parent.parent / config_file
        if config_path.exists():
            st.success(f"✅ {config_file}")
        else:
            st.warning(f"⚠️ {config_file} not found")
    
    # Actions
    st.subheader("🔧 Actions")
    
    col1, col2 = st.columns(2)
    
    with col1:
        if st.button("🔄 Clear All Session Data", type="secondary", use_container_width=True):
            # Clear all session state
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.success("Session data cleared")
            st.rerun()
    
    with col2:
        if st.button("🗑️ Clear Saved Credentials", type="secondary", use_container_width=True):
            auth_manager.clear_credentials()
            st.success("Credentials cleared")
            st.rerun()


def show_connection_help():
    """Show help for connection issues."""
    
    st.subheader("🆘 Connection Troubleshooting")
    
    st.markdown("""
    **Common Issues:**
    
    1. **Invalid URL Format**
       - Ensure URLs start with `https://` or `http://`
       - Remove trailing slashes from URLs
       - Example: `https://jira.company.com` (not `https://jira.company.com/`)
    
    2. **Personal Access Token Issues**
       - Tokens should not have spaces or special characters at the beginning/end
       - Make sure you copied the entire token
       - Check that the token hasn't expired
    
    3. **Network/Firewall Issues**
       - Ensure your network allows access to JIRA/Confluence
       - Try accessing the URLs in your browser first
       - Check if VPN is required
    
    4. **Permission Issues**
       - Verify your account has access to the JIRA project
       - Check Confluence space permissions
       - Ensure API access is enabled for your account
    
    **Getting Help:**
    - Check with your IT administrator for correct URLs
    - Verify your account permissions with your team lead
    - Try creating a new Personal Access Token if the old one isn't working
    """)


def export_session_info():
    """Export session information for debugging."""
    
    st.subheader("📤 Export Session Info")
    
    if st.button("Generate Debug Info", use_container_width=True):
        debug_info = {
            'timestamp': st.session_state.get('_timestamp', 'unknown'),
            'authenticated': st.session_state.get('authenticated', False),
            'has_jira_client': st.session_state.get('jira_client') is not None,
            'has_confluence_client': st.session_state.get('confluence_client') is not None,
            'user_display_name': st.session_state.get('user_display_name', 'unknown'),
            'jira_url': st.session_state.get('jira_url', 'unknown'),
            'confluence_url': st.session_state.get('confluence_url', 'unknown'),
            'session_keys': list(st.session_state.keys())
        }
        
        st.code(json.dumps(debug_info, indent=2), language='json')
        st.caption("⚠️ Do not share this information publicly as it may contain sensitive data")