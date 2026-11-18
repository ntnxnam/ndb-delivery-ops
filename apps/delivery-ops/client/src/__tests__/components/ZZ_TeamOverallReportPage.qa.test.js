import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../../utils/api', () => ({
  authenticatedGet: jest.fn(),
  getApiBase: jest.fn(() => ''),
}));
jest.mock('../../contexts/TeamContext', () => ({
  useTeam: () => ({ selectedTeamId: 'ndb', hasTeamSelected: true, isTransitioning: false, selectedTeam: { displayName: 'NDB Team' } }),
}));
jest.mock('../../layout/components/TeamRequiredGate', () => ({ TeamRequiredGate: () => null }));

import TeamOverallReportPage from '../../components/TeamOverallReportPage';

describe('QA', () => {
  it('renders', () => {
    const { authenticatedGet } = require('../../utils/api');
    authenticatedGet.mockReturnValue(new Promise(() => {}));
    render(<TeamOverallReportPage />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
  });
});