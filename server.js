const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Dynamically generate env.js with the token from environment
  if (req.url === '/env.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(`window.MAPBOX_TOKEN = '${MAPBOX_TOKEN}';\n`);
    return;
  }

  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Powder Map running on port ${PORT}`);
});
