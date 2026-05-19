"""
Common CSS styles for the Confluence Page Creator application.
"""

import streamlit as st


def load_custom_css():
    """Load custom CSS styles for the application."""
    st.markdown("""
    <style>
    /* Global reset and minimal spacing */
    .main > div {
        padding-top: 0.5rem;
        padding-bottom: 0.5rem;
    }
    
    /* Compact layout - reduce padding everywhere */
    .stContainer > div {
        padding-top: 0.5rem;
        padding-bottom: 0.5rem;
    }
    
    /* Dense form controls */
    .stSelectbox > div > div > div,
    .stTextInput > div > div > div {
        padding-top: 0.25rem;
        padding-bottom: 0.25rem;
        min-height: 2rem;
    }
    
    /* Compact buttons */
    .stButton > button {
        padding: 0.25rem 0.75rem !important;
        min-height: 2rem !important;
        font-size: 0.9rem !important;
        border-radius: 2px !important;
        border: 1px solid #e0e0e0 !important;
        background-color: #ffffff !important;
        color: #333333 !important;
        font-weight: 400 !important;
        transition: all 0.1s ease !important;
    }
    
    .stButton > button:hover {
        background-color: #f5f5f5 !important;
        border-color: #333333 !important;
    }
    
    /* Primary button styling - minimal color */
    .stButton > button[kind="primary"] {
        background-color: #333333 !important;
        color: #ffffff !important;
        border-color: #333333 !important;
    }
    
    .stButton > button[kind="primary"]:hover {
        background-color: #000000 !important;
        border-color: #000000 !important;
    }
    
    /* Secondary button - subtle */
    .stButton > button[kind="secondary"] {
        background-color: #f8f8f8 !important;
        color: #666666 !important;
        border-color: #cccccc !important;
    }
    
    /* Dense metrics */
    .metric-container {
        background-color: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 2px;
        padding: 0.5rem;
        margin-bottom: 0.5rem;
    }
    
    [data-testid="metric-container"] {
        background-color: #fafafa !important;
        border: 1px solid #e0e0e0 !important;
        border-radius: 2px !important;
        padding: 0.5rem !important;
        margin: 0.25rem 0 !important;
    }
    
    [data-testid="metric-container"] > div {
        padding: 0 !important;
    }
    
    /* Compact typography */
    h1 {
        font-size: 1.5rem !important;
        margin-bottom: 0.5rem !important;
        font-weight: 600 !important;
        color: #333333 !important;
    }
    
    h2 {
        font-size: 1.3rem !important;
        margin-bottom: 0.4rem !important;
        font-weight: 500 !important;
        color: #333333 !important;
    }
    
    h3 {
        font-size: 1.1rem !important;
        margin-bottom: 0.3rem !important;
        font-weight: 500 !important;
        color: #444444 !important;
    }
    
    /* Dense captions and text */
    .stCaption {
        font-size: 0.8rem !important;
        line-height: 1.2 !important;
        color: #666666 !important;
        margin-top: 0.1rem !important;
        margin-bottom: 0.2rem !important;
    }
    
    /* Compact expander */
    .streamlit-expanderHeader {
        padding: 0.25rem 0.5rem !important;
        font-size: 0.9rem !important;
        background-color: #f8f8f8 !important;
        border: 1px solid #e0e0e0 !important;
        border-radius: 2px !important;
    }
    
    .streamlit-expanderContent {
        padding: 0.5rem !important;
        border: 1px solid #e0e0e0 !important;
        border-top: none !important;
        background-color: #ffffff !important;
    }
    
    /* Minimal dividers */
    hr {
        margin: 0.75rem 0 !important;
        border-color: #e0e0e0 !important;
    }
    
    /* Compact status containers */
    .stStatus {
        margin: 0.5rem 0 !important;
    }
    
    .stStatus > div {
        padding: 0.5rem !important;
    }
    
    /* Dense progress bars */
    .stProgress > div > div {
        height: 0.25rem !important;
    }
    
    /* Compact columns - reduce gaps */
    .stColumn {
        padding: 0 0.25rem !important;
    }
    
    /* Clean table-like layout for feature grid */
    .feature-row {
        display: flex;
        align-items: center;
        padding: 0.5rem 0;
        border-bottom: 1px solid #f0f0f0;
        font-size: 0.9rem;
    }
    
    .feature-row:hover {
        background-color: #f9f9f9;
    }
    
    /* Monochrome color scheme */
    .stSelectbox label,
    .stTextInput label,
    .stNumberInput label {
        font-size: 0.85rem !important;
        font-weight: 500 !important;
        color: #555555 !important;
        margin-bottom: 0.25rem !important;
    }
    
    /* Success/error states - minimal color use */
    .stSuccess {
        background-color: #f8f8f8 !important;
        border-left: 3px solid #333333 !important;
        color: #333333 !important;
        padding: 0.5rem !important;
        border-radius: 0 !important;
    }
    
    .stError {
        background-color: #f8f8f8 !important;
        border-left: 3px solid #666666 !important;
        color: #333333 !important;
        padding: 0.5rem !important;
        border-radius: 0 !important;
    }
    
    .stWarning {
        background-color: #f8f8f8 !important;
        border-left: 3px solid #999999 !important;
        color: #333333 !important;
        padding: 0.5rem !important;
        border-radius: 0 !important;
    }
    
    .stInfo {
        background-color: #f8f8f8 !important;
        border-left: 3px solid #cccccc !important;
        color: #333333 !important;
        padding: 0.5rem !important;
        border-radius: 0 !important;
    }
    
    /* Hide Streamlit branding and reduce chrome */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    .stDeployButton {visibility: hidden;}
    
    /* Compact sidebar */
    .css-1d391kg {
        padding-top: 1rem;
    }
    
    /* Remove excessive white space from containers */
    .block-container {
        padding-top: 1rem !important;
        padding-bottom: 0.5rem !important;
        max-width: 100% !important;
    }
    
    /* Dense form layout */
    .stForm {
        border: 1px solid #e0e0e0 !important;
        border-radius: 2px !important;
        padding: 0.75rem !important;
        background-color: #fafafa !important;
    }
    
    /* Compact loading spinner */
    .stSpinner > div {
        border-width: 2px !important;
        width: 1rem !important;
        height: 1rem !important;
    }
    
    /* Clean, minimal look for data displays */
    .dataframe {
        font-size: 0.85rem !important;
    }
    
    /* Reduce padding in multiselect and other complex widgets */
    .stMultiSelect > div > div > div {
        padding: 0.25rem !important;
        min-height: 2rem !important;
    }
    
    /* Compact checkbox and radio */
    .stCheckbox > label {
        font-size: 0.9rem !important;
        padding-left: 1.5rem !important;
    }
    
    .stRadio > label {
        font-size: 0.9rem !important;
    }
    
    /* Dense tab layout */
    .stTabs > div > div > div {
        padding: 0.25rem 0.75rem !important;
        font-size: 0.9rem !important;
    }
    
    /* Remove extra spacing from main content area */
    .main .block-container {
        padding: 1rem 1rem 0rem 1rem !important;
        max-width: 100% !important;
    }
    
    /* Tighter row spacing */
    .row-widget {
        margin-bottom: 0.5rem !important;
    }
    
    /* More compact status messages */
    div[data-baseweb="notification"] {
        margin: 0.25rem 0 !important;
        padding: 0.5rem !important;
        font-size: 0.9rem !important;
    }
    
    /* Compact table-like rows for feature list */
    .element-container {
        margin-bottom: 0.25rem !important;
    }
    
    /* Reduce space around columns */
    .stColumn > div {
        padding-left: 0.25rem !important;
        padding-right: 0.25rem !important;
    }
    
    /* More compact selectbox */
    .stSelectbox > div > div {
        min-height: 2rem !important;
    }
    
    .stSelectbox > label {
        margin-bottom: 0.2rem !important;
        font-size: 0.85rem !important;
        color: #555 !important;
    }
    
    /* Compact text input */
    .stTextInput > div > div > input {
        padding: 0.25rem 0.5rem !important;
        min-height: 2rem !important;
        font-size: 0.9rem !important;
    }
    
    .stTextInput > label {
        margin-bottom: 0.2rem !important;
        font-size: 0.85rem !important;
        color: #555 !important;
    }
    
    /* Remove excessive vertical spacing from containers */
    .stContainer {
        padding: 0 !important;
    }
    
    /* Compact expander header */
    details summary {
        padding: 0.25rem 0.5rem !important;
        font-size: 0.9rem !important;
        font-weight: 500 !important;
        background-color: #f8f8f8 !important;
        border-bottom: 1px solid #e0e0e0 !important;
    }
    
    /* Reduce markdown spacing */
    .markdown-text-container {
        margin: 0.25rem 0 !important;
    }
    
    /* Compact status updates */
    .stStatus > div > div {
        padding: 0.25rem 0.5rem !important;
        font-size: 0.9rem !important;
    }
    </style>
    """, unsafe_allow_html=True)