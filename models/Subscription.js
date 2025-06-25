const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SubscriptionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["free", "monthly", "annual", "premium"],
      default: "free",
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    endDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (v === null || v === undefined) return true;
          return v instanceof Date && !isNaN(v.getTime());
        },
        message: "endDate doit être une date valide ou null",
      },
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "canceled", "suspended", "trialing", "incomplete"],
      default: "active",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["stripe", "paypal", "manual"],
      default: "stripe",
    },
    cancelationType: {
      type: String,
      enum: ["immediate", "end_of_period"],
      default: null,
    },
    stripeCustomerId: { type: String, index: true },
    stripeSubscriptionId: { type: String, index: true },
    stripePriceId: { type: String },
    sessionId: { type: String },
    lastPaymentDate: { type: Date, index: true },
    lastTransactionId: { type: String },
    paymentStatus: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "success",
    },
    paymentFailureReason: { type: String },
    lastFailureDate: { type: Date },
    refundStatus: {
      type: String,
      enum: ["none", "processed", "failed"],
      default: "none",
    },
    refundAmount: { type: Number, default: 0 },
    refundDate: { type: Date, default: null },
    refundReason: { type: String, default: null },
    totalPaid: { type: Number, default: 0 },
    totalRefunded: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Index pour les performances
SubscriptionSchema.index({ userId: 1, status: 1, isActive: 1 });
SubscriptionSchema.index({ stripeCustomerId: 1, stripeSubscriptionId: 1 });

// Validation pré-sauvegarde
SubscriptionSchema.pre("save", function (next) {
  if (
    this.endDate &&
    (this.endDate === "Invalid Date" || isNaN(this.endDate.getTime()))
  ) {
    console.warn(`[⚠️] endDate invalide pour ${this.userId}, suppression`);
    this.endDate = undefined;
  }

  // Désactiver si expiré
  if (
    this.status === "canceled" &&
    this.endDate &&
    new Date() >= this.endDate
  ) {
    this.isActive = false;
  }

  next();
});

// Nettoyage des dates en mise à jour
SubscriptionSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  if (update.endDate !== undefined) {
    if (
      update.endDate === null ||
      update.endDate === "null" ||
      update.endDate === ""
    ) {
      delete update.endDate;
    } else if (isNaN(new Date(update.endDate).getTime())) {
      delete update.endDate;
    }
  }

  next();
});

// Jours restants
SubscriptionSchema.methods.getDaysRemaining = function () {
  if (!this.endDate) return null;

  const diffTime = this.endDate.getTime() - Date.now();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
};

module.exports = mongoose.model("Subscription", SubscriptionSchema);
