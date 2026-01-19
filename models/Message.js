// models/Message.js
const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true },
  by: { type: String, required: true }
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, default: 'all' },
  text: { type: String, default: '' },
  attachment: { type: Object, default: null },
  delivered: { type: Boolean, default: false },
  seen: { type: Boolean, default: false },
  reactions: { type: [ReactionSchema], default: [] }
}, { timestamps: { createdAt: 'createdAt' } });

module.exports = mongoose.model('Message', MessageSchema);