"""Template configurations for all gate types (CCM, CG, PG).

Each config drives the template editor and XHTML generation.
Sections and items can be toggled, reordered, and edited.
"""

import copy


GATE_TYPES = {
    "ccm": {"label": "Code Complete", "suffix": "ccm-checklist"},
    "cg": {"label": "CG Checklist", "suffix": "cg-checklist"},
    "pg": {"label": "PG Checklist", "suffix": "pg-checklist"},
}

EVIDENCE_TYPES = [
    {"id": "none", "label": "None (empty cell)"},
    {"id": "jql_table", "label": "JQL Table (shows matching issues)"},
    {"id": "jql_count", "label": "JQL Count (appended to portfolio query)"},
    {"id": "field_value", "label": "JIRA Field Value (pulls from ticket)"},
    {"id": "text", "label": "Text / Link placeholder"},
    {"id": "test_summary", "label": "Test Summary (TCMS, QI, bug counts)"},
    {"id": "sdl", "label": "SDL (Security/Legal project query)"},
    {"id": "shared", "label": "Shared (merged cell with row above)"},
]

EVIDENCE_TYPE_IDS = [e['id'] for e in EVIDENCE_TYPES]


def get_default_config(gate_type: str) -> dict:
    """Get the default template config for a given gate type."""
    if gate_type == 'cg':
        return copy.deepcopy(DEFAULT_CG_CONFIG)
    if gate_type == 'ccm':
        return copy.deepcopy(DEFAULT_CC_CONFIG)
    if gate_type == 'pg':
        return copy.deepcopy(DEFAULT_PG_CONFIG)
    return copy.deepcopy(DEFAULT_CG_CONFIG)


def get_default_cg_config():
    return copy.deepcopy(DEFAULT_CG_CONFIG)


