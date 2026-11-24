const request = require('supertest');
const express = require('express');
const fs = require('fs');
const realFs = jest.requireActual('fs');
const path = require('path');

jest.mock('../../services/authService', () => ({ checkFeatureAccess: jest.fn() }));
jest.mock('../../utils/jiraClient', () => ({ getJira: jest.fn() }));
jest.mock('../../middleware/auth/jira', () => ({
  validateJiraTokenMiddleware: (req, _res, next) => { req.jiraToken = 'tok'; next(); },
}));

const { checkFeatureAccess } = require('../../services/authService');
const adminRoutes = require('../../routes/admin');

function appWithAdmin() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

const TMP = path.join(__dirname, '__tmp_config_test__');

beforeAll(() => {
  try { realFs.mkdirSync(TMP, { recursive: true }); } catch {}
  for (const [file, data] of [
    ['oncallConfig.json', { defaultTeamId: 'ndb', onCallProject: 'OnCall', customFields: {}, rag: { redOpenP0: 1 } }],
    ['cfdcfiConfig.json', { kpiNamePattern: 'CFD|CFI', customFields: {} }],
    ['jiraConfig.json', { baseUrl: 'https://jira.example.com', description: 'test', token: 'secret-should-not-leak' }],
    ['kpiConfig.json', { teams: { ndb: [] } }],
    ['teamBoardConfig.json', { teams: [], defaultTeamId: 'ndb' }],
  ]) {
    realFs.writeFileSync(path.join(TMP, file), JSON.stringify(data, null, 2));
  }
});

