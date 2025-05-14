// require('dotenv').config();
// const Stripe = require('stripe');
// const { logger } = require('../utils/logger');

// // Initialisation de Stripe avec la clé secrète
// let stripe;

// try {
//   const apiVersion = '2023-10-16'; // Utiliser une version spécifique de l'API
  
//   stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
//     apiVersion,
//     appInfo: {
//       name: 'ROADTRIP App',
//       version: '1.0.0',
//     },
//     typescript: false,
//     maxNetworkRetries: 2, // Réessayer automatiquement les requêtes en cas d'échec
//     timeout: 10000, // 10 secondes de timeout
//   });
  
//   logger.info('Stripe initialisé avec succès');
// } catch (error) {
//   logger.error(`Erreur lors de l'initialisation de Stripe: ${error.message}`);
  
//   // Créer un mock de Stripe pour les environnements sans clé API valide
//   if (!process.env.STRIPE_SECRET_KEY || process.env.NODE_ENV === 'development') {
//     logger.warn('Utilisation d\'un mock de Stripe pour l\'environnement de développement');
    
//     // Créer un mock de base pour Stripe
//     stripe = {
//       checkout: {
//         sessions: {
//           create: async () => ({
//             id: 'cs_test_' + Math.random().toString(36).substring(2, 15),
//             url: 'https://example.com/checkout/test',
//           }),
//         },
//       },
//       customers: {
//         create: async () => ({
//           id: 'cus_test_' + Math.random().toString(36).substring(2, 15),
//         }),
//         list: async () => ({ data: [] }),
//       },
//       subscriptions: {
//         retrieve: async () => ({
//           id: 'sub_test_' + Math.random().toString(36).substring(2, 15),
//           status: 'active',
//           items: { data: [{ price: { id: 'price_test' } }] },
//         }),
//         cancel: async () => ({ status: 'canceled' }),
//       },
//       webhooks: {
//         constructEvent: (body, signature, secret) => body,
//       },
//     };
//   } else {
//     // En production, propager l'erreur
//     throw error;
//   }
// }

// module.exports = stripe;