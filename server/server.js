import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();

// Servir archivos estáticos del cliente sin caché para desarrollo inmediato
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});
app.use(express.static(path.join(__dirname, '../client'), {
    etag: false,
    maxAge: 0
}));

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Servidor autoritativo escuchando en http://0.0.0.0:${PORT}`);
});

// =========================================================================
// =========================================================================
// CONFIGURACIÓN DE LA ARENA Y FÍSICAS (1.5x VELOCIDAD)
// =========================================================================
const ARENA = {
    width: 800,
    height: 900,
    playerRadius: 18,           // Radio de colisión del avatar
    collisionRadius: 14,        // Radio de colisión contra el rastro
    trailThickness: 6,          // Grosor visual del rastro
    speed: 420,                 // 1.5x más rápido (antes 280 px/s -> ahora 420 px/s)
    minSelfCollisionPoints: 12, // Puntos recientes ignorados para no autogolpearse
    inactivityTimeoutMs: 2 * 60 * 1000 // Expulsión tras 2 minutos AFK
};

// =========================================================================
// MÁQUINA DE ESTADOS FINITA (FSM) Y MODOS DE JUEGO
// =========================================================================
const STATE = {
    LOBBY: 'LOBBY',                   // Esperando jugadores o en selección
    TRON_GAME: 'TRON_GAME',           // Modo 1: Tron 1v1 Cazador vs Corredor
    ROUND_OVER: 'ROUND_OVER',         // Modo 1: Fin de ronda
    PVE_GAME: 'PVE_GAME',             // Modo 2: Supervivencia PvE contra oleadas
    PVE_GAME_OVER: 'PVE_GAME_OVER'     // Modo 2: Fin de partida PvE
};

const GAME_MODE = {
    TRON: 'TRON',
    PVE: 'PVE'
};

let currentGameMode = GAME_MODE.TRON;
let currentFsmState = STATE.LOBBY;
let currentHunterId = null;     // ID del jugador que la lleva (Cazador en Modo 1)
let roundWinnerId = null;       // ID del ganador de la ronda o 'draw'
let roundWinReason = '';        // 'tag' (atrapado), 'trail' (chocó con rastro), 'wall' (chocó con pared)
let roundResetUntil = 0;        // Timestamp en ms para reiniciar la siguiente ronda

// =========================================================================
// MODO 2: CONFIGURACIÓN PVE (SUPERVIVENCIA COOPERATIVA)
// =========================================================================
const PVE = {
    enemyRadius: 22,            // Enemigos más grandes y visibles en pantalla de móvil
    enemySpeed: 220,            // 1.5x más rápido (antes 145 px/s -> ahora 220 px/s)
    trailCollisionRadius: 18,   // Radio de colisión letal enemigo vs rastro
    trailLifetimeMs: 1800,      // Rastro más corto y ágil (1.8s en vez de 3.5s)
    bombRespawnIntervalMs: 20000,// Cada 20 segundos aparece una bomba en punto aleatorio
    bombRadius: 24,             // Radio del coleccionable de la bomba en la arena
    haloExpansionSpeed: 950,    // Velocidad a la que se expande el halo destructor (px/s)
    spawnIntervalMs: 1800,      // Oleadas más dinámicas
    maxEnemies: 35,
    pointsPerKill: 100
};

let pveEnemies = [];
let pveWave = 1;
let pveLastSpawn = 0;
let pveWaveStartTime = 0;
let enemyIdCounter = 1;

// Objeto de la Bomba Táctica que aparece cada 20 segundos en el mapa
let pveBombItem = null;        // { id, x, y, radius, spawnedAt }
let pveNextBombSpawn = 0;
let pveActiveShockwave = null; // { x, y, currentRadius, maxRadius, speed, playerId, hitEnemies }

// =========================================================================
// MECÁNICAS AVANZADAS PVE: PORTALES (WORMHOLES), DASH, RESCATE Y CORAZONES
// =========================================================================
const PVE_PORTALS = {
    radius: 28,
    rotationIntervalMs: 10000 // Portales cambian de posición aleatoriamente cada 10 segundos
};
let pvePortalRotateTime = 0;
let pvePortalA = { x: 140, y: 220, radius: 28 };
let pvePortalB = { x: 660, y: 680, radius: 28 };

/**
 * Reubica ambos portales en coordenadas aleatorias de la arena asegurando distancia mínima
 */
function randomizePvePortals() {
    const margin = 80;
    const minDistance = 280;
    let ax, ay, bx, by, dist;
    let attempts = 0;
    do {
        ax = Math.round(margin + Math.random() * (ARENA.width - margin * 2));
        ay = Math.round(margin + Math.random() * (ARENA.height - margin * 2));
        bx = Math.round(margin + Math.random() * (ARENA.width - margin * 2));
        by = Math.round(margin + Math.random() * (ARENA.height - margin * 2));
        dist = Math.hypot(bx - ax, by - ay);
        attempts++;
    } while (dist < minDistance && attempts < 50);

    pvePortalA = { x: ax, y: ay, radius: PVE_PORTALS.radius };
    pvePortalB = { x: bx, y: by, radius: PVE_PORTALS.radius };
    console.log(`[PORTALES] 🌀 Reubicación aleatoria (10s): Portal α(${pvePortalA.x}, ${pvePortalA.y}) <-> Portal β(${pvePortalB.x}, ${pvePortalB.y})`);
}

// Corazón flotante (+1 vida cada 30 segundos)
const HEART_RESPAWN_INTERVAL_MS = 30000;
let pveHeartItem = null; // { id, x, y, radius: 20, spawnedAt }
let pveNextHeartSpawn = 0;

