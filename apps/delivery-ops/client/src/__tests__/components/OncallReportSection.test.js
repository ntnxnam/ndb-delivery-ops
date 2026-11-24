import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import OncallReportSection from '../../components/OncallsV2/OncallReportSection';

describe('OncallReportSection', () => {
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let appendChildSpy;
  let clickSpy;
  let removeSpy;

  beforeEach(() => {
    if (!URL.createObjectURL) URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = jest.fn();
    createObjectURLSpy = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    global.Blob = jest.fn((content, opts) => ({ content, opts, type: opts?.type }));
    const origAppendChild = document.body.appendChild.bind(document.body);
    appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el && el.tagName === 'A') return el;
      return origAppendChild(el);
    });
    removeSpy = jest.fn();
    clickSpy = jest.fn();
    const origCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') {
        const a = origCreateElement(tag);
        a.click = clickSpy;
        const origRemove = a.remove.bind(a);
        a.remove = (...args) => { removeSpy(...args); return origRemove(...args); };
        return a;
      }
      return origCreateElement(tag);
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('single Download button (not dual)', () => {
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="" onPreview={jest.fn()} onSend={jest.fn()} />);
    expect(screen.getByText('Download Report')).toBeTruthy();
    expect(screen.queryByText(/Download HTML/)).toBeNull();
    expect(screen.getAllByText('Download Report').length).toBe(1);
  });

  test('cached html uses no fetch — appendChild+click+remove (Firefox compat)', async () => {
    const onPreview = jest.fn().mockResolvedValue({ html: '<div>report html</div>', to: ['a@nutanix.com'] });
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="" onPreview={onPreview} onSend={jest.fn()} />);

    fireEvent.click(screen.getByText('Preview'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('.ocv2-report-preview')).toBeTruthy());

    fireEvent.click(screen.getByText('Download Report'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(global.Blob).toHaveBeenCalledWith(expect.arrayContaining(['<div>report html</div>']), expect.objectContaining({ type: expect.stringContaining('text/html') }));

    jest.advanceTimersByTime(1100);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  test('fetch when no cache then caches', async () => {
    const onPreview = jest.fn().mockResolvedValue({ html: '<div>fresh</div>' });
    render(<OncallReportSection teamId="ndb" timeframe="Overall" busy={false} error="" onPreview={onPreview} onSend={jest.fn()} />);

    fireEvent.click(screen.getByText('Download Report'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('.ocv2-report-preview')).toBeTruthy());

    const callsBefore = onPreview.mock.calls.length;
    fireEvent.click(screen.getByText('Download Report'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalledTimes(2));
    expect(onPreview.mock.calls.length).toBe(callsBefore);
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  test('error surfaces via role=alert', async () => {
    const onPreview = jest.fn().mockRejectedValue(new Error('Preview failed'));
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="" onPreview={onPreview} onSend={jest.fn()} />);
    fireEvent.click(screen.getByText('Preview'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/Preview failed/);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });

  test('busy error prop surfaces via role=alert', () => {
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="Server error" onPreview={jest.fn()} onSend={jest.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Server error/);
  });

  test('label htmlFor matches input id', () => {
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="" onPreview={jest.fn()} onSend={jest.fn()} />);
    const label = document.querySelector('label[for="oc-report-to"]');
    expect(label).toBeTruthy();
    expect(label.getAttribute('htmlFor')).toBe('oc-report-to');
    const input = document.getElementById('oc-report-to');
    expect(input).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe('oc-report-hint');
  });

  test('no inline #fff — uses var(--surface-raised) tokens', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/OncallsV2/OncallReportSection.js'), 'utf8');
    expect(src).not.toMatch(/#fff/i);
    expect(src).not.toMatch(/#ffffff/i);
    const css = fs.readFileSync(path.join(__dirname, '../../components/OncallsV2/OncallsV2.css'), 'utf8');
    expect(css).toMatch(/ocv2-report/);
    expect(css).not.toMatch(/#fff/);
  });

  test('dead onDownload prop absent', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/OncallsV2/OncallReportSection.js'), 'utf8');
    expect(src).not.toMatch(/onDownload/);
    const propsMatch = src.match(/function OncallReportSection\(\{([^}]+)\}/);
    expect(propsMatch[1]).not.toMatch(/onDownload/);
  });

  test('Download error surfaces via role=alert', async () => {
    const onPreview = jest.fn().mockRejectedValue(new Error('Download failed'));
    render(<OncallReportSection teamId="ndb" timeframe="7d" busy={false} error="" onPreview={onPreview} onSend={jest.fn()} />);
    fireEvent.click(screen.getByText('Download Report'));
    await act(async () => { jest.advanceTimersByTime(0); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/Download failed/);
  });
});
