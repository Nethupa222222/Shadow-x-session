const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");

async function generatePairingCode(number) {
  return new Promise((resolve, reject) => {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: number })
    });

    client.on("qr", (qr) => {
      console.log("QR Code:", qr);
    });

    client.on("ready", () => {
      const sessionFile = `./sessions/session-${number}.json`;
      const sessionData = client.pupPage._client.session || { status: "paired" };
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
      resolve({ pairingCode: "Done! Open WhatsApp & complete pairing.", sessionSaved: true });
    });

    client.on("auth_failure", () => reject("Auth failed"));
    client.initialize();
  });
}

module.exports = { generatePairingCode };