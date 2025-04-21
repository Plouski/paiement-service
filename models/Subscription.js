const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SubscriptionSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

  plan: { type: String, enum: ["free", "monthly", "annual", "premium"], default: "free" },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },

  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'cancelled', 'suspended', 'trialing', 'incomplete'], default: 'active' },
  paymentMethod: { type: String, enum: ['stripe', 'paypal', 'manual'], default: 'stripe' },

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

module.exports = mongoose.model('Subscription', SubscriptionSchema);
