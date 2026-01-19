# Final Chat Project — Gold Edition Pro

Real-time chat using Node.js, Express, Socket.IO and MongoDB.

Features
- Group + private chat (Socket.IO)
- Message persistence in MongoDB (with in-memory fallback)
- Avatar upload, file attachments (stored in /uploads)
- Typing indicator, delivered/seen statuses, reactions
- Mobile-first responsive UI (Tailwind)
Run through node_modules already present if any issue doing write npm install and npm run and inside .env.example your mongodb atlas url *
<img width="428" height="485" alt="3" src="https://github.com/user-attachments/assets/d3d6cd7e-bc66-4ba9-840b-b8f083cc9d6b" />
<img width="852" height="735" alt="2" src="https://github.com/user-attachments/assets/196dd945-a751-46c2-aa20-678150cbe3a5" />
<img width="861" height="543" alt="1" src="https://github.com/user-attachments/assets/116250f4-3cf1-4c75-8ce8-3a45a360e56b" />
<img width="607" height="550" alt="4" src="https://github.com/user-attachments/assets/93295ded-44a0-4a20-b080-c3a72a8db7c6" />
Quick start
1. Install:
   - npm install
2. Configure:
   - Copy `.env.example` → `.env` and set MONGO_URI (recommended: `mongodb://127.0.0.1:27017/chat-app`)
3. Start MongoDB:
   - Docker: `docker run -d -p 27017:27017 --name mongo mongo:6`
   - or run your local mongod
4. Run server:
   - npm start
5. Open: http://localhost:3000 (open multiple tabs to test)

Important endpoints
- GET /health — returns DB status
- POST /avatar — form-data: avatar file + username
- POST /upload — form-data: file

Notes
- If MongoDB is down messages are stored in-memory temporarily and flushed to DB when it reconnects. If the server restarts before flush, in-memory messages are lost.
- Use `127.0.0.1` in MONGO_URI to avoid IPv6 (::1) connection issues on some systems.
- Do NOT commit `.env` or `/uploads` to the repo. Add them to `.gitignore`.

GitHub upload (quick)
- git init
- git add .
- git commit -m "Initial commit"
- git remote add origin <your-repo-url>
- git push -u origin main

Security / production tips
- Add authentication (JWT/sessions) before public use.
- Store images in uploads and chat pdf,img etc save in mongodb atlas.
- Use HTTPS and a process manager (pm2) in production.

License
MIT
