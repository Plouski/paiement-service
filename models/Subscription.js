const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubscriptionSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

  plan: { type: String, enum: ["free", "monthly", "annual", "premium"], default: "free" },
  startDate: { type: Date, default: Date.now },
  
  // 🔥 VALIDATION AMÉLIORÉE pour endDate
  endDate: { 
    type: Date,
    validate: {
      validator: function(v) {
        // Permettre null/undefined, mais valider si présent
        if (v === null || v === undefined) return true;
        
        // Vérifier que c'est une date valide
        return v instanceof Date && !isNaN(v.getTime());
      },
      message: 'endDate doit être une date valide ou null'
    }
  },

  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'canceled', 'suspended', 'trialing', 'incomplete'], default: 'active' },
  paymentMethod: { type: String, enum: ['stripe', 'paypal', 'manual'], default: 'stripe' },

  // Type d'annulation
  cancelationType: { 
    type: String, 
    enum: ['immediate', 'end_of_period'], 
    default: null 
  },

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

// 🔥 PRE-SAVE : Validation et nettoyage des dates
SubscriptionSchema.pre('save', function(next) {
  // Nettoyer endDate si invalide
  if (this.endDate && (this.endDate === 'Invalid Date' || isNaN(this.endDate.getTime()))) {
    console.warn(`[⚠️] endDate invalide détectée lors du save, suppression`);
    this.endDate = undefined;
  }
  
  // S'assurer que isActive est cohérent avec le statut et la date
  if (this.status === 'canceled' && this.endDate && new Date() >= this.endDate) {
    this.isActive = false;
  }
  
  next();
});

// 🔥 PRE-UPDATE : Validation lors des mises à jour
SubscriptionSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  // Valider endDate dans les mises à jour
  if (update.endDate !== undefined) {
    if (update.endDate === null || update.endDate === 'null' || update.endDate === '') {
      console.warn(`[⚠️] endDate invalide dans update, suppression`);
      delete update.endDate;
    } else if (update.endDate && isNaN(new Date(update.endDate).getTime())) {
      console.warn(`[⚠️] endDate Invalid Date dans update, suppression`);
      delete update.endDate;
    }
  }
  
  next();
});

// Méthode pour calculer les jours restants
SubscriptionSchema.methods.getDaysRemaining = function() {
  if (!this.endDate) return null;
  
  const now = new Date();
  const diffTime = this.endDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
};

// Méthode pour vérifier si l'abonnement peut être réactivé
SubscriptionSchema.methods.canBeReactivated = function() {
  return this.status === 'canceled' && 
         this.isActive && 
         this.cancelationType === 'end_of_period' &&
         this.endDate && 
         new Date() < this.endDate;
};

// Méthode statique pour nettoyer les abonnements expirés
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