// Constantes de Dash y Rescate
const DASH_COOLDOWN_MS = 3000;    // 3 segundos de cooldown
const DASH_DURATION_MS = 200;     // 0.2 segundos de impulso
const DASH_MULTIPLIER = 2.5;      // x2.5 velocidad
const REVIVE_DISTANCE = 40;       // < 40 px para rescatar
const REVIVE_REQUIRED_TICKS = 40; // 40 ticks * 50ms = 2.0 segundos seguidos (antes 3s)

// Estructura en memoria: Map<id, PlayerData>
const players = new Map();

/**
 * Envía un mensaje JSON a todos los clientes conectados activos
 */
function broadcast(obj) {
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const pl of players.values()) {
        if (pl.ws && pl.ws.readyState === 1) {
            pl.ws.send(payload);
        }
    }
}

/**
 * Inicializa la ronda de Tron 1v1 (Modo 1)
 * @param {boolean} isNewMatch Si es el inicio de la partida (reinicia scores a 0)
 */
function setupRound(isNewMatch = false) {
    const playerList = [...players.values()];
    if (playerList.length < 2) return;

    // Asignar o alternar el rol de Cazador
    if (isNewMatch || !currentHunterId || !players.has(currentHunterId)) {
        currentHunterId = playerList[0].id;
    } else {
        // Alternar el rol entre rondas para que ambos jueguen de Cazador
        const nextHunter = playerList.find(p => p.id !== currentHunterId);
        if (nextHunter) {
            currentHunterId = nextHunter.id;
        }
    }

    const spawns = [
        { x: 400, y: 220 },
        { x: 400, y: 680 }
    ];

    playerList.forEach((p, idx) => {
        const isHunter = p.id === currentHunterId;
        const spawn = spawns[idx % spawns.length];

        p.x = spawn.x;
        p.y = spawn.y;
        p.vx = 0; // ¡QUIETO! No avanza sin que el usuario lo indique
        p.vy = 0;
        p.isIt = isHunter;
        p.color = isHunter ? '#ef4444' : '#00f0ff'; // Rojo fuego Cazador, Cyan Corredor
        p.isAlive = true;
        p.trailHistory = [{ x: spawn.x, y: spawn.y }];

        if (isNewMatch) {
            p.score = 0;
        }
    });

    roundWinnerId = null;
    roundWinReason = '';
    roundResetUntil = 0;
    currentFsmState = STATE.TRON_GAME;
    console.log(`[TRON] Ronda iniciada. Cazador: ${currentHunterId}`);
}

/**
 * Inicializa la partida de Supervivencia PvE (Modo 2)
 * @param {boolean} isNew Si inicia desde la Oleada 1
 */
function setupPveGame(isNew = true) {
    const activePlayers = [...players.values()];
    if (activePlayers.length === 0) return;

    if (isNew) {
        pveWave = 1;
        pveWaveStartTime = Date.now();
    }

    pveEnemies = [];
    pveLastSpawn = Date.now();
    pveBombItem = null;
    pveActiveShockwave = null;
    pveNextBombSpawn = Date.now() + 3500; // La primera bomba aparece a los 3.5s, luego cada 20s

    // Corazón flotante (+1 vida cada 30 segundos)
    pveHeartItem = null;
    pveNextHeartSpawn = Date.now() + HEART_RESPAWN_INTERVAL_MS;

    // Inicializar portales en posiciones aleatorias cada 10 segundos
    pvePortalRotateTime = Date.now() + PVE_PORTALS.rotationIntervalMs;
    randomizePvePortals();

    activePlayers.forEach((p, idx) => {
        const offset = (idx - (activePlayers.length - 1) / 2) * 80;
        p.x = 400 + offset;
        p.y = 450;
        p.vx = 0;
        p.vy = 0;
        p.isIt = false;
        p.isAlive = true;
        p.isDead = false;
        p.lives = 3;
        p.bombCooldown = 0;
        p.bombReady = false;
        p.reviveTicks = 0;
        p.revivingBy = null;
        p.dashCooldownUntil = 0;
        p.dashActiveUntil = 0;
        p.portalCooldownUntil = 0;
        p.trailHistory = [];
        p.color = '#10b981'; // Verde esmeralda neón en PvE
        p.invulnerableUntil = Date.now() + 2500; // 2.5s de inmunidad de despliegue inicial

        if (isNew) {
            p.score = 0;
        }
    });

    spawnEnemyWave(5 + pveWave * 2);

    currentFsmState = STATE.PVE_GAME;
    roundWinnerId = null;
    roundWinReason = '';
    roundResetUntil = 0;
    console.log(`[PVE] Partida iniciada en Oleada ${pveWave} con ${activePlayers.length} jugadores.`);
}

function broadcastTeleport(entityType, entityId, fromPortal, toPortal) {
    const tpPayload = JSON.stringify({
        type: 'teleport',
        entityType,
        id: entityId,
        fromX: fromPortal.x,
        fromY: fromPortal.y,
        toX: toPortal.x,
        toY: toPortal.y
    });
    for (const pl of players.values()) {
        if (pl.ws.readyState === 1) pl.ws.send(tpPayload);
    }
}

