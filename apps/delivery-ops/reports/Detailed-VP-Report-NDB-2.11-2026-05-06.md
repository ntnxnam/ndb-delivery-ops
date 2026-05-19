---
report_type: Detailed
product: NDB
release: "2.11"
generated: 2026-05-06
data_source: live
---

# NDB-2.11 Release Status Report
**May 6, 2026**

For live updates, please see http://ndb-qa.dev.nutanix.com:6100/all-status

*(Trying out a new format, feedback welcome. Please send a 1:1 note)*

## Executive Summary
The NDB-2.11 release shows mixed execution across 50 committed projects with execution challenges requiring focused attention. With 25 projects at risk and 10 projects at big risk, proactive management is essential as we approach critical gate milestones.

## Project Breakdown Summary
| Risk Level | Count | Percentage |
|------------|-------|------------|
| 🟢 Green - On Track | 19 | 38% |
| 🟡 Yellow - Slight Risk | 15 | 30% |
| 🔴 Red - Big Risk | 10 | 20% |
| ⚪ Not Set | 6 | 12% |
| **TOTAL** | **50** | **100%** |

## Highlights (Execution Wins)
• **Redesign Enable Multi cluster flow for NDB on SMSP** (ERA-49552) - P0 Blocker - Code Complete Met
• **Integrate NDB control plane with PC Marketplace** (ERA-49554) - P0 Blocker - Execute Commit - Code Complete: 29/Apr/2026
• **Move NDB control plane from non-smsp to smsp based infrastructure** (ERA-49556) - P0 Blocker - Execute Commit - Code Complete: 26/Feb/2026
• **Setup NATS infrastructure for NDB on SMSP** (ERA-49558) - P0 Blocker - Closed - Code Complete: 16/Feb/2026
• **NDB integration with LCM** (ERA-49560) - P0 Blocker - Concept Commit - Code Complete: 14/May/2026
• **Web console for ERA-CLI and Server-CLI for NDB on SMSP and disabling unsupported operations** (ERA-49562) - P0 Blocker - Execute Commit - Code Complete: 12/Jun/2025
• **Enable independent NDB components for NDB CP on SMSP** (ERA-54496) - P0 Blocker - Concept Commit

## Lowlights (Areas Requiring Attention)
### Yellow Risk Projects
• **[NDB/DP/MySQL] Support MySQL TDE** (FEAT-17702) - P0 Blocker - CG: 27/Apr/2026
• **Dynamic Support Matrix** (FEAT-18162) - P1 Critical - CG: 14/May/2026 - - First round of manual testing was completed on 10th April, 2026
• **NDB - MongoDB Sharded Cluster manual scale-out** (FEAT-16363) - P1 Critical - CG: 27/Apr/2026
• **NDB: Enhancing Reliability and Performance of existing Storage Spaces Workflows** (ERA-56129) - P1 Critical - CG: 29/Apr/2026 - QI: 73%
• **A11y changes for NDB aligning with Janus release** (FEAT-18271) - P2 Major - CG: 29/Apr/2026
• **User PG HA support for Object-store WAL archival with UI** (FEAT-17289) - P2 Major - CG: 27/Apr/2026
• **NDB add & remove database nodes - SQL Server** (FEAT-16821) - P2 Major - CG: 29/Apr/2026
• **NDB add & remove database nodes - PostgreSQL** (FEAT-16820) - P2 Major - CG: 29/Apr/2026
• **NDB diagnostic bundle - improve diagnostic bundle feature** (FEAT-16809) - P2 Major - CG: 20/Apr/2026
• **NDB native TDE for EDB** (FEAT-16150) - P2 Major - CG: 13/Apr/2026
• **NDB - Upgrade to supported Python and Ansible version** (ERA-56190) - P2 Major - CG: 29/Apr/2026
• **VG as Default option for greenfield SQL databases** (ERA-54010) - P2 Major - CG: 29/Apr/2026 - QI: 60%
• **Prism proxy service** (ERA-47664) - P2 Major - CG: 22/Apr/2026
• **[Windows] NDB VM-creation - Remove dependency on Agent VM** (ERA-30989) - P2 Major - CG: 29/Apr/2026 - * Manual testing in Progress, no blockers found
• **Support for Linux Package Manager for Postgres** (FEAT-16814) - P2 Major

### Red Risk Projects
• **[NDB/DP/MySQL] Support MySQL Backup/Restore** (FEAT-17029) - P0 Blocker - Code Complete: 15/Mar/2026 - CG: 04/May/2026 - Team at 50% capacity, Schedule delays
• **Support and Validate compatibility of NDB workflows using RHEL 10.x for all DB engines** (ERA-50833) - P0 Blocker - Code Complete: 03/Feb/2026 - CG: 28/May/2026 - Dependency on Rocky9
• **Project Hermes: NDB next-gen Orchestration** (ERA-38582) - P0 Blocker - Code Complete: 30/Aug/2026
• **Migrate NDB Control plane to Rocky 9** (ERA-61458) - P1 Critical - Code Complete: 23/Apr/2026 - CG: 19/May/2026
• **Time Machine  Policy** (FEAT-17279) - P1 Critical
• **Entity Sharing Enhancement - DB & DB Clones** (FEAT-18614) - P2 Major - Code Complete: 11/Mar/2026 - CG: 05/May/2026 - Schedule delays - CG date beyond 14/Apr
• **Build PG DR Plug-in (HA<-->HA)** (FEAT-16333) - P2 Major - Code Complete: 05/Mar/2026 - CG: 05/May/2026 - Schedule delays
• **Object connection management** (ERA-31655) - P2 Major
• **Object ACL(from security standpoint i.e deletion) management in NDB** (ERA-54865) - P2 Major
• **Enhance NDB's k8s operator to be more dev friendly and secure** (FEAT-18523) - P2 Major - Code Complete: 29/Apr/2026

### Visibility Gaps
• **Log Backups v2.0: Leaf-node catch-up** (ERA-37117) - P2 Major - Concept Commit - Risk indicator not set
• **Identify and Configure resource footprint for NDB CP on SMSP** (ERA-48194) - P1 Critical - Backlog - Risk indicator not set
• **Config Audit Log** (ERA-51667) - P2 Major - Execute Commit - Code Complete: 14/Apr/2026 - Risk indicator not set
• **Improvements to NDB management from PC Marketplace** (ERA-54994) - P1 Critical - Backlog - Risk indicator not set
• **SQL Server - Option to leave database in restoring state** (FEAT-16815) - P1 Critical - Concept Commit - Code Complete: 29/Apr/2026 - Risk indicator not set
• **NDB - Major Version Upgrade** (FEAT-16856) - P1 Critical - Concept Commit - Risk indicator not set

