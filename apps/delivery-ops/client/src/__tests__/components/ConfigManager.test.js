import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfigManager from '../../components/ConfigManager/ConfigManager';
import * as api from '../../shared/services/apiService';

jest.mock('../../shared/services/apiService', () => ({
  authenticatedGet: jest.fn(),
  authenticatedPut: jest.fn(),
  authenticatedPost: jest.fn(),
  authenticatedDelete: jest.fn(),
}));
jest.mock('../../hooks/useTeamAdmin', () => ({
  adminAuth: () => ({ jiraToken: 't', username: 'admin' }),
}));

const CONFIGS = [
  { key: 'oncall', file: 'oncallConfig.json', label: 'OnCall Config', group: 'oncall', description: 'OnCall thresholds' },
  { key: 'cfdcfi', file: 'cfdcfiConfig.json', label: 'CFD / CFI Config', group: 'cfdcfi', description: 'CFD heroes' },
  { key: 'jiraFields', file: 'jiraFieldsConfig.json', label: 'JIRA Fields', group: 'jira', description: 'fields' },
];
const ONCALL_DATA = { defaultTeamId: 'ndb', onCallProject: 'OnCall', customFields: { existing: true }, rag: { redOpenP0: 1 } };
const CFDCFI_DATA = { kpiNamePattern: 'CFD|CFI', customFields: {} };

