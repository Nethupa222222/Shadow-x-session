// api/pair.js
import { Client } from 'whatsapp-web.js';
import { writeFileSync } from 'fs';
import { pushToGitHub } from '../utils/github.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body;

  try {
    const client = new Client({
      authStrategy: new RemoteAuth({
        pairingCode: code,
        clientId: 'shadowx',
        dataPath: './sessions'
      }),
    });

    client.on('ready', async () => {
      const user = await client.getMe();
      await client.sendMessage(user.id._serialized, `✅ SHADOW-X PRO™ is connected!\nSession generated.`);
      await pushToGitHub(user.id.user, './sessions/shadowx.json');
      res.status(200).json({ message: 'Connected! Check your WhatsApp.' });
    });

    client.initialize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to connect.' });
  }
}
