const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
const Registry = client.Registry;

const register = new Registry();
collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpDurationHistogram = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// ➡️ CUSTOM : Paiements
const paymentsTotal = new client.Counter({
  name: 'payments_total',
  help: 'Nombre total de paiements traités',
  labelNames: ['status'], // success / failed
  registers: [register],
});

module.exports = {
  register,
  httpRequestsTotal,
  httpDurationHistogram,
  paymentsTotal,
};
