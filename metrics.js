const promClient = require('prom-client');

// Registre
const register = new promClient.Registry();

// Métriques par défaut (CPU, mémoire, etc.) - VITALS obligatoires
promClient.collectDefaultMetrics({
  register,
  prefix: `${process.env.SERVICE_NAME || 'service'}_`
});

// MÉTRIQUES STANDARD POUR TOUS LES MICROSERVICES

// 1. Santé du service
const serviceHealthStatus = new promClient.Gauge({
  name: 'service_health_status',
  help: 'Service health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['service_name'],
  registers: [register]
});

// 2. Temps de réponse HTTP
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// 3. Nombre total de requêtes
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// 4. Connexions actives
const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  registers: [register]
});

// 5. Status base de données
const databaseStatus = new promClient.Gauge({
  name: 'database_status',
  help: 'Database connection status (1 = connected, 0 = disconnected)',
  labelNames: ['database_type'],
  registers: [register]
});

// 6. Services externes
const externalServiceHealth = new promClient.Gauge({
  name: 'external_service_health',
  help: 'External service health (1 = healthy, 0 = unhealthy)',
  labelNames: ['service_name'],
  registers: [register]
});

// HELPERS SIMPLES

// Helper pour mettre à jour la santé du service
function updateServiceHealth(serviceName, isHealthy) {
  serviceHealthStatus.set({ service_name: serviceName }, isHealthy ? 1 : 0);
}

// Helper pour mettre à jour la DB
function updateDatabaseHealth(dbType, isConnected) {
  databaseStatus.set({ database_type: dbType }, isConnected ? 1 : 0);
}

// Helper pour les services externes
function updateExternalServiceHealth(serviceName, isHealthy) {
  externalServiceHealth.set({ service_name: serviceName }, isHealthy ? 1 : 0);
}

// Helper pour les connexions actives
function updateActiveConnections(count) {
  activeConnections.set(count);
}

module.exports = {
  register,
  serviceHealthStatus,
  httpRequestDuration,
  httpRequestsTotal,
  activeConnections,
  databaseStatus,
  externalServiceHealth,
  updateServiceHealth,
  updateDatabaseHealth,
  updateExternalServiceHealth,
  updateActiveConnections
};