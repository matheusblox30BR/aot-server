/* Servidor multiplayer de "Attack On Titan Shattered": salas por código, repassa o estado dos jogadores. */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 8;
const rooms = new Map(); /* código -> Map(id -> socket) */
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('AOT Shattered server online\n');
});
const wss = new WebSocketServer({ server });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) {
  for (const [, s] of room) if (s !== except) send(s, obj);
}
function leave(ws) {
  if (!ws.room) return;
  const room = rooms.get(ws.room);
  if (room) {
    room.delete(ws.id);
    broadcast(room, { t: 'left', id: ws.id });
    if (room.size === 0) rooms.delete(ws.room);
  }
  ws.room = null;
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    if (raw.length > 2048) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join') {
      leave(ws);
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'SALA';
      let room = rooms.get(code);
      if (!room) { room = new Map(); rooms.set(code, room); }
      if (room.size >= MAX_PER_ROOM) { send(ws, { t: 'full' }); return; }
      ws.room = code;
      ws.name = String(m.name || 'Jogador').slice(0, 14);
      room.set(ws.id, ws);
      send(ws, { t: 'welcome', id: ws.id, room: code, players: [...room.values()].filter(s => s !== ws).map(s => ({ id: s.id, name: s.name })) });
      broadcast(room, { t: 'joined', id: ws.id, name: ws.name }, ws);
    } else if (m.t === 's' && ws.room) {
      /* estado do jogador: posição, direção, pose, forma de titã */
      const room = rooms.get(ws.room);
      if (room) broadcast(room, { t: 's', id: ws.id, p: m.p }, ws);
    } else if (m.t === 'e' && ws.room) {
      /* evento pontual (soco, transformação, gancho...) */
      const room = rooms.get(ws.room);
      if (room) broadcast(room, { t: 'e', id: ws.id, k: m.k, d: m.d }, ws);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

/* derruba conexões mortas */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false; ws.ping();
  });
}, 20000);

server.listen(PORT, () => console.log('Servidor na porta ' + PORT));
