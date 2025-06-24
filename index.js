const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const cors = require('cors');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Session management
const sessions = new Map();
const sessionDir = './sessions';

// Ensure sessions directory exists
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

// Logger
const logger = pino({ level: 'silent' });

class WhatsAppBot {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.sock = null;
        this.qr = null;
        this.isConnected = false;
        this.authDir = path.join(sessionDir, sessionId);
    }

    async initialize() {
        try {
            // Create auth directory if it doesn't exist
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger,
                browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
                defaultQueryTimeoutMs: 60000,
            });

            // Event handlers
            this.sock.ev.on('creds.update', saveCreds);
            this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
            this.sock.ev.on('messages.upsert', this.handleMessages.bind(this));

            sessions.set(this.sessionId, this);
            return this;
        } catch (error) {
            console.error(`Error initializing session ${this.sessionId}:`, error);
            throw error;
        }
    }

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            this.qr = qr;
            QRCode.toDataURL(qr, (err, url) => {
                if (!err) {
                    io.to(this.sessionId).emit('qr', { qr: url, sessionId: this.sessionId });
                }
            });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed for session ${this.sessionId}. Reconnecting: ${shouldReconnect}`);
            
            this.isConnected = false;
            io.to(this.sessionId).emit('status', { 
                status: 'disconnected', 
                sessionId: this.sessionId,
                shouldReconnect 
            });

            if (shouldReconnect) {
                setTimeout(() => {
                    this.initialize().catch(console.error);
                }, 5000);
            } else {
                this.cleanup();
            }
        } else if (connection === 'open') {
            console.log(`WhatsApp connected for session: ${this.sessionId}`);
            this.isConnected = true;
            io.to(this.sessionId).emit('status', { 
                status: 'connected', 
                sessionId: this.sessionId,
                user: this.sock.user 
            });
        }
    }

    async handleMessages(m) {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const messageType = Object.keys(msg.message)[0];
            let messageContent = '';

            switch (messageType) {
                case 'conversation':
                    messageContent = msg.message.conversation;
                    break;
                case 'extendedTextMessage':
                    messageContent = msg.message.extendedTextMessage.text;
                    break;
                default:
                    messageContent = `[${messageType}]`;
            }

            const sender = jidNormalizedUser(msg.key.remoteJid);
            const senderName = msg.pushName || sender.split('@')[0];

            // Emit message to connected clients
            io.to(this.sessionId).emit('message', {
                sessionId: this.sessionId,
                from: sender,
                name: senderName,
                message: messageContent,
                type: messageType,
                timestamp: new Date()
            });

            // Auto-reply example
            if (messageContent.toLowerCase().includes('hello') || messageContent.toLowerCase().includes('hi')) {
                await this.sendMessage(sender, 'Hello! How can I help you today?');
            }

        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    async sendMessage(to, message) {
        try {
            if (!this.isConnected) throw new Error('Bot not connected');
            
            await this.sock.sendMessage(to, { text: message });
            return { success: true };
        } catch (error) {
            console.error('Error sending message:', error);
            return { success: false, error: error.message };
        }
    }

    cleanup() {
        if (this.sock) {
            this.sock.end();
        }
        sessions.delete(this.sessionId);
        
        // Clean up session files
        if (fs.existsSync(this.authDir)) {
            fs.rmSync(this.authDir, { recursive: true, force: true });
        }
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-session', (sessionId) => {
        socket.join(sessionId);
        console.log(`Client joined session: ${sessionId}`);
        
        const session = sessions.get(sessionId);
        if (session) {
            socket.emit('status', { 
                status: session.isConnected ? 'connected' : 'connecting',
                sessionId: sessionId,
                user: session.sock?.user 
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/create-session', async (req, res) => {
    try {
        const sessionId = req.body.sessionId || `session_${Date.now()}`;
        
        if (sessions.has(sessionId)) {
            return res.status(400).json({ 
                error: 'Session already exists',
                sessionId 
            });
        }

        const bot = new WhatsAppBot(sessionId);
        await bot.initialize();

        res.json({ 
            success: true, 
            sessionId,
            message: 'Session created successfully' 
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ 
            error: 'Failed to create session',
            details: error.message 
        });
    }
});

app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.keys()).map(id => ({
        sessionId: id,
        isConnected: sessions.get(id).isConnected,
        user: sessions.get(id).sock?.user
    }));
    
    res.json({ sessions: sessionList });
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { sessionId, to, message } = req.body;
        
        if (!sessionId || !to || !message) {
            return res.status(400).json({ 
                error: 'Missing required fields: sessionId, to, message' 
            });
        }

        const session = sessions.get(sessionId);
        if (!session) {
            return res.status(404).json({ 
                error: 'Session not found' 
            });
        }

        const result = await session.sendMessage(to, message);
        res.json(result);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ 
            error: 'Failed to send message',
            details: error.message 
        });
    }
});

app.delete('/api/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.cleanup();
    res.json({ success: true, message: 'Session deleted successfully' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    
    // Close all sessions
    sessions.forEach(session => {
        session.cleanup();
    });
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 WhatsApp Bot Server running on port ${PORT}`);
    console.log(`📱 Visit http://localhost:${PORT} to manage your bot`);
});
