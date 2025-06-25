const { logger } = require('../utils/logger');
const requestStore = new Map();

class RateLimitMiddleware {

  // Rate limiting
  static createRateLimit(maxRequests = 10, windowMinutes = 1) {
    return (req, res, next) => {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const windowMs = windowMinutes * 60 * 1000;

      for (const [key, data] of requestStore.entries()) {
        if (now - data.firstRequest > windowMs) {
          requestStore.delete(key);
        }
      }

      if (!requestStore.has(ip)) {
        requestStore.set(ip, {
          count: 1,
          firstRequest: now
        });
        return next();
      }

      const data = requestStore.get(ip);
      
      if (now - data.firstRequest > windowMs) {
        data.count = 1;
        data.firstRequest = now;
        return next();
      }

      data.count++;

      if (data.count > maxRequests) {
        const resetIn = Math.ceil((windowMs - (now - data.firstRequest)) / 1000);
        
        logger.warn(`🚫 Rate limit dépassé`, { ip, count: data.count, limit: maxRequests });

        return res.status(429).json({
          error: "Trop de requêtes",
          retryAfter: resetIn,
          message: `Veuillez patienter ${resetIn} secondes`
        });
      }

      next();
    };
  }

  // Rate limiting pour les paiements
  static paymentRateLimit() {
    return this.createRateLimit(3, 5);
  }

  // Rate limiting pour les remboursements
  static refundRateLimit() {
    return this.createRateLimit(2, 15);
  }

  // Rate limiting général
  static generalRateLimit() {
    return this.createRateLimit(60, 1);
  }
}

module.exports = RateLimitMiddleware;