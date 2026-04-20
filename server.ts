import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { spawn } from 'child_process';

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});

  app.use(express.json());

  // API Routes
  app.post('/api/compute-stats', (req, res) => {
    const data = req.body; // Array of objects
    
    // Safety check for input size
    if (!Array.isArray(data) || data.length > 1000) {
      return res.status(400).json({ error: 'Invalid data payload' });
    }

    const python = spawn('python3', ['stats_engine.py']);
    let output = '';
    
    python.stdin.write(JSON.stringify(data));
    python.stdin.end();
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      console.error(`Python stderr: ${data}`);
    });
    
    python.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: 'Python process exited with error' });
      }
      try {
        res.json(JSON.parse(output));
      } catch (e) {
        console.error('Failed to parse python output:', output);
        res.status(500).json({ error: 'Failed to parse statistics output' });
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
