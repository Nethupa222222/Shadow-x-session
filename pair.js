const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir);

const sessions = new Map(); // Keep active clients

function getSessionPath(sessionId) {
    return path.join(sessionsDir, sessionId);
}

function createSession(io) {
    return async (req, res) => {
        let { sessionId } = req.body;
        if (!sessionId) sessionId = 'session-' + Date.now();

        if (sessions.has(sessionId)) {
            return res.json({ success: true, sessionId });
        }

        const client = new Client({
            authStrategy: new LocalAuth({ dataPath: getSessionPath(sessionId) }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        });

        sessions.set(sessionId, client);

        client.on('qr', async (qr) => {
            const qrDataURL = await qrcode.toDataURL(qr);
            io.to(sessionId).emit('qr', { sessionId, qr: qrDataURL });
        });

        client.on('ready', async () => {
            const user = await client.getMe();
            io.to(sessionId).emit('status', {
                sessionId,
                status: 'connected',
                user: {
                    id: user.id._serialized,
                    name: user.pushname || 'User',
                },
            });
        });

        client.on('authenticated', () => {
            io.to(sessionId).emit('status', {
                sessionId,
                status: 'connecting',
            });
        });

        client.on('disconnected', (reason) => {
            sessions.delete(sessionId);
            io.to(sessionId).emit('status', {
                sessionId,
                status: 'disconnected',
            });
        });

        client.on('message', async (msg) => {
            const contact = await msg.getContact();
            io.to(sessionId).emit('message', {
                sessionId,
                name: contact.pushname || contact.number,
                message: msg.body,
                timestamp: msg.timestamp * 1000,
            });
        });

        client.initialize();

        res.json({ success: true, sessionId });
    };
}

function getSessions(req, res) {
    const active = [];
    for (const [sessionId, client] of sessions.entries()) {
        active.push({
            sessionId,
            isConnected: client.info?.wid !== undefined,
            user: client.info?.wid
                ? {
                      id: client.info.wid._serialized,
                      name: client.info.pushname || 'User',
                  }
                : null,
        });
    }
    res.json({ success: true, sessions: active });
}

function deleteSession(req, res) {
    const sessionId = req.params.id;

    if (!sessions.has(sessionId)) {
        return res.json({ success: false, error: 'Session not found' });
    }

    const client = sessions.get(sessionId);
    client.destroy();
    sessions.delete(sessionId);

    const sessionPath = getSessionPath(sessionId);
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    res.json({ success: true });
}

module.exports = {
    createSession,
    getSessions,
    deleteSession,
};
