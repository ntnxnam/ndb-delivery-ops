import streamlit as st

st.set_page_config(
    page_title="Confluence Page Creator",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Import our new authentication and header components
from src.auth_manager import auth_manager
from src.header import render_header, render_connection_status
from src.utils import load_team_config, load_workflow_state

# Render the header with navigation
render_header()

# Page content
st.markdown("**Bulk-create standardized Confluence pages from JIRA tickets.**")

app_config = load_team_config()
default_jira_url = app_config.get('jira_url', 'https://jira.eng.nutanix.com')
default_confluence_url = app_config.get('confluence_url', 'https://confluence.eng.nutanix.com:8443')

if auth_manager.is_authenticated():
    st.success("✅ Connected to JIRA and Confluence.")
    
    user_info = auth_manager.get_user_info()
    st.info(f"👤 Logged in as: **{user_info['display_name']}**")
    
    # Check if user has configured team and version
    _saved_wf = load_workflow_state()
    has_team_config = _saved_wf.get('team_select') and _saved_wf.get('fix_version_select')
    
    if has_team_config:
        st.success(f"✅ Configured for Team: **{_saved_wf.get('team_select')}**, Version: **{_saved_wf.get('fix_version_select')}**")
        
        # Main workflow options
        st.subheader("🚀 What would you like to do?")
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("📋 View Dashboard", type="primary", use_container_width=True, help="View release dashboard and manage pages"):
                st.switch_page("pages/1_Dashboard.py")
            st.caption("View and manage all feature and gate pages for your release")
        
        with col2:
            if st.button("📝 Edit Templates", use_container_width=True, help="Customize page templates"):
                st.switch_page("pages/2_Template_Editor.py")
            st.caption("Customize gate page templates and checklists")
        
        st.divider()
        
        # Additional options
        col3, col4 = st.columns(2)
        with col3:
            if st.button("⚙️ Change Team/Release", use_container_width=True, help="Change team or release configuration"):
                st.switch_page("pages/3_Team_Release.py")
        
        with col4:
            if st.button("📊 Generate Report", use_container_width=True, help="Generate status reports"):
                st.switch_page("pages/4_Report.py")
    else:
        st.warning("⚠️ **Setup Required:** Please configure your team and release first.")
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("⚙️ Setup Team & Release", type="primary", use_container_width=True):
                st.switch_page("pages/3_Team_Release.py")
            st.caption("Configure your team and select a release version")
        
        with col2:
            if st.button("📝 Edit Templates", use_container_width=True, help="Customize page templates"):
                st.switch_page("pages/2_Template_Editor.py")
            st.caption("Customize templates (optional - can do this later)")
    
    st.divider()
    
    # Advanced options
    with st.expander("🔗 Connection Details", expanded=False):
        st.write(f"**JIRA:** {user_info['jira_user']}")
        st.write(f"**Confluence:** {user_info['confluence_user']}")
        st.caption(f"JIRA URL: {user_info['jira_url']}")
        st.caption(f"Confluence URL: {user_info['confluence_url']}")
    
    with st.expander("🔧 Advanced Options", expanded=False):
        # Diagnostics
        if st.button("🔍 Run Diagnostics", use_container_width=True):
            from src.diagnostics import run_diagnostics
            run_diagnostics()
else:
    # Welcome message for new users
    st.info("👋 **Welcome to Confluence Page Creator!** This tool helps you bulk-create standardized Confluence pages from JIRA tickets.")
    
    # Login form
    st.subheader("🔐 Login to Continue")
    st.markdown("Connect your JIRA and Confluence accounts to get started.")
    
    with st.expander("ℹ️ How to get Personal Access Tokens", expanded=False):
        st.markdown("""
        **For JIRA:**
        1. Go to your JIRA account settings
        2. Navigate to Security → API tokens
        3. Click "Create API token"
        4. Copy the generated token
        
        **For Confluence:**
        1. Go to your Confluence settings
        2. Navigate to Personal settings → API tokens  
        3. Click "Create API token"
        4. Copy the generated token
        
        **Security Note:** Your credentials are stored locally and encrypted.
        """)
    
    col1, col2 = st.columns(2)

    with col1:
        st.markdown("**JIRA Connection**")
        jira_url = st.text_input(
            "JIRA Base URL",
            value=st.session_state.get('jira_url', default_jira_url),
            placeholder=default_jira_url,
            key="jira_url_input",
            help="Base URL of your JIRA instance (e.g. https://jira.example.com)."
        )
        jira_pat = st.text_input(
            "JIRA Personal Access Token",
            type="password",
            key="jira_pat_input",
            help="Personal Access Token from JIRA account settings (Manage account → Security → Create and manage API tokens)."
        )

    with col2:
        st.markdown("**Confluence Connection**")
        confluence_url = st.text_input(
            "Confluence Base URL",
            value=st.session_state.get('confluence_url', default_confluence_url),
            placeholder=default_confluence_url,
            key="confluence_url_input",
            help="Base URL of your Confluence instance (e.g. https://confluence.example.com)."
        )
        confluence_pat = st.text_input(
            "Confluence Personal Access Token",
            type="password",
            key="confluence_pat_input",
            help="Personal Access Token from Confluence settings (Settings → Personal settings → API tokens)."
        )

    st.divider()

    if st.button("🔐 Connect & Validate", type="primary", use_container_width=True):
        if not jira_url or not jira_pat:
            st.error("❌ Please provide JIRA URL and Personal Access Token.")
        elif not confluence_url or not confluence_pat:
            st.error("❌ Please provide Confluence URL and Personal Access Token.")
        else:
            with st.spinner("🔄 Validating connections..."):
                j_ok, j_msg, c_ok, c_msg = auth_manager.connect(
                    jira_url, jira_pat, confluence_url, confluence_pat
                )

            col_r1, col_r2 = st.columns(2)
            with col_r1:
                if j_ok:
                    st.success(f"✅ JIRA: Connected as **{j_msg}**")
                else:
                    st.error(f"❌ JIRA: Connection failed - {j_msg}")
            with col_r2:
                if c_ok:
                    st.success(f"✅ Confluence: Connected as **{c_msg}**")
                else:
                    st.error(f"❌ Confluence: Connection failed - {c_msg}")

            if j_ok and c_ok:
                auth_manager.save_credentials(jira_url, jira_pat, confluence_url, confluence_pat)
                st.success("🎉 Login successful! Credentials saved for future sessions.")
                st.balloons()
                st.rerun()
    
    # Troubleshooting section
    with st.expander("🆘 Having trouble connecting?", expanded=False):
        from src.diagnostics import show_connection_help
        show_connection_help()

# Render connection status in sidebar
render_connection_status()
