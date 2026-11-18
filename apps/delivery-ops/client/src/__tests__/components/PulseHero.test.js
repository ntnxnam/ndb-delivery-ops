import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PulseHero from '../../components/KpiPulse/PulseHero';

describe('PulseHero', () => {
  const cell = { count: 7, jql: 'project = ERA AND statusCategory != Done' };

  test('without onOpen, count is a JIRA link', () => {
    render(
      <PulseHero label="Open now" cell={cell} jiraBaseUrl="https://jira.example.com" />
    );
    const link = screen.getByRole('link', { name: '7' });
    expect(link.getAttribute('href')).toContain('jql=');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  test('with onOpen, count is a button that opens panel; JIRA hint remains', () => {
    const onOpen = jest.fn();
    render(
      <PulseHero
        label="Open now"
        cell={cell}
        jiraBaseUrl="https://jira.example.com"
        onOpen={onOpen}
      />
    );
    const btn = screen.getByRole('button', { name: /Show Open now: 7/i });
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const jiraHint = screen.getByRole('link', { name: /Open Open now in JIRA/i });
    expect(jiraHint.getAttribute('href')).toContain('jql=');
  });

  test('without jql and without onOpen, count is plain text', () => {
    render(<PulseHero label="Net" cell={{ count: 3, jql: null }} />);
    expect(screen.getByText('3').tagName).toBe('SPAN');
  });
});
