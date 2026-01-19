// models/User.js
const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  avatar: { type: String, default: null }
}, { timestamps: true });
module.exports = mongoose.model('User', UserSchema);