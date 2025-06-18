const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ───────────── Métriques HTTP ─────────────
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

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_custom_seconds',
  help: 'Temps de réponse des requêtes HTTP (custom)',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// ───────────── Métriques spécifiques paiement ─────────────
const paymentsTotal = new client.Counter({
  name: 'payments_total',
  help: 'Nombre total de paiements traités',
  labelNames: ['status'], // success / failed
  registers: [register],
});

// ───────────── Métriques santé ─────────────
const serviceHealthStatus = new client.Gauge({
  name: 'service_health_status',
  help: 'État de santé du service (1=healthy, 0=unhealthy)',
  labelNames: ['service_name'],
  registers: [register],
});

const externalServiceHealth = new client.Gauge({
  name: 'external_service_health',
  help: 'État de santé des services externes (1=up, 0=down)',
  labelNames: ['service_name'],
  registers: [register],
});

module.exports = {
  register,
  httpRequestsTotal,
  httpDurationHistogram,
  httpRequestDuration,
  paymentsTotal,
  serviceHealthStatus,
  externalServiceHealth,
};