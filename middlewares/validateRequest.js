// payment-service/middlewares/validateRequest.js
const { validationResult } = require('express-validator');
const { logger } = require('../utils/logger');

/**
 * Middleware de validation des requêtes avec express-validator
 * Vérifie les résultats de validation et retourne une réponse d'erreur formatée si nécessaire
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (errors.isEmpty()) {
    return next();
  }

  // Journaliser les erreurs de validation
  logger.warn('Validation de requête échouée', {
    path: req.path,
    method: req.method,
    errors: errors.array(),
    body: req.body,
    params: req.params,
    query: req.query,
    user: req.user ? { userId: req.user.userId } : 'non authentifié'
  });

  // Formatage convivial des erreurs pour le client
  const formattedErrors = errors.array().map(error => ({
    field: error.path,
    message: error.msg,
    value: error.value
  }));

  return res.status(400).json({
    error: 'Validation Error',
    message: 'Les données fournies ne sont pas valides',
    details: formattedErrors
  });
};

module.exports = validateRequest;