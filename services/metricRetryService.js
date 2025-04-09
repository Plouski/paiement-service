const path = require('path');
const fs = require('fs').promises;
const cron = require('node-cron');
const apiClient = require('../services/apiClientService');
const { logger } = require('../utils/logger');

class MetricRetryService {
  /**
   * Planifier la tâche de reprise des métriques échouées
   */
  static initializeRetryMechanism() {
    // Exécuter toutes les heures
    cron.schedule('0 * * * *', async () => {
      try {
        await this.retryFailedMetrics();
      } catch (error) {
        logger.error('Erreur lors de la reprise des métriques échouées:', error);
      }
    });
  }

  /**
   * Tenter de renvoyer les métriques échouées
   */
  static async retryFailedMetrics() {
    const failedMetricsFile = path.join(__dirname, '../failed-metrics.json');

    try {
      // Vérifier si le fichier existe
      let failedMetrics = [];
      try {
        failedMetrics = JSON.parse(await fs.readFile(failedMetricsFile, 'utf8'));
      } catch (readError) {
        if (readError.code === 'ENOENT') {
          logger.info('Aucune métrique échouée à retraiter');
          return;
        }
        throw readError;
      }

      // Si aucune métrique échouée
      if (failedMetrics.length === 0) {
        logger.info('Aucune métrique échouée à retraiter');
        return;
      }

      logger.info(`Tentative de reprise pour ${failedMetrics.length} métriques échouées`);

      // Tableau pour stocker les métriques qui ont besoin d'un nouveau traitement
      const metricsToRetry = [];

      // Traiter chaque métrique
      for (const metric of failedMetrics) {
        try {
          // Déterminer le type de métrique
          let result;
          if (metric.event === 'checkout_initiated') {
            result = await apiClient.metrics.recordPaymentEvent(metric);
          } else if (metric.event === 'subscription_canceled' || metric.event === 'subscription_upgraded') {
            result = await apiClient.metrics.recordSubscriptionEvent(metric);
          } else {
            logger.warn(`Type de métrique non reconnu: ${metric.event}`);
            continue;
          }

          // Si l'enregistrement échoue à nouveau
          if (!result.success) {
            metricsToRetry.push(metric);
          }
        } catch (retryError) {
          // Erreur de connexion ou autre problème
          metricsToRetry.push(metric);
          logger.warn(`Échec de reprise pour la métrique:`, retryError);
        }
      }

      // Mettre à jour le fichier avec les métriques qui n'ont pas pu être traitées
      await fs.writeFile(failedMetricsFile, JSON.stringify(metricsToRetry, null, 2));

      logger.info(`Reprise terminée. ${metricsToRetry.length} métriques restent à traiter`);
    } catch (error) {
      logger.error('Erreur lors du traitement des métriques échouées:', error);
    }
  }

  /**
   * Méthode utilitaire pour ajouter manuellement une métrique à retraiter
   */
  static async manuallyAddFailedMetric(metricData) {
    const failedMetricsFile = path.join(__dirname, '../failed-metrics.json');

    try {
      let failedMetrics = [];
      try {
        failedMetrics = JSON.parse(await fs.readFile(failedMetricsFile, 'utf8'));
      } catch (readError) {
        if (readError.code !== 'ENOENT') {
          throw readError;
        }
      }

      failedMetrics.push({
        ...metricData,
        manuallyAdded: true,
        timestamp: new Date().toISOString()
      });

      await fs.writeFile(failedMetricsFile, JSON.stringify(failedMetrics, null, 2));

      logger.info('Métrique ajoutée manuellement pour reprise');
    } catch (error) {
      logger.error('Erreur lors de l\'ajout manuel de la métrique:', error);
    }
  }
}

// Initialiser le mécanisme de reprise au démarrage du service
MetricRetryService.initializeRetryMechanism();

module.exports = MetricRetryService;