// payment-service/middlewares/errorHandler.js
const { logger } = require('../utils/logger');

/**
 * Classe d'erreur personnalisée pour les erreurs API
 */
class ApiError extends Error {
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware global de gestion des erreurs
 * Assure une réponse d'erreur formatée et cohérente
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let errorMessage = err.message || 'Une erreur interne est survenue';
  let errorCode = err.code || 'INTERNAL_ERROR';
  let errorDetails = err.details || null;
  
  // Mapper les types d'erreurs spécifiques vers des codes d'erreur plus précis
  if (err.name === 'StripeError') {
    statusCode = 400;
    errorCode = `STRIPE_${err.type.toUpperCase()}`;
    
    // Mapper les erreurs Stripe spécifiques
    switch (err.type) {
      case 'StripeCardError':
        statusCode = 400;
        errorMessage = 'Erreur de carte bancaire';
        break;
      case 'StripeInvalidRequestError':
        statusCode = 400;
        errorMessage = 'Requête Stripe invalide';
        break;
      case 'StripeAPIError':
        statusCode = 502;
        errorMessage = 'Erreur du service de paiement';
        break;
      case 'StripeConnectionError':
        statusCode = 503;
        errorMessage = 'Impossible de se connecter au service de paiement';
        break;
      case 'StripeAuthenticationError':
        statusCode = 401;
        errorMessage = 'Erreur d\'authentification au service de paiement';
        break;
      case 'StripeRateLimitError':
        statusCode = 429;
        errorMessage = 'Trop de requêtes au service de paiement';
        break;
    }
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    errorMessage = 'Les données fournies ne sont pas valides';
    errorDetails = err.errors;
  } else if (err.name === 'MongoError' && err.code === 11000) {
    statusCode = 409;
    errorCode = 'DUPLICATE_KEY';
    errorMessage = 'Conflit de données';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    errorMessage = 'Token d\'authentification invalide';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    errorMessage = 'Token d\'authentification expiré';
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    errorMessage = 'Un service requis est temporairement indisponible';
  }
  
  // Journaliser l'erreur avec des détails
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel](`${statusCode} ${errorCode}: ${errorMessage}`, {
    url: req.originalUrl,
    method: req.method,
    stack: err.stack,
    details: errorDetails,
    user: req.user ? { id: req.user.userId, email: req.user.email } : 'unknown'
  });
  
  // Construire la réponse d'erreur
  const errorResponse = {
    error: {
      code: errorCode,
      message: errorMessage,
      ...(errorDetails && { details: errorDetails })
    }
  };
  
  // Ajouter la stack trace en développement
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.error.stack = err.stack;
  }
  
  // Envoyer la réponse
  res.status(statusCode).json(errorResponse);
};

// Middleware pour attraper les erreurs asynchrones
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  asyncHandler,
  ApiError
};