// public/script.js — updated, full client that matches the HTML above
const socket = io();

let username = "";
let currentTarget = "all";
let myAvatarUrl = null;
let onlineUsersMap = {};

// Small emoji list for input and reactions
const EMOJIS = ["😀","😃","😄","😁","😆","🙂","😉","😍","😭","😎","👍","🙏","🎉","🔥"];
const REACTION_EMOJIS = ["👍","❤️","😂","😮","😢","👏"];

// Elements
const loginArea = document.getElementById('loginArea');
const appArea = document.getElementById('app');
const joinBtn = document.getElementById('joinBtn');
const avatarFile = document.getElementById('avatarFile');
const usernameInput = document.getElementById('username');

const messagesEl = document.getElementById('messages');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const emojiBtn = document.getElementById('emojiBtn');
const emojiBox = document.getElementById('emojiBox');
const userAvatarHeader = document.getElementById('userAvatarHeader');
const onlineCountEl = document.getElementById('onlineCount');

// Build emoji input picker
function buildEmojiPicker() {
  if (!emojiBox) return;
  emojiBox.innerHTML = '';
  EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e;
    b.className = 'p-1 mr-1';
    b.addEventListener('click', () => {
      msgInput.value += e;
      emojiBox.classList.add('hidden');
      msgInput.focus();
    });
    emojiBox.appendChild(b);
  });
}
buildEmojiPicker();

// Join
async function joinChat() {
  const name = usernameInput?.value?.trim();
  if (!name) return alert('Enter your name');
  username = name;

  // upload avatar if selected
  if (avatarFile && avatarFile.files && avatarFile.files[0]) {
    const fd = new FormData();
    fd.append('avatar', avatarFile.files[0]);
    fd.append('username', username);
    try {
      const res = await fetch('/avatar', { method: 'POST', body: fd });
      const json = await res.json().catch(()=>({}));
      if (json.url) myAvatarUrl = json.url;
    } catch (err) {
      console.error('avatar upload failed', err);
    }
  }

  // show app area
  loginArea.classList.add('hidden');
  appArea.classList.remove('hidden');
  renderMyAvatar();
  socket.emit('join', username);
}
joinBtn?.addEventListener('click', joinChat);
usernameInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinChat(); });

// render header avatar
function renderMyAvatar() {
  if (!userAvatarHeader) return;
  userAvatarHeader.innerHTML = '';
  if (myAvatarUrl) {
    const img = document.createElement('img'); img.src = myAvatarUrl; img.className = 'w-full h-full object-cover'; userAvatarHeader.appendChild(img);
  } else {
    userAvatarHeader.textContent = username ? username[0].toUpperCase() : '?';
  }
}

// Send message
sendBtn?.addEventListener('click', () => {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chatMessage', { from: username, to: currentTarget, text });
  msgInput.value = '';
});

// Attach file
attachBtn?.addEventListener('click', () => fileInput.click());
fileInput?.addEventListener('change', async () => {
  const f = fileInput.files[0];
  if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const json = await res.json();
    if (json.url) socket.emit('chatMessage', { from: username, to: currentTarget, text: '', attachment: json });
    fileInput.value = '';
  } catch (err) {
    console.error('upload error', err);
    alert('Upload failed');
  }
});

// Emoji picker toggle
emojiBtn?.addEventListener('click', () => emojiBox.classList.toggle('hidden'));

// Socket listeners and debug logs
function logClient(...args) { console.log('[client]', ...args); }

socket.on('connect', () => logClient('connected', socket.id));
socket.on('disconnect', () => logClient('disconnected'));

socket.on('loadMessages', msgs => {
  logClient('loadMessages', msgs && msgs.length);
  messagesEl.innerHTML = '';
  (msgs || []).forEach(m => appendMessage(m));
});

socket.on('message', m => {
  logClient('message', m && m._id, m && m.from);
  appendMessage(m);
  // mark delivered if it's for me (server persists)
  if (m.to === username || m.to === 'all') {
    try { socket.emit('delivered', { messageId: m._id }); } catch (e) {}
  }
});

socket.on('onlineUsers', arr => {
  logClient('onlineUsers', arr);
  onlineUsersMap = {};
  (arr || []).forEach(u => onlineUsersMap[u.name] = u);
  onlineCountEl && (onlineCountEl.innerText = (arr || []).length);
  // restore my avatar if server has it
  const me = (arr || []).find(x => x.name === username);
  if (me && me.avatar) {
    myAvatarUrl = me.avatar;
    renderMyAvatar();
  }
});

socket.on('reactionUpdate', ({ messageId, reactions }) => {
  const el = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) renderReactionsInto(el, reactions);
});

socket.on('statusUpdate', st => {
  // optional: handle delivered/seen UI if needed
  logClient('statusUpdate', st);
});

