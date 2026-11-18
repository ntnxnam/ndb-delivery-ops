export default function helloLoomRoute(app) {
  app.get('/api/hello-loom', (req, res) => res.json({ ok: true, from: 'loom' }));
}