describe('Config Admin routes (smoke)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    checkFeatureAccess.mockReturnValue({ authorized: true });
    app = appWithAdmin();
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      const s = String(p);
      if (s.includes('oncallConfig.json') || s.includes('cfdcfiConfig.json') || s.includes('jiraConfig.json') || s.includes('kpiConfig.json') || s.includes('teamBoardConfig.json')) {
        const base = path.basename(s);
        const tmpFile = path.join(TMP, base);
        if (realFs.existsSync(tmpFile)) return realFs.readFileSync(tmpFile, enc);
      }
      if (s.includes('kpiConfig.json')) return JSON.stringify({ teams: { ndb: [{ id: 'k1' }] } });
      try { return realFs.readFileSync(p, enc); } catch { return '{}'; }
    });
    jest.spyOn(fs, 'writeFileSync').mockImplementation((p, data) => {
      const s = String(p);
      if (s.includes('oncallConfig.json') || s.includes('cfdcfiConfig.json') || s.includes('jiraConfig.json') || s.includes('kpiConfig.json') || s.includes('teamBoardConfig.json')) {
        const base = path.basename(s);
        return realFs.writeFileSync(path.join(TMP, base), data);
      }
      return realFs.writeFileSync(p, data);
    });
    jest.spyOn(fs, 'statSync').mockImplementation((p) => {
      const s = String(p);
      if (s.includes('oncallConfig.json') || s.includes('cfdcfiConfig.json') || s.includes('jiraConfig.json') || s.includes('kpiConfig.json') || s.includes('teamBoardConfig.json')) {
        const base = path.basename(s);
        const tmpFile = path.join(TMP, base);
        if (realFs.existsSync(tmpFile)) return realFs.statSync(tmpFile);
      }
      try { return realFs.statSync(p); } catch (e) { throw e; }
    });
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const s = String(p);
      if (s.includes('oncallConfig.json') || s.includes('cfdcfiConfig.json') || s.includes('jiraConfig.json') || s.includes('kpiConfig.json') || s.includes('teamBoardConfig.json')) {
        const base = path.basename(s);
        if (realFs.existsSync(path.join(TMP, base))) return true;
      }
      return realFs.existsSync(p);
    });
    jest.spyOn(fs, 'copyFileSync').mockImplementation((src, dst) => {
      const s = String(src), d = String(dst);
      if (s.includes('oncallConfig.json') || s.includes('cfdcfiConfig.json') || s.includes('jiraConfig.json')) {
        const base = path.basename(s);
        const tmpSrc = path.join(TMP, base);
        if (realFs.existsSync(tmpSrc)) {
          const bakBase = path.basename(d);
          return realFs.copyFileSync(tmpSrc, path.join(TMP, bakBase));
        }
      }
      return realFs.copyFileSync(src, dst);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('GET /configs lists allowlisted configs', async () => {
    const res = await request(app).get('/api/admin/configs').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.configs)).toBe(true);
    const keys = res.body.configs.map(c => c.key);
    expect(keys).toContain('oncall');
    expect(keys).toContain('cfdcfi');
    expect(keys).not.toContain('allowedUsers');
  });

  test('GET /configs/:key returns full config for known key', async () => {
    const res = await request(app).get('/api/admin/configs/oncall').expect(200);
    expect(res.body.key).toBe('oncall');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.defaultTeamId).toBe('ndb');
  });

  test('GET /configs/:key 404 for unknown key', async () => {
    await request(app).get('/api/admin/configs/allowedUsers').expect(404);
    await request(app).get('/api/admin/configs/__proto__').expect(404);
  });

  test('PUT /configs/:key replaces config and enforces {data:} wrapper', async () => {
    await request(app).put('/api/admin/configs/oncall').send({ defaultTeamId: 'x' }).expect(400);
    const res = await request(app).put('/api/admin/configs/oncall').send({ data: { defaultTeamId: 'ndb', onCallProject: 'OnCall2', customFields: { myFlag: true } } }).expect(200);
    expect(res.body.data.customFields.myFlag).toBe(true);
    const check = await request(app).get('/api/admin/configs/oncall').expect(200);
    expect(check.body.data.customFields.myFlag).toBe(true);
  });

  test('PUT rejects non-object and forbidden keys', async () => {
    await request(app).put('/api/admin/configs/oncall').send({ data: [] }).expect(400);
    await request(app).put('/api/admin/configs/oncall').send({ data: null }).expect(400);
    await request(app).put('/api/admin/configs/oncall').send({ data: JSON.parse('{"__proto__": {}}') }).expect(400);
  });

  test('PUT respects editableKeys for jira (only baseUrl/description writable)', async () => {
    await request(app).put('/api/admin/configs/jira').send({ data: { baseUrl: 'https://jira.new.com', description: 'updated', token: 'hacked' } }).expect(200);
    const res = await request(app).get('/api/admin/configs/jira').expect(200);
    expect(res.body.data.baseUrl).toBe('https://jira.new.com');
    expect(res.body.data.token).not.toBe('hacked');
  });

  test('PATCH /configs/:key/field creates nested path', async () => {
    const res = await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: 'customFields.addedViaPatch', value: 42 }).expect(200);
    expect(res.body.data.customFields.addedViaPatch).toBe(42);
  });

  test('PATCH rejects missing fieldPath and forbidden paths', async () => {
    await request(app).patch('/api/admin/configs/oncall/field').send({ value: 1 }).expect(400);
    await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: '__proto__.x', value: 1 }).expect(400);
    await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: 'a.constructor.b', value: 1 }).expect(400);
    await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: 'a.prototype.b', value: 1 }).expect(400);
  });

  test('DELETE /configs/:key/field removes leaf and is idempotent', async () => {
    await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: 'customFields.toDelete', value: 'bye' }).expect(200);
    await request(app).delete('/api/admin/configs/oncall/field').send({ fieldPath: 'customFields.toDelete' }).expect(200);
    const after = await request(app).get('/api/admin/configs/oncall').expect(200);
    expect(after.body.data.customFields.toDelete).toBeUndefined();
    await request(app).delete('/api/admin/configs/oncall/field').send({ fieldPath: 'customFields.toDelete' }).expect(200);
    await request(app).delete('/api/admin/configs/oncall/field?fieldPath=customFields.addedViaPatch').expect(200);
  });

  test('DELETE rejects forbidden paths', async () => {
    await request(app).delete('/api/admin/configs/oncall/field').send({ fieldPath: '__proto__.x' }).expect(400);
    await request(app).delete('/api/admin/configs/oncall/field').send({ fieldPath: 'a.prototype.b' }).expect(400);
  });

  test('auth: all config endpoints 403 when not super-admin', async () => {
    checkFeatureAccess.mockReturnValue({ authorized: false, error: 'nope' });
    await request(app).get('/api/admin/configs').expect(403);
    await request(app).get('/api/admin/configs/oncall').expect(403);
    await request(app).put('/api/admin/configs/oncall').send({ data: {} }).expect(403);
    await request(app).patch('/api/admin/configs/oncall/field').send({ fieldPath: 'x', value: 1 }).expect(403);
    await request(app).delete('/api/admin/configs/oncall/field').send({ fieldPath: 'x' }).expect(403);
  });

  test('page contract: ConfigManager can discover oncall+cfdcfi via list then fetch each', async () => {
    const list = await request(app).get('/api/admin/configs').expect(200);
    for (const k of ['oncall', 'cfdcfi']) {
      expect(list.body.configs.some(c => c.key === k)).toBe(true);
      const res = await request(app).get(`/api/admin/configs/${k}`).expect(200);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data).toBe('object');
    }
  });
});
