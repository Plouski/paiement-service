// payment-service/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { logger } = require('../utils/logger');

// Base URL for database service (fallback pour vérifier directement avec database-service)
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:5002';
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

/**
 * Middleware to verify JWT and authenticate user
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Autoriser l'appel sans token si l'API key de service est présente
      if (req.headers['x-api-key'] === SERVICE_API_KEY) {
        req.isServiceRequest = true;
        return next();
      }
      
      return res.status(401).json({
        error: 'Unauthorized - No token provided'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Option 1: Verify token locally
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        return next();
      } catch (error) {
        logger.error(`Error verifying JWT locally: ${error.message}`);
        // Si le token est expiré mais qu'on a l'ID utilisateur dans le body
        if (req.body && req.body.userId) {
          // Créer un utilisateur minimal pour permettre de continuer
          req.user = { 
            userId: req.body.userId,
            email: req.body.email || 'unknown@email.com'
          };
          logger.info(`Using userId from request body: ${req.body.userId}`);
          return next();
        }
        // Fall through to Option 2 if local verification fails
      }
    }
    
    // Si nous n'avons pas pu vérifier le token, mais que nous avons un userId dans le body
    if (req.body && req.body.userId) {
      // Créer un utilisateur minimal pour permettre de continuer
      req.user = { 
        userId: req.body.userId,
        email: req.body.email || 'unknown@email.com'
      };
      logger.info(`Using userId from request body: ${req.body.userId}`);
      return next();
    }
    
    // Si nous arrivons ici, l'authentification a échoué
    return res.status(401).json({
      error: 'Unauthorized - Invalid token'
    });
    
  } catch (error) {
    logger.error(`Authentication error: ${error.message}`);
    return res.status(500).json({
      error: 'Internal server error during authentication'
    });
  }
};

module.exports = authMiddleware;