// Append message: ensure avatar shown (obj.avatar preferred)
function appendMessage(obj) {
  if (!obj || !obj._id) return;
  // avoid duplicates
  if (document.querySelector(`[data-msg-id="${obj._id}"]`)) return;

  const isMine = obj.from === username;
  const avatarUrl = obj.avatar || (onlineUsersMap[obj.from] && onlineUsersMap[obj.from].avatar) || null;

  const wrap = document.createElement('div');
  wrap.className = 'p-2';
  wrap.setAttribute('data-msg-id', obj._id);

  const row = document.createElement('div');
  row.className = `flex items-start gap-3 ${isMine ? 'justify-end' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold overflow-hidden';
  if (avatarUrl) {
    const img = document.createElement('img'); img.src = avatarUrl; img.className = 'w-full h-full object-cover'; avatar.appendChild(img);
  } else {
    avatar.textContent = (obj.from && obj.from[0]) ? obj.from[0].toUpperCase() : '?';
  }

  const bubble = document.createElement('div');
  bubble.className = `message-bubble rounded-xl p-2 ${isMine ? 'bg-gold text-white' : 'bg-gray-100 dark:bg-gray-700'}`;

  const head = document.createElement('div'); head.className = 'text-[11px] opacity-70'; head.textContent = obj.from; bubble.appendChild(head);

  if (obj.text) {
    const t = document.createElement('div'); t.className = 'mt-1'; t.textContent = obj.text; bubble.appendChild(t);
  }

  if (obj.attachment && obj.attachment.url) {
    if ((obj.attachment.name || '').match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      const a = document.createElement('a'); a.href = obj.attachment.url; a.target = '_blank';
      const im = document.createElement('img'); im.src = obj.attachment.url; im.className = 'attachment-thumb mt-2'; a.appendChild(im); bubble.appendChild(a);
    } else {
      const a = document.createElement('a'); a.href = obj.attachment.url; a.target = '_blank'; a.className = 'block mt-2 underline'; a.textContent = obj.attachment.name || 'Attachment'; bubble.appendChild(a);
    }
  }

  // reactions container
  const reactionsContainer = document.createElement('div');
  reactionsContainer.className = 'reactions-row';
  bubble.appendChild(reactionsContainer);

  // reaction button
  const reactBtn = document.createElement('button');
  reactBtn.className = 'p-1 rounded bg-white/20 ml-2';
  reactBtn.textContent = '🙂';
  reactBtn.title = 'React';
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openReactionPicker(reactBtn, obj._id);
  });

  // assemble
  if (isMine) {
    row.appendChild(bubble);
    row.appendChild(avatar);
  } else {
    row.appendChild(avatar);
    row.appendChild(bubble);
  }
  wrap.appendChild(row);
  // small action area after bubble
  row.appendChild(reactBtn);

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // render existing reactions
  renderReactionsInto(wrap, obj.reactions || []);
}

// render reactions into message element
function renderReactionsInto(msgEl, reactions) {
  const container = msgEl.querySelector('.reactions-row');
  if (!container) return;
  container.innerHTML = '';
  if (!reactions || reactions.length === 0) return;
  const map = {};
  reactions.forEach(r => {
    map[r.emoji] = map[r.emoji] || { count: 0, users: [] };
    map[r.emoji].count++;
    map[r.emoji].users.push(r.by);
  });
  Object.entries(map).forEach(([emoji, info]) => {
    const pill = document.createElement('div');
    pill.className = 'reaction-pill';
    if (info.users.includes(username)) pill.classList.add('you');
    pill.innerHTML = `${emoji} <span style="font-size:11px; opacity:.85">${info.count}</span>`;
    pill.addEventListener('click', () => {
      const messageId = msgEl.getAttribute('data-msg-id');
      socket.emit('react', { messageId, emoji });
    });
    container.appendChild(pill);
  });
}

// open reaction picker anchored to button
function openReactionPicker(buttonEl, messageId) {
  closeReactionPickers();
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  REACTION_EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e; b.style.fontSize = '18px';
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      socket.emit('react', { messageId, emoji: e });
      closeReactionPickers();
    });
    picker.appendChild(b);
  });
  document.body.appendChild(picker);
  const rect = buttonEl.getBoundingClientRect();
  picker.style.left = `${Math.max(8, rect.left)}px`;
  picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
  setTimeout(() => document.addEventListener('click', closeReactionPickers, { once: true }), 0);
}
function closeReactionPickers() { document.querySelectorAll('.reaction-picker').forEach(n => n.remove()); }

// convenience: request private history (not fully implemented UI)
function requestHistory(withUser) {
  socket.emit('requestHistory', { with: withUser });
}

// helper to clear messages
function clearMessages() { messagesEl.innerHTML = ''; }

// Expose for debugging
window._socket = socket;
window._client = { username, onlineUsersMap };
