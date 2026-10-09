import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();

// Servir archivos estáticos del cliente
app.use(express.static(path.join(__dirname, '../client')));

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Servidor autoritativo escuchando en http://0.0.0.0:${PORT}`);
});

// Configuración de la Arena y Mecánica de Pilla-Pilla
const ARENA = {
    width: 800,
    height: 600,
    playerRadius: 22,
    speed: 300,
    tagCooldownMs: 1800 // Tiempo de inmunidad (1.8s) para evitar recapturas inmediatas
};

// Paleta de colores para los corredores
const RUNNER_COLORS = [
    '#38bdf8', // Celeste / Azul Eléctrico
    '#10b981', // Verde Esmeralda
    '#a855f7', // Púrpura Neón
    '#f59e0b', // Ámbar
    '#06b6d4', // Turquesa
    '#ec4899'  // Rosa
];

// Estructura en memoria: Map<id, PlayerData>
const players = new Map();

// Control global del Pilla-Pilla
let currentHunterId = null;
let tagCooldownUntil = 0;

function getAvailableRunnerColor() {
    const usedColors = new Set([...players.values()].map(p => p.color));
    for (const c of RUNNER_COLORS) {
        if (!usedColors.has(c)) return c;
    }
    return RUNNER_COLORS[players.size % RUNNER_COLORS.length];
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const playerId = 'P-' + Math.floor(100 + Math.random() * 900);

    // El primer jugador que se conecta se convierte automáticamente en el cazador (isIt = true)
    const isFirstPlayer = players.size === 0 || !currentHunterId;
    const isIt = isFirstPlayer;
    if (isIt) {
        currentHunterId = playerId;
    }

    const assignedColor = getAvailableRunnerColor();

    // Posición inicial aleatoria dentro de la arena de 800x600 con margen seguro
    const margin = 60;
    const spawnX = margin + Math.random() * (ARENA.width - margin * 2);
    const spawnY = margin + Math.random() * (ARENA.height - margin * 2);

    const playerData = {
        id: playerId,
        ws: ws,
        x: Math.round(spawnX),
        y: Math.round(spawnY),
        vx: 0,
        vy: 0,
        color: assignedColor,
        isIt: isIt,
        joinedAt: Date.now()
    };

    players.set(playerId, playerData);
    ws.playerId = playerId;

    console.log(`[WS] Jugador conectado: ${playerId} (${isIt ? 'CAZADOR [isIt]' : 'CORREDOR'}) desde ${ip} (Total: ${players.size})`);

    // Enviar paquete inicial al cliente
    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        isIt: isIt,
        color: assignedColor,
        arena: {
            width: ARENA.width,
            height: ARENA.height,
            playerRadius: ARENA.playerRadius
        }
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Input del jugador
            if (data.type === 'input') {
                const player = players.get(ws.playerId);
                if (player) {
                    let vx = Number(data.vx) || 0;
                    let vy = Number(data.vy) || 0;

                    const mag = Math.hypot(vx, vy);
                    if (mag > 1) {
                        vx /= mag;
                        vy /= mag;
                    }

                    player.vx = vx;
                    player.vy = vy;
                }
            }

            // Ping-Pong para RTT
            if (data.type === 'ping' && typeof data.timestamp === 'number') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    serverTime: Date.now(),
                    clientTime: data.timestamp
                }));
            }
        } catch (e) {
            console.error(`[WS] Error en mensaje de ${playerId}:`, e.message);
        }
    });

    ws.on('close', () => {
        const wasHunter = ws.playerId === currentHunterId;
        players.delete(ws.playerId);
        console.log(`[WS] Jugador desconectado: ${playerId} (Restantes: ${players.size})`);

        // Si se desconectó el cazador, transferir el rol al siguiente jugador más antiguo
        if (wasHunter && players.size > 0) {
            const remaining = [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
            const nextHunter = remaining[0];
            if (nextHunter) {
                nextHunter.isIt = true;
                currentHunterId = nextHunter.id;
                tagCooldownUntil = Date.now() + 1500;
                console.log(`[TAG] Cazador desconectado. Nuevo cazador asignado por antigüedad: ${nextHunter.id}`);
            }
        } else if (players.size === 0) {
            currentHunterId = null;
        }
    });

    ws.on('error', (err) => {
        console.error(`[WS] Error en socket ${playerId}:`, err.message);
        players.delete(ws.playerId);
    });
});

// =========================================================================
// GAME LOOP AUTORITATIVO (20 Hz = cada 50 ms)
// =========================================================================
const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE; // 50 ms
const DT = 1 / TICK_RATE; // 0.05 s

setInterval(() => {
    if (players.size === 0) return;

    // 1. Físicas autoritativas y colisiones con los límites de la arena
    for (const [id, player] of players) {
        player.x += player.vx * ARENA.speed * DT;
        player.y += player.vy * ARENA.speed * DT;

        const minX = ARENA.playerRadius;
        const maxX = ARENA.width - ARENA.playerRadius;
        const minY = ARENA.playerRadius;
        const maxY = ARENA.height - ARENA.playerRadius;

        player.x = Math.max(minX, Math.min(maxX, player.x));
        player.y = Math.max(minY, Math.min(maxY, player.y));
    }

    // 2. Comprobación autoritativa de colisión circular del Pilla-Pilla
    const now = Date.now();
    if (now >= tagCooldownUntil && currentHunterId && players.has(currentHunterId)) {
        const hunter = players.get(currentHunterId);
        const hitDistance = ARENA.playerRadius * 2; // Suma de los radios: 22 + 22 = 44px

        for (const [id, other] of players) {
            if (id === currentHunterId) continue;

            const dist = Math.hypot(hunter.x - other.x, hunter.y - other.y);
            if (dist <= hitDistance) {
                // ¡COLISIÓN / CAPTURA!
                hunter.isIt = false;
                other.isIt = true;
                currentHunterId = other.id;
                tagCooldownUntil = now + ARENA.tagCooldownMs;

                console.log(`[TAG] ¡${hunter.id} atrapó a ${other.id}! Nuevo cazador: ${other.id} (Inmunidad: ${ARENA.tagCooldownMs}ms)`);
                break;
            }
        }
    }

    // 3. Empaquetar estado global incluyendo el campo `isIt`
    const statePlayers = [];
    for (const [id, player] of players) {
        const isIt = player.id === currentHunterId;
        player.isIt = isIt;

        statePlayers.push({
            id: player.id,
            x: Math.round(player.x * 10) / 10,
            y: Math.round(player.y * 10) / 10,
            vx: Math.round(player.vx * 100) / 100,
            vy: Math.round(player.vy * 100) / 100,
            color: player.color,
            isIt: isIt
        });
    }

    // 4. Emitir broadcast del estado global a todos los clientes
    const statePayload = JSON.stringify({
        type: 'state',
        players: statePlayers,
        hunterId: currentHunterId,
        serverTime: now
    });

    for (const [id, player] of players) {
        if (player.ws.readyState === 1) { // 1 = WebSocket.OPEN
            player.ws.send(statePayload);
        }
    }
}, TICK_INTERVAL);
