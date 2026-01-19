// server.js — full updated server with avatar enrichment and in-memory fallback
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const { Server } = require('socket.io');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e6,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Multer config (store locally)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const ext = path.extname(file.originalname || '');
    const name = path.basename(file.originalname || '', ext).replace(/\s+/g, '_');
    cb(null, `${unique}-${name}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/', 'video/', 'audio/', 'application/pdf'];
    if (allowed.some(type => file.mimetype.startsWith(type))) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// Models
const Message = require('./models/Message');
const User = require('./models/User');

// In-memory fallback stores (used when Mongo is unavailable)
let inMemoryMessages = []; // messages
let inMemoryUsers = {};    // username => { username, avatar }

// Helpers
function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

async function saveMessage(doc) {
  if (isDbConnected()) {
    const m = new Message(doc);
    await m.save();
    return {
      _id: m._id.toString(),
      from: m.from,
      to: m.to,
      text: m.text,
      attachment: m.attachment,
      delivered: m.delivered,
      seen: m.seen,
      reactions: m.reactions || [],
      createdAt: m.createdAt
    };
  } else {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const rec = Object.assign({}, doc, { _id: id, reactions: doc.reactions || [], createdAt: new Date() });
    inMemoryMessages.push(rec);
    return rec;
  }
}

async function updateMessageStatus(messageId, patch) {
  if (isDbConnected()) {
    await Message.findByIdAndUpdate(messageId, patch).exec();
  } else {
    const msg = inMemoryMessages.find(m => String(m._id) === String(messageId));
    if (msg) Object.assign(msg, patch);
  }
}

async function queryMessages(usernameLocal, peer) {
  // returns array of messages (plain objects) — we'll enrich with avatar afterwards
  let msgs;
  if (isDbConnected()) {
    let query;
    if (!peer || peer === 'all') query = { $or: [{ to: 'all' }, { to: usernameLocal }, { from: usernameLocal }] };
    else query = { $or: [{ to: 'all' }, { $and: [{ from: usernameLocal }, { to: peer }] }, { $and: [{ from: peer }, { to: usernameLocal }] }] };
    msgs = await Message.find(query).sort({ createdAt: 1 }).limit(500).lean();
  } else {
    msgs = inMemoryMessages.filter(m => {
      if (!peer || peer === 'all') return (m.to === 'all' || m.to === usernameLocal || m.from === usernameLocal);
      return (m.to === 'all') || (m.from === usernameLocal && m.to === peer) || (m.from === peer && m.to === usernameLocal);
    }).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-500);
  }

  // Enrich each message with sender avatar (if available)
  const senders = Array.from(new Set(msgs.map(m => m.from).filter(Boolean)));
  const avatarMap = await findUsersByNames(senders);
  return msgs.map(m => Object.assign({}, m, { avatar: avatarMap[m.from] || null }));
}

async function findUsersByNames(names) {
  if (!names || names.length === 0) return {};
  if (isDbConnected()) {
    const rows = await User.find({ username: { $in: names } }).lean();
    const map = {};
    rows.forEach(r => map[r.username] = r.avatar);
    return map;
  } else {
    const map = {};
    names.forEach(n => { if (inMemoryUsers[n]) map[n] = inMemoryUsers[n].avatar; });
    return map;
  }
}

async function upsertUserAvatar(username, avatarUrl) {
  if (!username) return;
  if (isDbConnected()) {
    let user = await User.findOne({ username });
    if (!user) user = new User({ username, avatar: avatarUrl });
    else user.avatar = avatarUrl;
    await user.save();
  } else {
    inMemoryUsers[username] = { username, avatar: avatarUrl };
  }
}

// Mongo connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chat-app';
mongoose.set('strictQuery', false);
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ Mongo Error:', err && err.message ? err.message : err);
  });

// Upload endpoints
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!req.file || !username) return res.status(400).json({ error: 'Missing avatar or username' });
    const url = '/uploads/' + req.file.filename;
    await upsertUserAvatar(username, url);
    // broadcast updated online users (so avatar appears)
    await emitOnlineUsers();
    return res.json({ url });
  } catch (err) {
    console.error('Avatar error:', err);
    return res.status(500).json({ error: 'Avatar upload failed' });
  }
});

// Socket logic
let socketUsers = {}; // socketId -> username
let userSockets = {}; // username -> socketId

async function emitOnlineUsers() {
  try {
    const names = Array.from(new Set(Object.values(socketUsers)));
    const map = await findUsersByNames(names);
    const enriched = names.map(name => ({ name, avatar: map[name] || null }));
    io.emit('onlineUsers', enriched);
  } catch (err) {
    console.error('emitOnlineUsers error:', err && err.message ? err.message : err);
    const basic = Array.from(new Set(Object.values(socketUsers))).map(n => ({ name: n, avatar: null }));
    io.emit('onlineUsers', basic);
  }
}

io.on('connection', (socket) => {
  console.log('🟢 Connected:', socket.id);

  socket.on('join', async (username) => {
    try {
      if (!username) return;
      socket.username = username;
      socketUsers[socket.id] = username;
      userSockets[username] = socket.id;

      await emitOnlineUsers();
      // send system announcement
      io.emit('message', { _id: null, from: 'System', to: 'all', text: `${username} joined`, createdAt: new Date(), delivered: true, seen: false, avatar: null });

      // load and send messages (enriched with avatar)
      const msgs = await queryMessages(username, 'all');
      socket.emit('loadMessages', msgs);
    } catch (err) {
      console.error('join error:', err);
    }
  });

  socket.on('typing', (data) => {
    if (!data || !data.from) return;
    if (data.to && data.to !== 'all') {
      const targetSocket = userSockets[data.to];
      if (targetSocket) io.to(targetSocket).emit('typing', data);
    } else {
      socket.broadcast.emit('typing', data);
    }
  });

  socket.on('chatMessage', async (data) => {
    try {
      if (!data || !data.from || (!data.text && !data.attachment)) return;
      const to = data.to || 'all';
      const doc = {
        from: data.from,
        to,
        text: data.text || '',
        attachment: data.attachment || null,
        delivered: false,
        seen: false,
        reactions: []
      };
      const saved = await saveMessage(doc);

      // get avatar for the sender
      let avatarUrl = null;
      const avatarMap = await findUsersByNames([saved.from]);
      avatarUrl = avatarMap[saved.from] || null;

      const payload = {
        _id: saved._id,
        from: saved.from,
        to: saved.to,
        text: saved.text,
        attachment: saved.attachment,
        createdAt: saved.createdAt,
        delivered: saved.delivered,
        seen: saved.seen,
        reactions: saved.reactions || [],
        avatar: avatarUrl
      };

      if (to === 'all') io.emit('message', payload);
      else {
        socket.emit('message', payload);
        const tgt = userSockets[to];
        if (tgt) io.to(tgt).emit('message', payload);
      }
    } catch (err) {
      console.error('chatMessage error:', err && err.message ? err.message : err);
    }
  });

  // Reaction toggle
  socket.on('react', async ({ messageId, emoji }) => {
    try {
      if (!messageId || !emoji) return;
      const by = socket.username || 'unknown';
      if (isDbConnected()) {
        const msg = await Message.findById(messageId);
        if (!msg) return;
        msg.reactions = msg.reactions || [];
        const idx = msg.reactions.findIndex(r => r.emoji === emoji && r.by === by);
        if (idx !== -1) msg.reactions.splice(idx, 1);
        else msg.reactions.push({ emoji, by });
        await msg.save();
        io.emit('reactionUpdate', { messageId, reactions: msg.reactions });
      } else {
        const m = inMemoryMessages.find(x => String(x._id) === String(messageId));
        if (!m) return;
        m.reactions = m.reactions || [];
        const idx = m.reactions.findIndex(r => r.emoji === emoji && r.by === by);
        if (idx !== -1) m.reactions.splice(idx, 1);
        else m.reactions.push({ emoji, by });
        io.emit('reactionUpdate', { messageId, reactions: m.reactions });
      }
    } catch (err) {
      console.error('react error:', err && err.message ? err.message : err);
    }
  });

  socket.on('delivered', async ({ messageId }) => {
    try {
      if (!messageId) return;
      await updateMessageStatus(messageId, { delivered: true });
      io.emit('statusUpdate', { messageId, delivered: true });
    } catch (err) {
      console.error('delivered error:', err && err.message ? err.message : err);
    }
  });

  socket.on('seen', async ({ messageId }) => {
    try {
      if (!messageId) return;
      await updateMessageStatus(messageId, { seen: true });
      io.emit('statusUpdate', { messageId, seen: true });
    } catch (err) {
      console.error('seen error:', err && err.message ? err.message : err);
    }
  });

  socket.on('requestHistory', async ({ with: peer }) => {
    try {
      const usernameLocal = socket.username;
      if (!usernameLocal) return;
      const msgs = await queryMessages(usernameLocal, peer);
      socket.emit('loadMessages', msgs);
    } catch (err) {
      console.error('requestHistory error:', err && err.message ? err.message : err);
      socket.emit('loadMessages', []);
    }
  });

  socket.on('disconnect', () => {
    const name = socketUsers[socket.id];
    if (name) {
      delete socketUsers[socket.id];
      if (userSockets[name] === socket.id) delete userSockets[name];
      emitOnlineUsers();
      io.emit('message', { _id: null, from: 'System', to: 'all', text: `${name} left`, createdAt: new Date(), delivered: true, seen: false, avatar: null });
    }
    console.log('🔴 Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));