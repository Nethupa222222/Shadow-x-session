const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pair = require('./pair');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Endpoints
app.post('/api/create-session', pair.createSession(io));
app.get('/api/sessions', pair.getSessions);
app.delete('/api/session/:id', pair.deleteSession);

// Socket
io.on('connection', socket => {
  socket.on('join-session', sessionId => {
    socket.join(sessionId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server ready at http://localhost:${PORT}`);
});
