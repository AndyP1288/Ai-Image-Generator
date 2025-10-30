// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();

// Use built-in fetch on Node 18+; if you need node-fetch, install and import it.
// const fetch = require('node-fetch');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // serve index.html and admin.html

// Config - set these in your Render environment variables
const HF_MODEL = process.env.HF_MODEL || "black-forest-labs/FLUX.1-dev";
const HF_TOKEN = process.env.HF_TOKEN;             // Hugging Face token
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // admin password (secret)
const LOG_FILE = path.join(__dirname, 'logs.json'); // plaintext log file

if (!HF_TOKEN) console.warn('Warning: HF_TOKEN not set in env vars.');
if (!ADMIN_PASSWORD) console.warn('Warning: ADMIN_PASSWORD not set in env vars.');

// Helper: safe append to logs.json (keeps an array of entries)
function appendLogEntry(entry) {
  let entries = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf8');
      if (raw && raw.trim().length > 0) entries = JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading logs.json', e);
    // continue with empty array so we don't lose logs
  }

  entries.push(entry);

  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('Error writing logs.json', e);
  }
}

// Image generation endpoint — returns an array of 3 images
app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });
  if (!HF_TOKEN) return res.status(500).json({ error: "Server not configured (HF_TOKEN missing)" });

  try {
    const images = [];
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
        method: 'POST',
        headers: {
          "Authorization": `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: prompt })
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      images.push(`data:image/png;base64,${base64}`);
    }

    // Log entry: timestamp, prompt, sha256 hashes of images (minimizes storing raw images)
    const imageHashes = images.map(img => {
      const base64Part = img.split(',')[1] || img;
      return crypto.createHash('sha256').update(base64Part, 'base64').digest('hex');
    });

    const logEntry = {
      timestamp: new Date().toISOString(),
      prompt,
      imageHashes,
      model: HF_MODEL
    };

    // Append plaintext log (JSON)
    appendLogEntry(logEntry);

    // Return images to client
    res.json({ image: images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: returns logs.json if the password is correct
app.get('/admin/logs', (req, res) => {
  const supplied = req.headers['x-admin-password'] || req.query.password;
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured on server.' });
  }
  if (!supplied || supplied !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (!fs.existsSync(LOG_FILE)) return res.json({ logs: [] });
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const entries = raw && raw.trim().length > 0 ? JSON.parse(raw) : [];
    return res.json({ logs: entries });
  } catch (e) {
    console.error('Error reading logs.json', e);
    return res.status(500).json({ error: 'Failed to read logs' });
  }
});

// (Optional) simple route to check health
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