describe('ConfigManager', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockListAndDetail() {
    api.authenticatedGet.mockImplementation((url) => {
      if (url === '/api/admin/configs') return Promise.resolve({ data: { success: true, configs: CONFIGS } });
      if (url === '/api/admin/configs/oncall') return Promise.resolve({ data: { success: true, key: 'oncall', file: 'oncallConfig.json', label: 'OnCall Config', description: 'd', data: ONCALL_DATA } });
      if (url === '/api/admin/configs/cfdcfi') return Promise.resolve({ data: { success: true, key: 'cfdcfi', file: 'cfdcfiConfig.json', label: 'CFD / CFI Config', data: CFDCFI_DATA } });
      if (url === '/api/admin/configs/jiraFields') return Promise.resolve({ data: { success: true, key: 'jiraFields', data: {} } });
      return Promise.reject(new Error('unexpected ' + url));
    });
  }

  test('shows loading then renders title and grouped nav', async () => {
    mockListAndDetail();
    render(<ConfigManager />);
    expect(screen.getByText('Loading configs…')).toBeInTheDocument();
    expect(await screen.findByText('Config Manager')).toBeInTheDocument();
    expect(screen.getByText('OnCall Config')).toBeInTheDocument();
    expect(screen.getByText('CFD / CFI Config')).toBeInTheDocument();
    // Group headings
    expect(screen.getByText(/OnCall/)).toBeInTheDocument();
  });

  test('renders JSON textarea and quick-remove rows for selected config', async () => {
    mockListAndDetail();
    render(<ConfigManager />);
    await screen.findByText('Config Manager');
    // textarea contains formatted JSON
    const ta = await screen.findByLabelText('Config JSON');
    expect(ta.value).toContain('"defaultTeamId"');
    expect(ta.value).toContain('"ndb"');
    // quick-remove rows
    expect(await screen.findByText('customFields.existing')).toBeInTheDocument();
    expect(screen.getByText('rag.redOpenP0')).toBeInTheDocument();
  });

  test('switching nav fetches new config', async () => {
    mockListAndDetail();
    render(<ConfigManager />);
    await screen.findByText('Config Manager');
    await screen.findByLabelText('Config JSON');
    fireEvent.click(screen.getByRole('button', { name: 'CFD / CFI Config' }));
    await waitFor(() => expect(api.authenticatedGet).toHaveBeenCalledWith('/api/admin/configs/cfdcfi', expect.anything(), expect.anything()));
    const ta = await screen.findByLabelText('Config JSON');
    await waitFor(() => expect(ta.value).toContain('kpiNamePattern'));
  });

  test('Save JSON disabled until dirty, then calls PUT with {data:} wrapper', async () => {
    mockListAndDetail();
    api.authenticatedPut.mockResolvedValue({ data: { success: true, file: 'oncallConfig.json', data: { ...ONCALL_DATA, hello: 'world' } } });
    render(<ConfigManager />);
    const ta = await screen.findByLabelText('Config JSON');
    const saveBtn = screen.getByRole('button', { name: 'Save JSON' });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(ta, { target: { value: JSON.stringify({ ...ONCALL_DATA, hello: 'world' }, null, 2) } });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(api.authenticatedPut).toHaveBeenCalledWith('/api/admin/configs/oncall', { data: expect.objectContaining({ hello: 'world' }) }, expect.anything()));
    expect(await screen.findByText(/oncallConfig\.json saved/)).toBeInTheDocument();
  });

  test('Save with invalid JSON shows error, does not call API', async () => {
    mockListAndDetail();
    render(<ConfigManager />);
    const ta = await screen.findByLabelText('Config JSON');
    fireEvent.change(ta, { target: { value: '{ bad json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save JSON' }));
    expect(await screen.findByText(/Invalid JSON/)).toBeInTheDocument();
    expect(api.authenticatedPut).not.toHaveBeenCalled();
  });

  test('Add field calls PATCH and clears inputs on success', async () => {
    mockListAndDetail();
    api.authenticatedPost.mockResolvedValue({ data: { success: true, data: { ...ONCALL_DATA, customFields: { existing: true, myFlag: true } } } });
    render(<ConfigManager />);
    await screen.findByLabelText('Config JSON');

    fireEvent.change(screen.getByLabelText('Field path (dot-notation)'), { target: { value: 'customFields.myFlag' } });
    fireEvent.change(screen.getByLabelText('Field value (JSON or plain text)'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add / Update field' }));
    await waitFor(() => expect(api.authenticatedPost).toHaveBeenCalledWith('/api/admin/configs/oncall/field', { fieldPath: 'customFields.myFlag', value: true }, expect.anything()));
    expect(await screen.findByText(/myFlag.*updated|added/i)).toBeInTheDocument();
  });

  test('Add field blocked when JSON is dirty', async () => {
    mockListAndDetail();
    render(<ConfigManager />);
    const ta = await screen.findByLabelText('Config JSON');
    fireEvent.change(ta, { target: { value: JSON.stringify({ dirty: true }, null, 2) } });
    fireEvent.change(screen.getByLabelText('Field path (dot-notation)'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add / Update field' }));
    expect(await screen.findByText(/unsaved JSON edits/)).toBeInTheDocument();
    expect(api.authenticatedPost).not.toHaveBeenCalled();
  });

  test('Add field shows error when API fails (e.g. forbidden path)', async () => {
    mockListAndDetail();
    api.authenticatedPost.mockRejectedValue({ response: { data: { error: 'Forbidden field path.' } } });
    render(<ConfigManager />);
    await screen.findByLabelText('Config JSON');
    fireEvent.change(screen.getByLabelText('Field path (dot-notation)'), { target: { value: '__proto__.x' } });
    fireEvent.change(screen.getByLabelText('Field value (JSON or plain text)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add / Update field' }));
    expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
  });

  test('Quick remove calls DELETE after confirm', async () => {
    mockListAndDetail();
    api.authenticatedDelete.mockResolvedValue({ data: { success: true, data: { defaultTeamId: 'ndb' } } });
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConfigManager />);
    await screen.findByLabelText('Config JSON');
    const btns = await screen.findAllByRole('button', { name: /Remove field customFields\.existing/ });
    fireEvent.click(btns[0]);
    await waitFor(() => expect(api.authenticatedDelete).toHaveBeenCalledWith('/api/admin/configs/oncall/field', { fieldPath: 'customFields.existing' }, expect.anything()));
    confirmSpy.mockRestore();
  });

  test('shows list error when /configs fails', async () => {
    api.authenticatedGet.mockRejectedValue({ response: { data: { error: 'Forbidden' } } });
    render(<ConfigManager />);
    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
  });

  test('shows config error when detail fetch fails', async () => {
    api.authenticatedGet.mockImplementation((url) => {
      if (url === '/api/admin/configs') return Promise.resolve({ data: { success: true, configs: CONFIGS } });
      return Promise.reject({ response: { data: { error: 'Not found' } } });
    });
    render(<ConfigManager />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});