function spawnEnemyWave(count) {
    const activePlayers = [...players.values()].filter(p => p.isAlive);
    for (let i = 0; i < count; i++) {
        if (pveEnemies.length >= PVE.maxEnemies) break;

        let ex, ey;
        const side = Math.floor(Math.random() * 4);
        if (side === 0) {
            ex = 40 + Math.random() * (ARENA.width - 80);
            ey = 40;
        } else if (side === 1) {
            ex = 40 + Math.random() * (ARENA.width - 80);
            ey = ARENA.height - 40;
        } else if (side === 2) {
            ex = 40;
            ey = 40 + Math.random() * (ARENA.height - 80);
        } else {
            ex = ARENA.width - 40;
            ey = 40 + Math.random() * (ARENA.height - 80);
        }

        const tooClose = activePlayers.some(p => Math.hypot(p.x - ex, p.y - ey) < 140);
        if (tooClose && activePlayers.length > 0) continue;

        const isFast = (i % 3 === 0);
        pveEnemies.push({
            id: 'E-' + (enemyIdCounter++),
            x: Math.round(ex),
            y: Math.round(ey),
            vx: 0,
            vy: 0,
            speed: Math.round((isFast ? PVE.enemySpeed * 1.3 : PVE.enemySpeed) + (pveWave - 1) * 8),
            type: isFast ? 'fast' : 'basic'
        });
    }
}

// =========================================================================
// GESTIÓN DE CONEXIONES WEBSOCKET
// =========================================================================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const playerId = 'P-' + Math.floor(100 + Math.random() * 900);

    const playerData = {
        id: playerId,
        ws: ws,
        x: 400,
        y: 450,
        vx: 0,
        vy: 0,
        color: '#00f0ff',
        isIt: false,
        isAlive: true,
        isDead: false,
        lives: 3,
        score: 0,
        bombCooldown: 0,
        bombReady: true,
        reviveTicks: 0,
        revivingBy: null,
        dashCooldownUntil: 0,
        dashActiveUntil: 0,
        portalCooldownUntil: 0,
        trailHistory: [],
        joinedAt: Date.now(),
        lastActive: Date.now()
    };

    players.set(playerId, playerData);
    ws.playerId = playerId;

    console.log(`[WS] Conectado: ${playerId} desde ${ip} (Total conectados: ${players.size})`);

    // Paquete inicial
    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        gameMode: currentGameMode,
        arena: {
            width: ARENA.width,
            height: ARENA.height,
            playerRadius: ARENA.playerRadius,
            trailThickness: ARENA.trailThickness
        }
    }));

    // Iniciar partida según el modo activo
    if (currentGameMode === GAME_MODE.TRON && players.size === 2 && currentFsmState === STATE.LOBBY) {
        setupRound(true);
    } else if (currentGameMode === GAME_MODE.PVE && currentFsmState === STATE.LOBBY) {
        setupPveGame(true);
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = players.get(ws.playerId);
            if (!player) return;

            // Selección de modo (Modo 1: TRON o Modo 2: PVE)
            if (data.type === 'select_mode') {
                const requestedMode = data.mode === 'PVE' ? GAME_MODE.PVE : GAME_MODE.TRON;
                if (currentGameMode !== requestedMode || currentFsmState === STATE.LOBBY) {
                    currentGameMode = requestedMode;
                    if (currentGameMode === GAME_MODE.PVE) {
                        setupPveGame(true);
                    } else {
                        if (players.size >= 2) {
                            setupRound(true);
                        } else {
                            currentFsmState = STATE.LOBBY;
                            currentHunterId = null;
                            roundWinnerId = null;
                        }
                    }
                    console.log(`[MODE] Modo de juego cambiado a: ${currentGameMode}`);
                }
            }

            // Activación de la Bomba de Emergencia (Cooldown de 20s en Modo 2)
            if (data.type === 'bomb') {
                handlePlayerBomb(player);
            }

            // Mini-Acelerón (Dash con impulso x2.5 durante 0.2s y cooldown de 3s)
            if (data.type === 'dash') {
                const now = Date.now();
                if (player.isAlive && !player.isDead && (currentFsmState === STATE.PVE_GAME || currentFsmState === STATE.TRON_GAME)) {
                    if (now >= (player.dashCooldownUntil || 0)) {
                        player.dashCooldownUntil = now + DASH_COOLDOWN_MS;
                        player.dashActiveUntil = now + DASH_DURATION_MS;
                        player.lastActive = now;
                        console.log(`[DASH] 🚀 Acelerón activado por ${player.id}`);

                        const dashPayload = JSON.stringify({
                            type: 'player_dash',
                            playerId: player.id,
                            x: player.x,
                            y: player.y,
                            vx: player.vx,
                            vy: player.vy
                        });
                        for (const pl of players.values()) {
                            if (pl.ws.readyState === 1) pl.ws.send(dashPayload);
                        }
                    }
                }
            }

            // Entrada de dirección (vector vx, vy)
            if (data.type === 'input') {
                let vx = Number(data.vx) || 0;
                let vy = Number(data.vy) || 0;

                const mag = Math.hypot(vx, vy);
                if (mag > 0.05) {
                    vx /= mag;
                    vy /= mag;
                    player.lastActive = Date.now();
                } else {
                    vx = 0;
                    vy = 0;
                }

                // El jugador se mueve si está vivo y la partida está activa (Tron o PvE)
                if (player.isAlive && (currentFsmState === STATE.TRON_GAME || currentFsmState === STATE.PVE_GAME)) {
                    player.vx = vx;
                    player.vy = vy;
                } else {
                    player.vx = 0;
                    player.vy = 0;
                }
            }

            // Notificación de actividad
            if (data.type === 'activity') {
                player.lastActive = Date.now();
            }

            // Ping-Pong RTT
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
        players.delete(ws.playerId);
        console.log(`[WS] Desconectado: ${playerId} (Restantes: ${players.size})`);

        if (currentGameMode === GAME_MODE.TRON && players.size < 2) {
            currentFsmState = STATE.LOBBY;
            currentHunterId = null;
            roundWinnerId = null;
            roundResetUntil = 0;
            for (const p of players.values()) {
                p.trailHistory = [];
                p.isAlive = true;
                p.score = 0;
                p.vx = 0;
                p.vy = 0;
            }
            console.log(`[FSM] Jugadores insuficientes en Tron. Volviendo a STATE.LOBBY`);
        } else if (currentGameMode === GAME_MODE.PVE && players.size === 0) {
            currentFsmState = STATE.LOBBY;
            pveEnemies = [];
            pveWave = 1;
            console.log(`[PVE] Todos los jugadores desconectados. Volviendo a STATE.LOBBY`);
        }
    });

    ws.on('error', (err) => {
        console.error(`[WS] Error en socket ${playerId}:`, err.message);
        players.delete(ws.playerId);
    });
});

