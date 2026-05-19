# tpm-confluence-tools

Bulk-create standardised Confluence pages from JIRA tickets. Sub-app of the
NDB-Delivery-Ops monorepo; serves the TPM persona (see
`.cursor/agents/tpm-assistant.md` at the repo root).

> **Lineage**: imported from `~/Confluence-Page-Creator/` during Phase 3 of
> the consolidation. Python / Streamlit; runs in its own virtual environment
> (no Node/Python crossover with the sibling `delivery-ops` app).

## Quick Start

### Using the Restart Script (Recommended)

The easiest way to run the application:

```bash
./restart
```

This script handles:
- ✅ Clean shutdown of existing instances
- ✅ Data backup (credentials, config)
- ✅ Virtual environment setup
- ✅ Dependency installation/updates  
- ✅ Application startup
- ✅ Chrome browser launch
- ✅ Logging and error handling

### Script Commands

```bash
./restart           # Full restart
./restart status    # Check application status
./restart help      # Show help
```

### Manual Setup

If you prefer manual setup:

1. Create virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run application:
   ```bash
   streamlit run app.py
   ```

## Features

- **Template Editor**: Customize Confluence page templates
- **Team Release**: Bulk process JIRA tickets for team releases
- **Report Generation**: Generate status reports
- **Dashboard**: Overview of application metrics

## Application Structure

```
├── app.py                    # Main Streamlit application
├── restart                   # Restart script
├── pages/                    # Streamlit pages
│   ├── 1_Template_Editor.py
│   ├── 2_Team_Release.py
│   ├── 3_Report.py
│   └── 4_Dashboard.py
├── src/                      # Core application logic
│   ├── confluence_client.py
│   ├── jira_client.py
│   ├── page_manager.py
│   ├── template_engine.py
│   └── utils.py
├── config/                   # Configuration files
├── logs/                     # Application logs (auto-generated)
├── backups/                  # Data backups (auto-generated)
└── requirements.txt          # Python dependencies
```

## Data Safety

The restart script automatically:
- Backs up credentials and configuration before restart
- Maintains up to 10 recent backups
- Preserves all user data and settings
- Creates detailed logs for troubleshooting

## Troubleshooting

### Check Application Status
```bash
./restart status
```

### View Logs
```bash
tail -f logs/streamlit_*.log
```

### Force Stop Application
```bash
pkill -f "streamlit run app.py"
```

### Clean Restart
```bash
./restart
```

## Access

- **Local URL**: http://localhost:8501
- **Network URL**: Available on your local network

---

For issues or questions, check the logs directory or restart the application using `./restart`.