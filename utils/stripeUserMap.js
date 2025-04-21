const User = require("../models/User.js");

export async function getUserIdFromStripeCustomer(customerId) {
  const user = await User.findOne({ stripeCustomerId: customerId });
  return user?._id;
}