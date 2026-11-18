/**
 * Page-family AC: each surface family mounts ExecPageBriefing when wired.
 * Smoke-imports the page modules and asserts the briefing symbol is referenced
 * (guards against accidental un-wire regressions).
 */
describe('What ails the team — page wiring', () => {
  const pages = [
    { name: 'KPIPage', path: '../../components/KPIPage' },
    { name: 'OncallsPage', path: '../../components/OncallsPage' },
    { name: 'CfdCfiPage', path: '../../components/CfdCfiPage' },
    { name: 'SystemTestScalePage', path: '../../components/SystemTestScalePage' },
    { name: 'ReleaseVersionTab', path: '../../components/ReleaseVersionTab' },
    { name: 'FeatureDashboardPage', path: '../../feature/FeatureDashboardPage' },
  ];

  pages.forEach(({ name, path }) => {
    it(`${name} imports ExecPageBriefing + useExecPageBriefing`, () => {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const src = require('fs').readFileSync(
        require('path').join(__dirname, path + '.js'),
        'utf8'
      );
      expect(src).toMatch(/ExecPageBriefing/);
      expect(src).toMatch(/useExecPageBriefing/);
      expect(src).toMatch(/isExecAudience/);
    });
  });
});
