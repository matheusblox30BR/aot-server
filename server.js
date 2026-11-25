// Servidor multiplayer — Attack on Titan Survival
// Salas públicas (entra automático) e privadas (código de 4 letras).
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000; // o Render define a PORT sozinho
const MAX = 8;                          // jogadores por sala
const FORMS = ['', 'fem', 'eren', 'kruger', 'wh'];
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();
let nextId = 1;

const code4 = () => {
  let s = '';
  for (let i = 0; i < 4; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
  return s;
};

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    let n = 0;
    rooms.forEach(r => (n += r.players.size));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ salas: rooms.size, jogadores: n }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Servidor Attack on Titan Survival online');
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (room, o, except) => {
  const m = JSON.stringify(o);
  for (const p of room.players.values()) {
    if (p.ws !== except && p.ws.readyState === 1) p.ws.send(m);
  }
};
const info = p => ({ id: p.id, name: p.name, x: p.x, z: p.z, r: p.r, f: p.f });

function newRoom(priv) {
  let code;
  do { code = priv ? code4() : 'P' + code4(); } while (rooms.has(code));
  const room = { code, priv, players: new Map() };
  rooms.set(code, room);
  return room;
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.players.delete(ws.id);
  ws.room = null;
  if (room.players.size === 0) rooms.delete(room.code);
  else bcast(room, { t: 'pl', id: ws.id });
}

wss.on('connection', ws => {
  ws.id = nextId++;
  ws.room = null;
  ws.isAlive = true;
  ws.cnt = 0;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    if (++ws.cnt > 60) return; // limite de mensagens por segundo
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      if (ws.room) return;
      let room;
      if (m.mode === 'public') {
        room = [...rooms.values()].find(r => !r.priv && r.players.size < MAX) || newRoom(false);
      } else if (m.mode === 'create') {
        room = newRoom(true);
      } else if (m.mode === 'join') {
        const c = String(m.code || '').toUpperCase().trim();
        room = rooms.get(c);
        if (!room || !room.priv) return send(ws, { t: 'err', msg: 'Código não encontrado.' });
        if (room.players.size >= MAX) return send(ws, { t: 'err', msg: 'Sala cheia.' });
      } else return;

      const name = String(m.name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 14) || 'Jogador';
      const p = { id: ws.id, ws, name, x: 0, z: 0, r: 0, f: '', dirty: false };
      send(ws, {
        t: 'joined', id: p.id, code: room.priv ? room.code : '', priv: room.priv,
        players: [...room.players.values()].map(info)
      });
      room.players.set(p.id, p);
      ws.room = room;
      bcast(room, { t: 'pj', p: info(p) }, ws);
    } else if (m.t === 'pos' && ws.room) {
      const p = ws.room.players.get(ws.id);
      const x = +m.x, z = +m.z, r = +m.r;
      if (!p || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r)) return;
      p.x = Math.max(-5000, Math.min(5000, x));
      p.z = Math.max(-5000, Math.min(5000, z));
      p.r = r;
      p.f = FORMS.includes(m.f) ? m.f : '';
      p.dirty = true;
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// envia o estado das salas ~15x por segundo
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size < 2) continue;
    const arr = [];
    for (const p of room.players.values()) {
      if (p.dirty) {
        arr.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.r.toFixed(2), p.f]);
        p.dirty = false;
      }
    }
    if (arr.length) bcast(room, { t: 's', p: arr });
  }
}, 66);

// zera o limite de mensagens e derruba conexões mortas
setInterval(() => wss.clients.forEach(ws => { ws.cnt = 0; }), 1000);
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