/**
 * Gestiona la detonación de la Bomba de Emergencia (20s de recarga)
 * @param {PlayerData} player Jugador que activa la bomba
 */
function handlePlayerBomb(player) {
    if (!player || !player.isAlive || currentFsmState !== STATE.PVE_GAME) return;

    if (player.bombReady) {
        const killedCount = pveEnemies.length;
        pveEnemies = []; // ¡Elimina a todos los enemigos de golpe!
        player.score += killedCount * PVE.pointsPerKill + 250;
        player.bombCooldown = PVE.bombCooldownSec; // 20 segundos
        player.bombReady = false;

        console.log(`[PVE] 💣 ¡BOMBA ACTIVADA por ${player.id}! ${killedCount} enemigos eliminados.`);

        // Broadcast de la detonación para la animación visual
        const blastPayload = JSON.stringify({
            type: 'bomb_blast',
            playerId: player.id,
            x: player.x,
            y: player.y,
            killedCount: killedCount
        });

        for (const p of players.values()) {
            if (p.ws.readyState === 1) {
                p.ws.send(blastPayload);
            }
        }
    }
}

// =========================================================================
// GAME LOOP AUTORITATIVO (20 Hz = cada 50 ms)
// =========================================================================
const TICK_RATE = 20;
const TICK_INTERVAL = 1000 / TICK_RATE; // 50 ms
const DT = 1 / TICK_RATE; // 0.05 s

