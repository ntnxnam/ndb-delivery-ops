# Testing Guide — Team Management & Crystal Ball

## Overview
Covers the base-filter-driven Team Management flow (detect project, versions, board, sprint calendar and FEAT components from a team's base filter) and Crystal Ball predictions.

## Test Suites

### Backend

#### 1. Admin routes (`server/__tests__/routes/admin.test.js`)
- Super-admin guard (403 for everyone else)
- `GET /teams` adds computed `sprintScope` and `kpiCount`
- `POST /teams`: code slugified from the name, explicit code honoured, legacy `projectType` / `versionPatterns` / `sprintBaseFilter` dropped, KPI entry created, `allowedUsers.json` untouched
- 400 on missing name / filter / project / calendar; 409 on duplicate code
- `PUT /teams/:id` merges and keeps the code; 404 for unknown teams
- `POST /inspect-base-filter`: success shape, 400 when the filter matches nothing or JIRA rejects it
- `POST /board-calendar`, `POST /test-team-config`
- Removed `validate-*` endpoints return 404

#### 2. Team detection service (`server/__tests__/services/teamInspectService.test.js`)
- Grouping FEAT components into `{ component: [primaryComponents] }`
- Board choice (requested board → name match → first scrum board)
- Partial failure: versions / board / FEAT errors are reported inline
- ORDER BY stripped before composing the FEAT query
- Team code slugify and `featureComponents` normalisation

#### 3. Sprint scope (`server/__tests__/utils/teamScope.test.js`, `server/__tests__/services/sprintService.test.js`)
- `sprintScopeFromBaseFilter` removes ORDER BY and a trailing `statusCategory != Done`
- Sprint KPI breakdown scopes by the derived sprint scope

```bash
cd server
npm run test:admin          # admin routes
npm run test:new-features   # admin routes + team detection service
npm test                    # full server suite
```

### Frontend

#### 4. Team Management (`client/src/__tests__/components/AdminPanel.test.js`)
- Loading / access-denied / team list (sprint scope, components, picker sync)
- Test button calls `test-team-config` and renders each check
- Team code follows the name until edited
- Save disabled until Detect; Detect fills project, board, calendar, components; deselected components are not saved
- Choosing another board re-reads its calendar
- Detect and save errors are shown
- Edit mode: read-only code, no re-detect while the base filter is unchanged

#### 5. Crystal Ball hook (`client/src/__tests__/hooks/useCrystalBall.test.js`)
- Status, predictions, trends, risk forecasts, error handling

```bash
cd client
npm run test:admin
npm run test:crystalball
```

> Client tests import `@testing-library/react` and use `@testing-library/jest-dom` matchers; both must be installed in the client workspace for these suites to run.

## Test Data

```javascript
// Team as stored in teamBoardConfig.json
{
  id: 'ncn',
  name: 'Nutanix Cloud Native',
  projectKey: 'NCN',
  boardId: 4741,
  baseFilter: 'filter=NCN-All-Base-Filter and statusCategory!=Done',
  sprintCalendar: { s1StartIso: '2020-02-20', sprintDays: 14 },
  featureComponents: { NKP: ['NKP-Core'] }
}
```

JIRA is never called in tests: the server suites inject a fake `JiraConnector` (`get`, `searchAll`, `searchCount`, `getProjectVersions`), and the client suites mock `utils/api`.

## Continuous Integration

### Test Automation
Tests are designed to run in CI/CD pipelines with:
- Automated API mocking
- No external dependencies
- Deterministic results
- Parallel execution support

### Coverage Requirements
- **Backend**: >90% line coverage for new features
- **Frontend**: >85% component and hook coverage  
- **Integration**: Key user workflows tested

## Debugging Test Failures

### Common Issues
1. **Mock setup**: Ensure API mocks match actual interfaces
2. **Async handling**: Proper await/act usage in tests
3. **State management**: Component state updates in tests
4. **Configuration**: Mock config files loaded correctly

### Debug Commands
```bash
# Run single test with debug output
npm test -- --testNamePattern="specific test name" --verbose

# Run with coverage report
npm run test:coverage

# Watch mode for development  
npm run test:watch
```

## Future Test Enhancements

### Planned Additions
- **Visual regression tests** for admin UI
- **API contract tests** for JIRA integration
- **Performance benchmarks** for large datasets
- **Accessibility tests** for admin components
- **Mobile responsive tests** for admin interface

### Test Infrastructure Improvements
- **Shared test utilities** across frontend/backend
- **Mock JIRA server** for integration tests
- **Test data factories** for consistent fixtures
- **Automated test generation** for new team configurations

This comprehensive test suite ensures that all new features work correctly while maintaining backward compatibility with existing functionality.