const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubscriptionSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  plan: { type: String, enum: ["free", "monthly", "annual", "premium"], default: "free" },
  startDate: { type: Date, default: Date.now },
  endDate: { 
    type: Date,
    validate: {
      validator: function(v) {
        if (v === null || v === undefined) return true;
        return v instanceof Date && !isNaN(v.getTime());
      },
      message: 'endDate doit être une date valide ou null'
    }
  },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'canceled', 'suspended', 'trialing', 'incomplete'], default: 'active' },
  paymentMethod: { type: String, enum: ['stripe', 'paypal', 'manual'], default: 'stripe' },
  cancelationType: { type: String, enum: ['immediate', 'end_of_period'], default: null },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  stripePriceId: { type: String },
  sessionId: { type: String },
  lastPaymentDate: { type: Date },
  lastTransactionId: { type: String },
  paymentStatus: { type: String, enum: ['success', 'failed', 'pending'] },
  paymentFailureReason: { type: String },
  lastFailureDate: { type: Date }

}, {
  timestamps: true
});

// Pré-enregistrement (save) : validation et cohérence des données
SubscriptionSchema.pre('save', function(next) {
  if (this.endDate && (this.endDate === 'Invalid Date' || isNaN(this.endDate.getTime()))) {
    console.warn(`[⚠️] endDate invalide détectée lors du save pour l'utilisateur ${this.userId}, suppression de la valeur`);
    this.endDate = undefined;
  }

  // Si le statut est "canceled" et que la date de fin est passée, désactiver l'abonnement
  if (this.status === 'canceled' && this.endDate && new Date() >= this.endDate) {
    this.isActive = false;
    console.info(`[📅] Abonnement ${this._id} désactivé automatiquement (date expirée)`);
  }

  next();
});

// Pré-mise à jour : validation et nettoyage des dates via findOneAndUpdate
SubscriptionSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();

  if (update.endDate !== undefined) {
    if (update.endDate === null || update.endDate === 'null' || update.endDate === '') {
      console.warn(`[⚠️] endDate vide dans update, suppression`);
      delete update.endDate;
    } else if (isNaN(new Date(update.endDate).getTime())) {
      console.warn(`[⚠️] endDate "Invalid Date" dans update, suppression`);
      delete update.endDate;
    }
  }

  next();
});

// Méthode d'instance : calcule les jours restants avant expiration
SubscriptionSchema.methods.getDaysRemaining = function() {
  if (!this.endDate) return null;

  const now = new Date();
  const diffTime = this.endDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
};

// Méthode d'instance : vérifie si l’abonnement peut être réactivé
SubscriptionSchema.methods.canBeReactivated = function() {
  return this.status === 'canceled' &&
         this.isActive &&
         this.cancelationType === 'end_of_period' &&
         this.endDate &&
         new Date() < this.endDate;
};

// Méthode statique : désactive tous les abonnements expirés
SubscriptionSchema.statics.cleanupExpired = async function() {
  const now = new Date();

  const result = await this.updateMany(
    {
      status: 'canceled',
      isActive: true,
      endDate: { $lte: now }
    },
    {
      $set: { isActive: false }
    }
  );

  return result.modifiedCount;
};

module.exports = mongoose.model('Subscription', SubscriptionSchema);