DEFAULT_CC_CONFIG = {
    "template_name": "Code Complete",
    "gate_type": "ccm",
    "ready": True,
    "template_description": "Code Complete (CCM) soft gate — confirms development is 100% done and handed off to QA",
    "sections": [
        {
            "id": "ccm_process_note",
            "title": "Process Note",
            "enabled": True,
            "editable": False
        },
        {
            "id": "legend",
            "title": "Legend",
            "enabled": True,
            "editable": False
        },
        {
            "id": "team_table",
            "title": "Gate Tracking",
            "enabled": True,
            "editable": False
        },
        {
            "id": "summary",
            "title": "Summary",
            "enabled": False,
            "editable": True,
            "date_columns": [
                {"field_id": "customfield_13860", "display": "Rqmnts Done Date"},
                {"field_id": "customfield_13861", "display": "FS/DS Done Date"},
                {"field_id": "customfield_11068", "display": "Test Plan Date"},
                {"field_id": "customfield_11067", "display": "Code Complete Date"},
                {"field_id": "customfield_35863", "display": "Commit Gate Ready Estimation Date"},
                {"field_id": "customfield_40473", "display": "Commit Gate Review Date"},
                {"field_id": "customfield_35864", "display": "Promotion Gate Ready Estimation Date"},
                {"field_id": "customfield_14367", "display": "GA Date"}
            ]
        },
        {
            "id": "checklist",
            "title": "Code Complete Checklist",
            "enabled": True,
            "editable": True,
            "groups": [
                {
                    "id": "dev_readiness",
                    "title": "Development Readiness (Entry Criteria for QA)",
                    "color": "#4c9aff",
                    "items": [
                        {
                            "id": "D1",
                            "label": "Code Complete & Merged (All PRs merged to Release Branch master)",
                            "approver": "Dev",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Commit Hash:"},
                            "enabled": True
                        },
                        {
                            "id": "D2",
                            "label": "Unit Tests Passing (CI Pipeline Green, >= 85% Coverage)",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type =\"Unit Test\""
                            },
                            "enabled": True
                        },
                        {
                            "id": "D3",
                            "label": "No P0 Blockers (Build is stable enough for QA)",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type = Bug and priority = \"Blocker - P0\""
                            },
                            "enabled": True
                        },
                        {
                            "id": "D4",
                            "label": "Dev Sanity Demo (Basic happy path verified)",
                            "approver": "Dev",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Recording Link:"},
                            "enabled": True
                        },
                        {
                            "id": "D5",
                            "label": "Feature Flag Implemented (GFlag to enable/disable feature)",
                            "approver": "Dev",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Flag Name:"},
                            "enabled": True
                        },
                        {
                            "id": "D6",
                            "label": "API Spec",
                            "approver": "Dev",
                            "evidence_type": "none",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "D7",
                            "label": "Performance Benchmarking Numbers",
                            "approver": "Dev",
                            "evidence_type": "none",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "D8",
                            "label": "Dependency in release level features for integration established and informed",
                            "approver": "Dev",
                            "evidence_type": "none",
                            "evidence_config": {},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "qa_readiness",
                    "title": "QA Readiness",
                    "color": "#2684ff",
                    "items": [
                        {
                            "id": "Q1",
                            "label": "Test Plan Signed Off (MANDATORY Pre-requisite)",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Test Plan Link:"},
                            "enabled": True
                        },
                        {
                            "id": "Q2",
                            "label": "Test Cases Ready (Created in TCMS)",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "TCMS Link:"},
                            "enabled": True
                        },
                        {
                            "id": "Q3",
                            "label": "Testbed / Infra Ready (Hardware/VMs configured)",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Setup IP:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "gate_prep",
                    "title": "Gate Prep & Compliance Initiation",
                    "color": "#00875a",
                    "items": [
                        {
                            "id": "G1",
                            "label": "Serviceability Review Created (Jira/Page created & assigned to SRE)",
                            "approver": "FEAT Mgr",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Link:"},
                            "enabled": True
                        },
                        {
                            "id": "G2",
                            "label": "SDL (Security) Tickets Created (Scans triggered, Design Review logged)",
                            "approver": "Sec Team",
                            "evidence_type": "sdl",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "G3",
                            "label": "Legal Review Ticket Created (Intake form submitted)",
                            "approver": "Legal",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Link:"},
                            "enabled": True
                        },
                        {
                            "id": "G4",
                            "label": "Release Channel Notification (Posted in #ndb-release-gate-preps)",
                            "approver": "FEAT Mgr",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Slack Thread Link:"},
                            "enabled": True
                        }
                    ]
                }
            ]
        },
        {
            "id": "ccm_signoff",
            "title": "CCM Sign-Off",
            "enabled": True,
            "editable": False
        }
    ]
}


DEFAULT_PG_CONFIG = {
    "template_name": "PG Checklist",
    "gate_type": "pg",
    "ready": True,
    "template_description": "Promotion Gate Checklist - NDB 2.11 comprehensive readiness criteria",
    "sections": [
        {
            "id": "legend",
            "title": "Legend",
            "enabled": True,
            "editable": False
        },
        {
            "id": "summary",
            "title": "PG Summary",
            "enabled": True,
            "editable": True,
            "date_columns": [
                {"field_id": "customfield_11067", "display": "Code Complete Date"},
                {"field_id": "customfield_35863", "display": "Commit Gate Ready Estimation Date"},
                {"field_id": "customfield_40473", "display": "Commit Gate Review Date"},
                {"field_id": "customfield_18461", "display": "Automation Completion Date"},
                {"field_id": "customfield_35864", "display": "Promotion Gate Ready Estimation Date"},
                {"field_id": "customfield_14367", "display": "GA Date"}
            ]
        },
        {
            "id": "key_dates",
            "title": "Key Dates",
            "enabled": True,
            "editable": False,
            "columns": [
                {"field_id": "customfield_11067", "display": "Code Complete Date"},
                {"field_id": "customfield_35863", "display": "Commit Gate Ready Estimation Date"},
                {"field_id": "customfield_40473", "display": "Commit Gate Review Date"},
                {"field_id": "customfield_18461", "display": "Automation Completion Date"},
                {"field_id": "customfield_35864", "display": "Promotion Gate Ready Estimation Date"},
                {"field_id": "customfield_14367", "display": "GA Date"}
            ]
        },
        {
            "id": "checklist",
            "title": "PG Criteria",
            "enabled": True,
            "editable": True,
            "groups": [
                {
                    "id": "gate_criteria",
                    "title": "Gate Criteria",
                    "color": "#4c9aff",
                    "items": [
                        {
                            "id": "1",
                            "label": "Commit Gate Criteria All Met",
                            "approver": "FEAT Manager",
                            "evidence_type": "text",
                            "evidence_config": {"text": "CG Status:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "coding_complete",
                    "title": "All coding items including bug fixes are closed",
                    "color": "#b3f5ff",
                    "items": [
                        {
                            "id": "2",
                            "label": "Telemetry Code Complete",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type not in (Feature, Initiative, Epic, Test, Bug, Improvement) and text~\"Telemetry\""
                            },
                            "enabled": True
                        },
                        {
                            "id": "3",
                            "label": "All other open tasks associated with the FEAT, including added improvements, Closed",
                            "approver": "Dev Lead",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type = Improvement"
                            },
                            "enabled": True
                        },
                        {
                            "id": "4",
                            "label": "All Code in Master",
                            "approver": "Dev Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Master Status:"},
                            "enabled": True
                        },
                        {
                            "id": "5",
                            "label": "All P0/P1 bugs fixed",
                            "approver": "Dev Lead",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and type = Bug and statusCategory=Done AND fixversion in (\"NDB-2.11\", triage,master, \"Era Future\") and priority in (\"Blocker - P0\", \"Critical - P1\") and (labels is empty or labels != ndb-2.11-deferred)"
                            },
                            "enabled": True
                        },
                        {
                            "id": "6",
                            "label": "All P2/P3 bugs fixed",
                            "approver": "Dev Lead",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and type = Bug and statusCategory=Done AND fixversion in (\"NDB-2.11\", triage,master, \"Era Future\") and priority in (\"Major - P2\", \"Minor - P3\") and (labels is empty or labels != ndb-2.11-deferred)"
                            },
                            "enabled": True
                        },
                        {
                            "id": "7",
                            "label": "P0, P1 Bugs found with UX FnF Fixed and Signed off",
                            "approver": "UX Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "UX Sign-off:"},
                            "enabled": True
                        },
                        {
                            "id": "8",
                            "label": "P2, P3 Bugs found with UX FnF Triaged",
                            "approver": "UX Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "UX Triage:"},
                            "enabled": True
                        },
                        {
                            "id": "9",
                            "label": "On/Off Switch Implemented",
                            "approver": "Dev Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Switch Status:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "test_automation",
                    "title": "Functional and System Test Automation Completion",
                    "color": "#c0b6f2",
                    "items": [
                        {
                            "id": "10",
                            "label": "On/Off Switch Tested and Verified",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Test Results:"},
                            "enabled": True
                        },
                        {
                            "id": "11",
                            "label": "Framework changes complete - Includes Base and Additional variant automation testing",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Framework Status:"},
                            "enabled": True
                        },
                        {
                            "id": "12",
                            "label": "Feature Level System Test completed (manual testing for now)",
                            "approver": "Saurabh Srivastava",
                            "evidence_type": "text",
                            "evidence_config": {"text": "System Test:"},
                            "enabled": True
                        },
                        {
                            "id": "13",
                            "label": "All Test Automation Integrated in Test Suite / LST files are uploaded into TCMS",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "QI: \nTCMS Link:"},
                            "enabled": True
                        },
                        {
                            "id": "14",
                            "label": "API Latency Check Completed",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Latency Results:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "test_runs",
                    "title": "Tying up all the test runs",
                    "color": "#b3f5ff",
                    "items": [
                        {
                            "id": "15",
                            "label": "Functional tests with QI greater than 90%",
                            "approver": "Test Lead",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "16",
                            "label": "Performance tests re-run after CG Passing with QI maintained >= 90%",
                            "approver": "Test Lead",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "17",
                            "label": "Integration tests completed and re-run after CG Passing with QI maintained >= 90%",
                            "approver": "Test Lead",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "18",
                            "label": "Longevity tests completed and re-run after CG Passing with QI maintained >= 90%",
                            "approver": "Test Lead",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "19",
                            "label": "System tests for the FEAT completed and re-run after Passing with QI maintained >= 90%",
                            "approver": "Test Lead",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "verification",
                    "title": "Bug and Improvement Verification",
                    "color": "#fff0b3",
                    "items": [
                        {
                            "id": "20",
                            "label": "All open bugs and improvements are verified",
                            "approver": "Test Lead",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory=Done and type in (Improvement, Bug)"
                            },
                            "enabled": True
                        },
                        {
                            "id": "21",
                            "label": "Pulse Output Verified (Telemetry)",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Pulse Status:"},
                            "enabled": True
                        },
                        {
                            "id": "22",
                            "label": "Upgrade/Compatibility Testing Completed",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Compatibility:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "documentation",
                    "title": "Documentation",
                    "color": "#6554c0",
                    "items": [
                        {
                            "id": "23",
                            "label": "Product Demo Complete",
                            "approver": "Test Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Demo Status:"},
                            "enabled": True
                        },
                        {
                            "id": "24",
                            "label": "Product Demo Signed off by PM",
                            "approver": "PM",
                            "evidence_type": "text",
                            "evidence_config": {"text": "PM Approval:"},
                            "enabled": True
                        },
                        {
                            "id": "25",
                            "label": "Blog Creation Completed",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type not in (Feature, Initiative, Epic, Test, Bug, Improvement) and \"Epic Name\" ~ \"Blog\""
                            },
                            "enabled": True
                        },
                        {
                            "id": "26",
                            "label": "Patent Filed for any innovations",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type not in (Feature, Initiative, Epic, Test, Bug, Improvement) and type = Patent"
                            },
                            "enabled": True
                        },
                        {
                            "id": "27",
                            "label": "Design Document Modified and Signed-off",
                            "approver": "FEAT Manager",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Design Doc:"},
                            "enabled": True
                        },
                        {
                            "id": "28",
                            "label": "API Document Reviewed",
                            "approver": "Krunal Jhaveri",
                            "evidence_type": "text",
                            "evidence_config": {"text": "API Review:"},
                            "enabled": True
                        },
                        {
                            "id": "29",
                            "label": "All inputs provided to Doc team for TECHPUBS",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type not in (Feature, Initiative, Epic, Test, Bug, Improvement) and component = documentation"
                            },
                            "enabled": True
                        },
                        {
                            "id": "30",
                            "label": "Technical Documentation Completed",
                            "approver": "Doc",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Release Notes & User Guide:"},
                            "enabled": True
                        },
                        {
                            "id": "31",
                            "label": "Technical Document Reviewed and Signed Off By Eng",
                            "approver": "Eng",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Eng Review:"},
                            "enabled": True
                        },
                        {
                            "id": "32",
                            "label": "Technical Document Reviewed and Signed Off By PM",
                            "approver": "PM",
                            "evidence_type": "text",
                            "evidence_config": {"text": "PM Review:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "signoffs",
                    "title": "Additional Sign-offs",
                    "color": "#0065ff",
                    "items": [
                        {
                            "id": "33",
                            "label": "a11y Sign off Complete",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and project=ACP and statusCategory!=Done"
                            },
                            "enabled": True
                        },
                        {
                            "id": "34",
                            "label": "Security Sign off Complete",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and project = SDL"
                            },
                            "enabled": True
                        },
                        {
                            "id": "35",
                            "label": "Legal Sign off Complete",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and project = LEG"
                            },
                            "enabled": True
                        },
                        {
                            "id": "36",
                            "label": "Supportability Sign Off Complete",
                            "approver": "FEAT Manager",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and project=SR and statusCategory!=Done"
                            },
                            "enabled": True
                        }
                    ]
                }
            ]
        },
        {
            "id": "supportability_checklist",
            "title": "Promotion Gate - Supportability Checklist",
            "enabled": True,
            "editable": True,
            "groups": [
                {
                    "id": "supportability_requirements",
                    "title": "Supportability Requirements",
                    "color": "#bf2600",
                    "items": [
                        {
                            "id": "S1",
                            "label": "Pending Supportability CG Items?",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Outstanding Tasks:"},
                            "enabled": True
                        },
                        {
                            "id": "S2",
                            "label": "Supportability Testing (Pulse, Upgrade, UI, Version Compatibility, Feature ON/OFF)",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Testing Status:"},
                            "enabled": True
                        },
                        {
                            "id": "S3",
                            "label": "Logs Verification (Logbay, RCC, Panacea)",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Log Verification:"},
                            "enabled": True
                        },
                        {
                            "id": "S4",
                            "label": "Alerts, pre-checks and error messages Verification",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Alerts Review:"},
                            "enabled": True
                        },
                        {
                            "id": "S5",
                            "label": "Test Failure Reviews",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Failure Review:"},
                            "enabled": True
                        },
                        {
                            "id": "S6",
                            "label": "Holistic Review of integration testing with other components",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Integration Review:"},
                            "enabled": True
                        },
                        {
                            "id": "S7",
                            "label": "Tech Preview Verification",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Tech Preview:"},
                            "enabled": True
                        },
                        {
                            "id": "S8",
                            "label": "EA Verification",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "EA Status:"},
                            "enabled": True
                        },
                        {
                            "id": "S9",
                            "label": "Limited Feature Availability",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "LFA Status:"},
                            "enabled": True
                        },
                        {
                            "id": "S10",
                            "label": "Impact/verification of Existing Tools wrt this FEAT",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Tools Impact:"},
                            "enabled": True
                        },
                        {
                            "id": "S11",
                            "label": "Deferral Justification",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Deferral Review:"},
                            "enabled": True
                        },
                        {
                            "id": "S12",
                            "label": "Pending Tasks and Must Fixes",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "JIRA Filter:"},
                            "enabled": True
                        },
                        {
                            "id": "S13",
                            "label": "Portal Documentation updates",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "TechPubs Contact: Binu Ann Mathew"},
                            "enabled": True
                        },
                        {
                            "id": "S14",
                            "label": "Knowledge Base updates (Serviceability)",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "KB Updates:"},
                            "enabled": True
                        },
                        {
                            "id": "S15",
                            "label": "TOI Readiness/SRE Training",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "PPT:\nRecording:\nPasscode:"},
                            "enabled": True
                        },
                        {
                            "id": "S16",
                            "label": "NDB Specific - Supportability Review (supportability Dev Team)",
                            "approver": "Dev/QA Lead",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Supportability Feedback:"},
                            "enabled": True
                        },
                        {
                            "id": "S17",
                            "label": "Serviceability Approval",
                            "approver": "Ramalakshmi R",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Approval (YES/NO):"},
                            "enabled": True
                        }
                    ]
                }
            ]
        }
    ]
}


