import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ExecPageBriefing from '../../components/ExecPageBriefing';

jest.mock('../../components/Oncalls/OncallsParts', () => ({
  SummaryBody: ({ summary }) => <div data-testid="summary-body">{summary}</div>,
}));

describe('ExecPageBriefing', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ExecPageBriefing state="idle" summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows loading copy', () => {
    render(<ExecPageBriefing state="loading" summary={null} />);
    expect(screen.getByTestId('exec-page-briefing')).toBeTruthy();
    expect(screen.getByText(/Building an executive skim/i)).toBeTruthy();
  });

  it('renders summary when done', () => {
    render(
      <ExecPageBriefing
        state="done"
        summary="## What ails the team: RED\nTLDR line"
        meta={{ facetCount: 3, naiCalls: 4, compressed: false }}
      />
    );
    expect(screen.getByTestId('summary-body').textContent).toMatch(/What ails the team: RED/);
  });

  it('shows error and retry', () => {
    const onRetry = jest.fn();
    render(
      <ExecPageBriefing state="error" summary={null} error="boom" onRetry={onRetry} />
    );
    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
