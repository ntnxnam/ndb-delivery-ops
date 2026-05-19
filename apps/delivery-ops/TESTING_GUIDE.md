# Testing Guide for Parent Project Support & New Features

## Overview
This guide covers testing for the comprehensive system enhancements including parent project support, dynamic filter construction, admin onboarding, and Crystal Ball integration.

## Test Suites Created

### Backend Tests

#### 1. Admin Routes Tests (`server/__tests__/routes/admin.test.js`)
Tests the super admin team management functionality:

**Coverage:**
- Team creation (dedicated & parent projects)
- Team listing and management
- JIRA project validation
- Filter validation
- User authorization checks
- Configuration file management

**Key Test Cases:**
- ✅ Create dedicated project team (NDB-style)
- ✅ Create parent project team with version patterns (DataLens-style) 
- ✅ Validate JIRA project accessibility
- ✅ Test filter validation with real JIRA calls
- ✅ Handle authorization checks
- ✅ Reject duplicate team IDs
- ✅ Validate required fields

**Run Tests:**
```bash
cd server
npm run test:admin
```

#### 2. Parent Project JIRA Tests (`server/__tests__/routes/jira-parent-project.test.js`)
Tests the enhanced JIRA integration with parent project support:

**Coverage:**
- Version filtering by regex patterns
- Dynamic filter construction
- Backward compatibility with dedicated projects
- Version discovery API
- Case-insensitive pattern matching

**Key Test Cases:**
- ✅ NDB (dedicated) returns all versions unfiltered
- ✅ DataLens (parent) filters by `^DataLens.*` and `^DL.*` patterns
- ✅ Case-insensitive pattern matching works
- ✅ Empty version lists handled gracefully
- ✅ Teams without patterns (backward compatibility)
- ✅ Dynamic filter construction works correctly
- ✅ Config overrides take precedence

**Run Tests:**
```bash
cd server
npm run test:parent-project
```

### Frontend Tests

#### 3. Crystal Ball Hook Tests (`client/src/__tests__/hooks/useCrystalBall.test.js`)
Tests the AI prediction functionality:

**Coverage:**
- Status checking and initialization
- Release prediction generation
- Trend analysis fetching
- Risk forecast generation
- Error handling and edge cases
- Loading states and data management

**Key Test Cases:**
- ✅ Fetch Crystal Ball status successfully
- ✅ Generate release predictions with proper data transformation
- ✅ Handle prediction errors and rate limiting
- ✅ Validate required parameters
- ✅ Clear data functionality
- ✅ Network timeout handling

**Run Tests:**
```bash
cd client
npm run test:crystalball
```

#### 4. Admin Panel Component Tests (`client/src/__tests__/components/AdminPanel.test.js`)
Tests the team onboarding wizard and admin interface:

**Coverage:**
- Admin panel rendering and access control
- Team onboarding wizard workflow
- Form validation and error handling
- JIRA project validation UI
- Step navigation and completion

**Key Test Cases:**
- ✅ Access control for super admin users
- ✅ Team wizard step progression
- ✅ Form validation on each step
- ✅ JIRA project validation with UI feedback
- ✅ Version pattern management (add/remove)
- ✅ Team creation workflow completion
- ✅ Error handling and user feedback

**Run Tests:**
```bash
cd client
npm run test:admin
```

## Running All New Feature Tests

### Server Side
```bash
cd server
npm run test:new-features
```

### Client Side
```bash
cd client
npm run test:new-features
```

### Full Test Suite
```bash
# From project root
cd server && npm test && cd ../client && npm test
```

## Test Scenarios Covered

### 1. Parent Project Architecture
- **Scenario**: DataLens team in ENG parent project
- **Tests**: Version filtering, pattern matching, configuration validation
- **Backward Compatibility**: Ensure NDB (dedicated project) continues working

### 2. Dynamic Configuration
- **Scenario**: New release versions without manual config updates
- **Tests**: Dynamic filter construction, config override precedence
- **Validation**: `filter={version}-All` pattern generation

### 3. Admin Onboarding
- **Scenario**: Super admin creates new team through wizard
- **Tests**: Multi-step validation, JIRA integration, configuration updates
- **Security**: Authorization checks, input validation

### 4. Crystal Ball Integration
- **Scenario**: AI predictions in Release Trends page
- **Tests**: API integration, data transformation, error handling
- **Performance**: Caching, rate limiting, graceful degradation

## Integration Testing

### End-to-End Team Setup Flow
1. **Admin creates team** via onboarding wizard
2. **System validates** JIRA project and filters
3. **Team configuration** is saved across multiple config files
4. **Version filtering** works correctly for team type
5. **Crystal Ball predictions** generate for team releases

### Backward Compatibility Validation
1. **Existing NDB team** continues working without changes
2. **Legacy configuration** (without projectType) defaults correctly
3. **Config overrides** take precedence over dynamic construction
4. **API calls** maintain same interface with optional parameters

## Performance Testing

### Load Testing Scenarios
- **Multiple teams** with different project types
- **Large version lists** in parent projects
- **Concurrent admin operations**
- **Crystal Ball predictions** for multiple releases

### Monitoring Points
- JIRA API rate limiting compliance
- Configuration file I/O performance
- Memory usage with cached data
- Response times for AI predictions

## Error Scenarios Tested

### Network & API Errors
- JIRA server unavailable
- Invalid authentication tokens
- Rate limiting responses
- Malformed API responses

### Configuration Errors  
- Invalid team configurations
- Missing JIRA filters
- Duplicate team IDs
- Invalid version patterns

### User Input Errors
- Invalid team names/IDs
- Missing required fields
- Invalid JIRA project keys
- Malformed filter queries

## Test Data & Mocks

### Mock Team Configurations
```javascript
// Dedicated project (NDB)
{
  id: 'ndb',
  projectKey: 'ERA', 
  projectType: 'dedicated'
}

// Parent project (DataLens)
{
  id: 'datalens',
  projectKey: 'ENG',
  projectType: 'parent',
  versionPatterns: ['^DataLens.*', '^DL.*']
}
```

### Mock JIRA Responses
- Project validation responses
- Version lists with mixed products
- Filter validation results
- Error responses for edge cases

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