DEFAULT_CG_CONFIG = {
    "template_name": "CG Checklist",
    "gate_type": "cg",
    "ready": True,
    "template_description": "Commit Gate Checklist for feature tracking",
    "sections": [
        {
            "id": "legend",
            "title": "Legend",
            "enabled": True,
            "editable": False
        },
        {
            "id": "summary",
            "title": "CG Summary",
            "enabled": True,
            "editable": True,
            "date_columns": [
                {"field_id": "customfield_13860", "display": "Rqmnts Done Date"},
                {"field_id": "customfield_13861", "display": "FS/DS Done Date"},
                {"field_id": "customfield_11068", "display": "Test Plan Date"},
                {"field_id": "customfield_11067", "display": "Code Complete Date"},
                {"field_id": "customfield_35863", "display": "Commit Gate Ready Estimation Date"},
                {"field_id": "customfield_40473", "display": "Commit Gate Review Date"},
                {"field_id": "customfield_35864", "display": "Promotion Gate Ready Estimation Date"},
                {"field_id": "customfield_14367", "display": "GA Date"}
            ]
        },
        {
            "id": "gate_commitments",
            "title": "Gate Commitments",
            "enabled": True,
            "editable": False
        },
        {
            "id": "checklist",
            "title": "Checklist Details",
            "enabled": True,
            "editable": True,
            "groups": [
                {
                    "id": "pre",
                    "title": None,
                    "color": None,
                    "items": [
                        {
                            "id": "0",
                            "label": "PRD, Design Doc, Test Plan links in Jira - EC Met Criteria",
                            "approver": "Dev",
                            "evidence_type": "jql_table",
                            "evidence_config": {
                                "jql": "key={{JIRA_KEY}}",
                                "columns": "Link to Requirements,Link to Design Doc,Link to Test Plan",
                                "column_ids": "customfield_14463,customfield_14464,customfield_14465"
                            },
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "code_ut",
                    "title": "Code and Unit Test Complete",
                    "color": "#4c9aff",
                    "items": [
                        {
                            "id": "1",
                            "label": "Any impact on the Backup and Recovery of NDB CP - new addition starting with 2.10.1",
                            "approver": "Dev",
                            "evidence_type": "none",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "2",
                            "label": "Task",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type = Task"
                            },
                            "enabled": True
                        },
                        {
                            "id": "3",
                            "label": "UT Complete",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type =\"Unit Test\""
                            },
                            "enabled": True
                        },
                        {
                            "id": "4",
                            "label": "All other Dev open tasks associated with the FEAT Closed",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type not in (Task, Bug, Improvement, Test, Epic, Initiative, Feature) and statusCategory!=Done"
                            },
                            "enabled": True
                        },
                        {
                            "id": "5",
                            "label": "SDL (Security) Review Done",
                            "approver": "Dev",
                            "evidence_type": "sdl",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "6",
                            "label": "Legal Review Done",
                            "approver": "Dev",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Legal Status:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "qa_automation",
                    "title": "QA and Automation Complete",
                    "color": "#2684ff",
                    "items": [
                        {
                            "id": "7",
                            "label": "Test",
                            "approver": "QA",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type = Test"
                            },
                            "enabled": True
                        },
                        {
                            "id": "8",
                            "label": "Test Execution Results shared with Dev",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Test Results Link:"},
                            "enabled": True
                        },
                        {
                            "id": "9",
                            "label": "All P0 / P1 Bugs Fixed",
                            "approver": "QA",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and statusCategory!=Done and type = Bug and priority in (\"Blocker - P0\", \"Critical - P1\")"
                            },
                            "enabled": True
                        },
                        {
                            "id": "10",
                            "label": "QI >= 90% (At Feature / FEAT Level)",
                            "approver": "QA",
                            "evidence_type": "test_summary",
                            "evidence_config": {},
                            "enabled": True
                        },
                        {
                            "id": "11",
                            "label": "Automation Framework Changes",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "Framework Status:"},
                            "enabled": True
                        },
                        {
                            "id": "12",
                            "label": "Test Automation Complete (Uploaded into TCMS)",
                            "approver": "QA",
                            "evidence_type": "text",
                            "evidence_config": {"text": "TCMS Link:"},
                            "enabled": True
                        }
                    ]
                },
                {
                    "id": "release_prep",
                    "title": "Release Prep",
                    "color": "#00875a",
                    "items": [
                        {
                            "id": "13",
                            "label": "All Service Review (SR) Tasks Completed (Supportability)",
                            "approver": "Dev",
                            "evidence_type": "jql_count",
                            "evidence_config": {
                                "jql_suffix": "and project=SR and statusCategory!=Done"
                            },
                            "enabled": True
                        },
                        {
                            "id": "14",
                            "label": "TOI for Supportability Team (At Least Dry Run Done)",
                            "approver": "Dev",
                            "evidence_type": "text",
                            "evidence_config": {"text": "TOI Status:"},
                            "enabled": True
                        }
                    ]
                }
            ]
        },
        {
            "id": "cg_signoff",
            "title": "CG Sign-Off",
            "enabled": True,
            "editable": False
        }
    ]
}