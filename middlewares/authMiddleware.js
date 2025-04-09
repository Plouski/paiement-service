// payment-service/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { logger } = require('../utils/logger');

// Base URL for database service
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const DATABASE_SERVICE_URL = process.env.DATABASE_SERVICE_URL || 'http://localhost:5002';
const SERVICE_API_KEY = process.env.SERVICE_API_KEY;

/**
 * Middleware to verify JWT and authenticate user
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Vérifier si une requête de service est présente (prioritaire)
    if (req.headers['x-api-key'] === SERVICE_API_KEY) {
      logger.info('Authentification via clé API de service réussie');
      req.isServiceRequest = true;
      return next();
    }
    
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {      
      return res.status(401).json({
        error: 'Unauthorized - No token provided'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Vérifier le token
    try {
      // Vérifier avec le AUTH Service
      const authResponse = await axios.post(
        `${AUTH_SERVICE_URL}/auth/verify-token`,
        { token },
        { timeout: 5000 }
      );
      
      if (authResponse.data && authResponse.data.valid) {
        // Token valide, extraire les informations utilisateur
        req.user = {
          userId: authResponse.data.user.id,
          email: authResponse.data.user.email,
          role: authResponse.data.user.role
        };
        
        logger.info(`Authentification réussie pour l'utilisateur ${req.user.userId}`);
        return next();
      }
      
      // Vérification locale si le AUTH Service échoue
    } catch (authServiceError) {
      logger.warn(`Échec de vérification via AUTH Service: ${authServiceError.message}. Tentative de vérification locale.`);
      
      // Option de secours: vérifier localement
      if (process.env.JWT_SECRET) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          req.user = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role
          };
          
          logger.info(`Authentification locale réussie pour l'utilisateur ${req.user.userId}`);
          return next();
        } catch (jwtError) {
          logger.error(`Erreur JWT locale: ${jwtError.message}`);
        }
      }
      
      // Utiliser l'userId du body comme dernier recours
      if (req.body && req.body.userId) {
        logger.info(`Utilisation de l'ID utilisateur depuis le body: ${req.body.userId}`);
        
        // Vérifier que cet utilisateur existe réellement
        try {
          const userResponse = await axios.get(
            `${DATABASE_SERVICE_URL}/api/users/${req.body.userId}`,
            { 
              headers: { 'x-api-key': SERVICE_API_KEY },
              timeout: 3000
            }
          );
          
          if (userResponse.data) {
            req.user = {
              userId: req.body.userId,
              email: userResponse.data.email || req.body.email || 'unknown@email.com',
              role: userResponse.data.role || 'user'
            };
            
            logger.info(`Utilisateur vérifié via Database Service: ${req.user.userId}`);
            return next();
          }
        } catch (dbError) {
          logger.warn(`Erreur lors de la vérification de l'utilisateur: ${dbError.message}`);
        }
      }
    }
    
    // Si toutes les tentatives ont échoué
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

/**
 * Middleware pour les requêtes de service à service
 */
const serviceAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== SERVICE_API_KEY) {
    logger.warn('Tentative d\'accès avec une clé API de service invalide');
    return res.status(401).json({ 
      error: 'Invalid service API key' 
    });
  }
  
  req.isServiceRequest = true;
  next();
};

/**
 * Middleware pour vérifier les rôles
 */
const checkRole = (roles = []) => {
  return (req, res, next) => {
    // Les requêtes de service ignorent la vérification de rôle
    if (req.isServiceRequest) {
      return next();
    }
    
    // Vérifier si l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }
    
    // Vérifier si le rôle de l'utilisateur est autorisé
    if (roles.length && !roles.includes(req.user.role)) {
      logger.warn(`Accès refusé - permissions insuffisantes pour l'utilisateur ${req.user.userId}`);
      return res.status(403).json({
        error: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

module.exports = {
  authMiddleware,
  serviceAuthMiddleware,
  checkRole
};