setInterval(() => {
    const now = Date.now();

    // -------------------------------------------------------------
    // 1. EXPULSIÓN AUTOMÁTICA POR INACTIVIDAD AFK (> 2 minutos)
    // -------------------------------------------------------------
    for (const [id, player] of players) {
        if (now - player.lastActive > ARENA.inactivityTimeoutMs) {
            console.log(`[AFK] Expulsando a ${player.id} por inactividad (+2 min)`);
            try {
                if (player.ws.readyState === 1) {
                    player.ws.send(JSON.stringify({
                        type: 'kicked',
                        reason: 'inactivity',
                        message: 'Desconectado por inactividad (más de 2 minutos sin moverte).'
                    }));
                    player.ws.close(1000, 'AFK Timeout');
                }
            } catch (_) {}
            players.delete(id);
        }
    }

    // -------------------------------------------------------------
    // 2. MÁQUINA DE ESTADOS (FSM)
    // -------------------------------------------------------------
    const activePlayers = [...players.values()];

    switch (currentFsmState) {
        case STATE.LOBBY: {
            if (currentGameMode === GAME_MODE.TRON && activePlayers.length >= 2) {
                setupRound(true);
            } else if (currentGameMode === GAME_MODE.PVE && activePlayers.length >= 1) {
                setupPveGame(true);
            }
            break;
        }

        case STATE.TRON_GAME: {
            if (activePlayers.length < 2) {
                currentFsmState = STATE.LOBBY;
                break;
            }

            const p1 = activePlayers[0];
            const p2 = activePlayers[1];
            const hunter = (p1.id === currentHunterId) ? p1 : p2;
            const runner = (hunter.id === p1.id) ? p2 : p1;

            // A) Movimiento: SOLO avanza si el usuario lo indica (vx !== 0 || vy !== 0)
            for (const p of [p1, p2]) {
                if (p.isAlive) {
                    const isMoving = p.vx !== 0 || p.vy !== 0;
                    if (isMoving) {
                        const isDashing = now < (p.dashActiveUntil || 0);
                        const curSpeed = isDashing ? ARENA.speed * DASH_MULTIPLIER : ARENA.speed;
                        p.x += p.vx * curSpeed * DT;
                        p.y += p.vy * curSpeed * DT;

                        // Añadir punto al rastro solo cuando avanza
                        const lastPt = p.trailHistory[p.trailHistory.length - 1];
                        if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) >= 8) {
                            p.trailHistory.push({
                                x: Math.round(p.x * 10) / 10,
                                y: Math.round(p.y * 10) / 10
                            });
                        }
                    }
                }
            }

            // B) Detección de colisiones
            let hunterDied = false;
            let runnerDied = false;
            let caughtByHunter = false;

            // 1. El Cazador atrapa al Corredor cuerpo a cuerpo
            const distBetweenPlayers = Math.hypot(hunter.x - runner.x, hunter.y - runner.y);
            if (distBetweenPlayers <= ARENA.playerRadius * 2) {
                caughtByHunter = true;
                runnerDied = true;
                roundWinReason = 'tag';
            }

            // 2. Colisión contra paredes y rastros (si no fue captura directa)
            if (!caughtByHunter) {
                for (const p of [hunter, runner]) {
                    if (!p.isAlive) continue;

                    // Colisión con paredes de la arena
                    if (
                        p.x <= ARENA.playerRadius ||
                        p.x >= ARENA.width - ARENA.playerRadius ||
                        p.y <= ARENA.playerRadius ||
                        p.y >= ARENA.height - ARENA.playerRadius
                    ) {
                        if (p.id === hunter.id) { hunterDied = true; roundWinReason = 'wall'; }
                        if (p.id === runner.id) { runnerDied = true; roundWinReason = 'wall'; }
                        continue;
                    }

                    // Colisión con el rastro del oponente
                    const opponent = (p.id === hunter.id) ? runner : hunter;
                    for (let i = 0; i < opponent.trailHistory.length; i++) {
                        const pt = opponent.trailHistory[i];
                        if (Math.hypot(p.x - pt.x, p.y - pt.y) < ARENA.collisionRadius) {
                            if (p.id === hunter.id) { hunterDied = true; roundWinReason = 'trail'; }
                            if (p.id === runner.id) { runnerDied = true; roundWinReason = 'trail'; }
                            break;
                        }
                    }

                    // Colisión con su propio rastro (excluyendo puntos recientes inmediatos)
                    const safePoints = Math.max(0, p.trailHistory.length - ARENA.minSelfCollisionPoints);
                    for (let i = 0; i < safePoints; i++) {
                        const pt = p.trailHistory[i];
                        if (Math.hypot(p.x - pt.x, p.y - pt.y) < ARENA.collisionRadius) {
                            if (p.id === hunter.id) { hunterDied = true; roundWinReason = 'trail'; }
                            if (p.id === runner.id) { runnerDied = true; roundWinReason = 'trail'; }
                            break;
                        }
                    }
                }
            }

            // C) Evaluación de Fin de Ronda
            if (hunterDied || runnerDied) {
                if (hunterDied && runnerDied) {
                    roundWinnerId = 'draw';
                    hunter.isAlive = false;
                    runner.isAlive = false;
                    console.log(`[TRON] Doble colisión. Ronda empatada.`);
                } else if (caughtByHunter) {
                    roundWinnerId = hunter.id;
                    runner.isAlive = false;
                    hunter.score++;
                    console.log(`[TRON] ¡El Cazador ${hunter.id} atrapó a ${runner.id}! Marcador: ${hunter.score}`);
                } else if (runnerDied) {
                    roundWinnerId = hunter.id;
                    runner.isAlive = false;
                    hunter.score++;
                    console.log(`[TRON] El Corredor ${runner.id} colisionó (${roundWinReason}). Gana Cazador: ${hunter.score}`);
                } else if (hunterDied) {
                    roundWinnerId = runner.id;
                    hunter.isAlive = false;
                    runner.score++;
                    console.log(`[TRON] El Cazador ${hunter.id} colisionó (${roundWinReason}). Gana Corredor: ${runner.score}`);
                }

                // Frenar en seco a ambos jugadores durante el fin de ronda
                hunter.vx = 0;
                hunter.vy = 0;
                runner.vx = 0;
                runner.vy = 0;

                currentFsmState = STATE.ROUND_OVER;
                roundResetUntil = now + 3000;
            }
            break;
        }

        case STATE.ROUND_OVER: {
            if (activePlayers.length < 2) {
                currentFsmState = STATE.LOBBY;
                break;
            }

            // Tras 3 segundos, reiniciar la arena para la siguiente ronda
            if (now >= roundResetUntil) {
                setupRound(false);
            }
            break;
        }

        // =========================================================
        // MODO 2: SUPERVIVENCIA PVE CONTRA OLEADAS (1.5x VELOCIDAD)
        // =========================================================
        case STATE.PVE_GAME: {
            if (activePlayers.length === 0) {
                currentFsmState = STATE.LOBBY;
                break;
            }

            // 1. Spawning de la Bomba Táctica cada 20 segundos en punto aleatorio
            if (!pveBombItem && !pveActiveShockwave && now >= pveNextBombSpawn) {
                pveBombItem = {
                    id: 'BOMB-' + (enemyIdCounter++),
                    x: Math.round(90 + Math.random() * (ARENA.width - 180)),
                    y: Math.round(110 + Math.random() * (ARENA.height - 220)),
                    radius: PVE.bombRadius,
                    spawnedAt: now
                };
                console.log(`[PVE] 💣 Bomba táctica generada en (${pveBombItem.x}, ${pveBombItem.y})`);
            }

            // 2. Colisión del Jugador con la Bomba Táctica (Al darle, activa el halo destructor)
            if (pveBombItem) {
                for (const p of activePlayers) {
                    if (p.isAlive && Math.hypot(p.x - pveBombItem.x, p.y - pveBombItem.y) < ARENA.playerRadius + pveBombItem.radius) {
                        // ¡BOMBA ACTIVADA!
                        pveActiveShockwave = {
                            x: pveBombItem.x,
                            y: pveBombItem.y,
                            currentRadius: 15,
                            maxRadius: Math.max(ARENA.width, ARENA.height) * 1.35,
                            speed: PVE.haloExpansionSpeed,
                            playerId: p.id,
                            hitEnemies: new Set()
                        };
                        pveBombItem = null;
                        pveNextBombSpawn = now + PVE.bombRespawnIntervalMs; // Próxima bomba en 20 segundos
                        p.score += 250; // Recompensa por recolectar la bomba
                        console.log(`[PVE] 💥 ¡BOMBA ACTIVADA por ${p.id}! Halo destructor iniciado a ${PVE.haloExpansionSpeed} px/s.`);

                        // Notificación a clientes para sonido / sacudida / animación inicial
                        const triggerPayload = JSON.stringify({
                            type: 'bomb_triggered',
                            playerId: p.id,
                            x: pveActiveShockwave.x,
                            y: pveActiveShockwave.y,
                            speed: PVE.haloExpansionSpeed
                        });
                        for (const pl of players.values()) {
                            if (pl.ws.readyState === 1) pl.ws.send(triggerPayload);
                        }
                        break;
                    }
                }
            }

            // 3. Expansión Física del Halo: Destruye a cada enemigo que el halo va tocando
            if (pveActiveShockwave) {
                pveActiveShockwave.currentRadius += pveActiveShockwave.speed * DT;
                const haloRadius = pveActiveShockwave.currentRadius;
                const killer = players.get(pveActiveShockwave.playerId);

                const survivingEnemies = [];
                for (const enemy of pveEnemies) {
                    if (!pveActiveShockwave.hitEnemies.has(enemy.id)) {
                        const distToCenter = Math.hypot(enemy.x - pveActiveShockwave.x, enemy.y - pveActiveShockwave.y);
                        // El halo va haciendo desaparecer a cada enemigo que alcanza
                        if (distToCenter <= haloRadius + PVE.enemyRadius) {
                            pveActiveShockwave.hitEnemies.add(enemy.id);
                            if (killer) {
                                killer.score += PVE.pointsPerKill + 25;
                            }
                            continue; // ¡Vaporizado instantáneamente por el halo!
                        }
                    }
                    survivingEnemies.push(enemy);
                }
                pveEnemies = survivingEnemies;

                if (haloRadius >= pveActiveShockwave.maxRadius) {
                    pveActiveShockwave = null;
                }
            }

            // 3.5 Corazón flotante (+1 vida cada 30 segundos)
            if (!pveHeartItem && now >= pveNextHeartSpawn) {
                const margin = 80;
                pveHeartItem = {
                    id: `heart-${now}`,
                    x: Math.round(margin + Math.random() * (ARENA.width - margin * 2)),
                    y: Math.round(margin + Math.random() * (ARENA.height - margin * 2)),
                    radius: 20,
                    spawnedAt: now
                };
                console.log(`[PVE] 💖 Corazón flotante (+1 vida) generado en (${pveHeartItem.x}, ${pveHeartItem.y})`);
            }

            // Colisión de jugador vivo con el corazón flotante
            if (pveHeartItem) {
                for (const p of activePlayers) {
                    if (p.isAlive && !p.isDead) {
                        if (Math.hypot(p.x - pveHeartItem.x, p.y - pveHeartItem.y) < ARENA.playerRadius + pveHeartItem.radius) {
                            p.lives = Math.min(5, (p.lives || 0) + 1); // +1 vida
                            p.score += 200;
                            const hx = pveHeartItem.x;
                            const hy = pveHeartItem.y;
                            pveHeartItem = null;
                            pveNextHeartSpawn = now + HEART_RESPAWN_INTERVAL_MS;

                            broadcast({
                                type: 'heart_collected',
                                playerId: p.id,
                                lives: p.lives,
                                x: hx,
                                y: hy
                            });
                            console.log(`[PVE] 💖 Corazón recogido por ${p.id}. Vidas actuales: ${p.lives}`);
                            break;
                        }
                    }
                }
            }

            // 4. Portales de Teletransporte (Wormholes): Reubicación aleatoria cada 10s y Salto Instantáneo
            if (now >= pvePortalRotateTime) {
                pvePortalRotateTime = now + PVE_PORTALS.rotationIntervalMs;
                randomizePvePortals();
            }

            // Teletransporte de Jugadores a través de Portales (cooldown de 1s para evitar bucles)
            for (const p of activePlayers) {
                if (p.isAlive && !p.isDead && now >= (p.portalCooldownUntil || 0)) {
                    if (Math.hypot(p.x - pvePortalA.x, p.y - pvePortalA.y) < pvePortalA.radius + ARENA.playerRadius) {
                        p.x = pvePortalB.x;
                        p.y = pvePortalB.y;
                        p.portalCooldownUntil = now + 1000;
                        p.trailHistory = []; // ¡LIMPIA RASTRO PARA EVITAR QUE SE ALARGUE AL TELETRANSPORTARSE!
                        broadcastTeleport('player', p.id, pvePortalA, pvePortalB);
                    } else if (Math.hypot(p.x - pvePortalB.x, p.y - pvePortalB.y) < pvePortalB.radius + ARENA.playerRadius) {
                        p.x = pvePortalA.x;
                        p.y = pvePortalA.y;
                        p.portalCooldownUntil = now + 1000;
                        p.trailHistory = []; // ¡LIMPIA RASTRO PARA EVITAR QUE SE ALARGUE AL TELETRANSPORTARSE!
                        broadcastTeleport('player', p.id, pvePortalB, pvePortalA);
                    }
                }
            }

            // Teletransporte de Enemigos a través de Portales (cooldown de 1s)
            for (const enemy of pveEnemies) {
                if (now >= (enemy.portalCooldownUntil || 0)) {
                    if (Math.hypot(enemy.x - pvePortalA.x, enemy.y - pvePortalA.y) < pvePortalA.radius + PVE.enemyRadius) {
                        enemy.x = pvePortalB.x;
                        enemy.y = pvePortalB.y;
                        enemy.portalCooldownUntil = now + 1000;
                        broadcastTeleport('enemy', enemy.id, pvePortalA, pvePortalB);
                    } else if (Math.hypot(enemy.x - pvePortalB.x, enemy.y - pvePortalB.y) < pvePortalB.radius + PVE.enemyRadius) {
                        enemy.x = pvePortalA.x;
                        enemy.y = pvePortalA.y;
                        enemy.portalCooldownUntil = now + 1000;
                        broadcastTeleport('enemy', enemy.id, pvePortalB, pvePortalA);
                    }
                }
            }

            // 5. Movimiento de Jugadores y Acelerón Dash (x2.5 durante 0.2s)
            for (const p of activePlayers) {
                if (p.isAlive && !p.isDead) {
                    const isMoving = p.vx !== 0 || p.vy !== 0;
                    if (isMoving) {
                        const isDashing = now < (p.dashActiveUntil || 0);
                        const currentSpeed = isDashing ? ARENA.speed * DASH_MULTIPLIER : ARENA.speed;
                        p.x += p.vx * currentSpeed * DT;
                        p.y += p.vy * currentSpeed * DT;

                        // Límites de la arena
                        p.x = Math.max(ARENA.playerRadius, Math.min(ARENA.width - ARENA.playerRadius, p.x));
                        p.y = Math.max(ARENA.playerRadius, Math.min(ARENA.height - ARENA.playerRadius, p.y));

                        // Añadir punto al rastro con marca de tiempo
                        const lastPt = p.trailHistory[p.trailHistory.length - 1];
                        if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) >= 10) {
                            p.trailHistory.push({
                                x: Math.round(p.x * 10) / 10,
                                y: Math.round(p.y * 10) / 10,
                                t: now
                            });
                        }
                    }

                    // Puntos desaparecen tras 1.8s (rastro más corto y ágil)
                    p.trailHistory = p.trailHistory.filter(pt => now - pt.t < PVE.trailLifetimeMs);
                }
            }

            // 6. Generación y progresión de oleadas
            if (now - pveLastSpawn > PVE.spawnIntervalMs && pveEnemies.length < PVE.maxEnemies) {
                pveLastSpawn = now;
                spawnEnemyWave(3 + Math.min(6, Math.floor(pveWave * 0.8)));
            }

            if (now - pveWaveStartTime > 22000) {
                pveWave++;
                pveWaveStartTime = now;
                console.log(`[PVE] ¡Avanzando a Oleada ${pveWave}!`);
            }

            // 7. Persecución rápida de Enemigos hacia el jugador vivo más cercano
            const livingPlayers = activePlayers.filter(p => p.isAlive && !p.isDead);
            for (const enemy of pveEnemies) {
                if (livingPlayers.length > 0) {
                    let closest = livingPlayers[0];
                    let minDist = Math.hypot(closest.x - enemy.x, closest.y - enemy.y);
                    for (let i = 1; i < livingPlayers.length; i++) {
                        const d = Math.hypot(livingPlayers[i].x - enemy.x, livingPlayers[i].y - enemy.y);
                        if (d < minDist) {
                            minDist = d;
                            closest = livingPlayers[i];
                        }
                    }

                    const dx = closest.x - enemy.x;
                    const dy = closest.y - enemy.y;
                    if (minDist > 0) {
                        const spd = enemy.speed || PVE.enemySpeed;
                        enemy.x += (dx / minDist) * spd * DT;
                        enemy.y += (dy / minDist) * spd * DT;
                    }
                }
            }

            // 8. Colisión letal de enemigos contra el rastro de los jugadores
            const remainingEnemies = [];
            for (const enemy of pveEnemies) {
                let killedByPlayer = null;

                for (const p of activePlayers) {
                    if (!p.isAlive || p.isDead) continue;
                    for (const pt of p.trailHistory) {
                        if (Math.hypot(enemy.x - pt.x, enemy.y - pt.y) < PVE.enemyRadius + PVE.trailCollisionRadius) {
                            killedByPlayer = p;
                            break;
                        }
                    }
                    if (killedByPlayer) break;
                }

                if (killedByPlayer) {
                    killedByPlayer.score += PVE.pointsPerKill;
                } else {
                    remainingEnemies.push(enemy);
                }
            }
            pveEnemies = remainingEnemies;

            // 9. Colisión de enemigos contra jugadores (daño a la nave y congelación como lápida)
            const survivingAfterPlayerHit = [];
            for (const enemy of pveEnemies) {
                let enemyHitPlayer = false;
                for (const p of activePlayers) {
                    if (p.isAlive && !p.isDead && Math.hypot(enemy.x - p.x, enemy.y - p.y) < PVE.enemyRadius + ARENA.playerRadius) {
                        enemyHitPlayer = true;
                        if (now >= (p.invulnerableUntil || 0)) {
                            p.lives = Math.max(0, (p.lives || 3) - 1);
                            p.invulnerableUntil = now + 1400; // 1.4s de inmunidad temporal
                            console.log(`[PVE] ¡Impacto en nave ${p.id}! Escudos restantes: ${p.lives}`);
                            if (p.lives <= 0) {
                                // ¡Jugador caído! Se congela como lápida en su posición actual
                                p.isAlive = false;
                                p.isDead = true;
                                p.vx = 0;
                                p.vy = 0;
                                p.reviveTicks = 0;
                                p.revivingBy = null;
                                console.log(`[PVE] 🪦 Jugador ${p.id} caído. Lápida colocada en (${p.x}, ${p.y}) esperando rescate.`);
                            }
                        }
                        break;
                    }
                }
                if (!enemyHitPlayer) {
                    survivingAfterPlayerHit.push(enemy);
                }
            }
            pveEnemies = survivingAfterPlayerHit;

            // 10. MECÁNICA DE RESCATE MUTUO (REVIVAL):
            // Si el superviviente se mantiene a < 40px durante 3 segundos (60 ticks), el compañero resucita
            const survivors = activePlayers.filter(p => p.isAlive && !p.isDead);
            const fallenPlayers = activePlayers.filter(p => p.isDead);

            for (const fallen of fallenPlayers) {
                let rescuer = null;
                for (const s of survivors) {
                    if (Math.hypot(s.x - fallen.x, s.y - fallen.y) < REVIVE_DISTANCE) {
                        rescuer = s;
                        break;
                    }
                }

                if (rescuer) {
                    fallen.reviveTicks = (fallen.reviveTicks || 0) + 1;
                    fallen.revivingBy = rescuer.id;

                    if (fallen.reviveTicks >= REVIVE_REQUIRED_TICKS) {
                        // ¡RESUCITADO CON 1 VIDA E INMUNIDAD DE 2 SEGUNDOS!
                        fallen.isAlive = true;
                        fallen.isDead = false;
                        fallen.lives = 1;
                        fallen.invulnerableUntil = now + 2000;
                        fallen.reviveTicks = 0;
                        fallen.revivingBy = null;
                        rescuer.score += 250; // Recompensa de rescate
                        console.log(`[PVE] ⚡ ¡${fallen.id} ha sido RESUCITADO por ${rescuer.id}!`);

                        const revivePayload = JSON.stringify({
                            type: 'player_revived',
                            revivedId: fallen.id,
                            rescuerId: rescuer.id,
                            x: fallen.x,
                            y: fallen.y
                        });
                        for (const pl of players.values()) {
                            if (pl.ws.readyState === 1) pl.ws.send(revivePayload);
                        }
                    }
                } else {
                    // Si el superviviente se aleja, el contador de rescate se reinicia
                    fallen.reviveTicks = 0;
                    fallen.revivingBy = null;
                }
            }

            // 11. FIN DE PARTIDA: Si todos los jugadores mueren (cero supervivientes) -> GAME OVER
            if (activePlayers.length > 0 && survivors.length === 0) {
                currentFsmState = STATE.PVE_GAME_OVER;
                roundResetUntil = now + 4000;
                console.log(`[PVE] Todos los jugadores han caído (sin supervivientes). Fin de partida PvE.`);
            }
            break;
        }

        case STATE.PVE_GAME_OVER: {
            if (activePlayers.length === 0) {
                currentFsmState = STATE.LOBBY;
                break;
            }
            if (now >= roundResetUntil) {
                setupPveGame(true);
            }
            break;
        }
    }

    // -------------------------------------------------------------
    // 3. BROADCAST DEL ESTADO A LOS CLIENTES
    // -------------------------------------------------------------
    if (players.size > 0) {
        const statePayload = JSON.stringify({
            type: 'state',
            gameMode: currentGameMode,
            fsmState: currentFsmState,
            hunterId: currentHunterId,
            winnerId: roundWinnerId,
            winReason: roundWinReason,
            wave: pveWave,
            countdown: roundResetUntil > now ? Math.ceil((roundResetUntil - now) / 1000) : 0,
            portals: {
                a: { x: pvePortalA.x, y: pvePortalA.y, radius: pvePortalA.radius },
                b: { x: pvePortalB.x, y: pvePortalB.y, radius: pvePortalB.radius }
            },
            bombItem: pveBombItem ? {
                id: pveBombItem.id,
                x: Math.round(pveBombItem.x * 10) / 10,
                y: Math.round(pveBombItem.y * 10) / 10,
                radius: pveBombItem.radius
            } : null,
            activeHalo: pveActiveShockwave ? {
                x: Math.round(pveActiveShockwave.x * 10) / 10,
                y: Math.round(pveActiveShockwave.y * 10) / 10,
                radius: Math.round(pveActiveShockwave.currentRadius * 10) / 10
            } : null,
            nextBombIn: (!pveBombItem && !pveActiveShockwave && pveNextBombSpawn > now)
                ? Math.ceil((pveNextBombSpawn - now) / 1000)
                : 0,
            heartItem: pveHeartItem ? {
                id: pveHeartItem.id,
                x: Math.round(pveHeartItem.x * 10) / 10,
                y: Math.round(pveHeartItem.y * 10) / 10,
                radius: pveHeartItem.radius
            } : null,
            nextHeartIn: (!pveHeartItem && pveNextHeartSpawn > now)
                ? Math.ceil((pveNextHeartSpawn - now) / 1000)
                : 0,
            enemies: pveEnemies.map(e => ({
                id: e.id,
                x: Math.round(e.x * 10) / 10,
                y: Math.round(e.y * 10) / 10,
                type: e.type
            })),
            players: activePlayers.map(p => ({
                id: p.id,
                x: Math.round(p.x * 10) / 10,
                y: Math.round(p.y * 10) / 10,
                vx: Math.round(p.vx * 100) / 100,
                vy: Math.round(p.vy * 100) / 100,
                color: p.color,
                isIt: p.isIt,
                isAlive: p.isAlive,
                isDead: Boolean(p.isDead),
                reviveTicks: p.reviveTicks || 0,
                reviveProgress: Math.min(1, (p.reviveTicks || 0) / REVIVE_REQUIRED_TICKS),
                revivingBy: p.revivingBy || null,
                isDashing: (now < (p.dashActiveUntil || 0)),
                dashCooldownSec: Math.max(0, Math.ceil(((p.dashCooldownUntil || 0) - now) / 1000)),
                dashReady: (now >= (p.dashCooldownUntil || 0)),
                score: p.score,
                lives: p.lives !== undefined ? p.lives : 3,
                isInvulnerable: (now < (p.invulnerableUntil || 0)),
                trail: p.trailHistory.map(pt => ({ x: pt.x, y: pt.y })),
                isAfk: (now - p.lastActive > 30000)
            })),
            serverTime: now
        });

        for (const [id, player] of players) {
            if (player.ws.readyState === 1) { // WebSocket.OPEN
                player.ws.send(statePayload);
            }
        }
    }
}, TICK_INTERVAL);
