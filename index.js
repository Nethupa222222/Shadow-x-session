const express = require("express");
const { generatePairingCode } = require("./sessionHandler");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.post("/api/pair", async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "Phone number is required" });

  try {
    const result = await generatePairingCode(number);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Pairing failed" });
  }
});

app.listen(PORT, () => {
  console.log("SHADOW-N PRO™ pairing site running at http://localhost:" + PORT);
});