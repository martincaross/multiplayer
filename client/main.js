/**
 * Pilla-Pilla Tron 1v1 & Supervivencia PvE - Cliente Web de Alta Fidelidad
 * - Renderizado vectorial procedural de naves cibernéticas (sin emojis, estética arcade premium).
 * - Drones enemigos de alta visibilidad para móvil (Crimson & Violet) con radar táctico direccional.
 * - Orbe EMP coleccionable en arena y halo destructor expansivo a 950 px/s en tiempo real.
 * - Simulación y velocidad ágil a 1.5x (420 px/s).
 * - Sistema de efectos visuales: partículas de propulsión y explosión, sacudida de pantalla (screen shake) y textos flotantes de puntuación.
 */

class MultiplayerClient {
    constructor() {
        // Elementos DOM del Canvas
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Métricas e Interfaz HUD
        this.statusPill = document.getElementById('status-pill');
        this.statusText = document.getElementById('status-text');
        this.rttVal = document.getElementById('rtt-val');
        this.fpsVal = document.getElementById('fps-val');
        this.playersVal = document.getElementById('players-val');
        this.resetZoomBtn = document.getElementById('reset-zoom-btn');
        this.zoomWarningBanner = document.getElementById('zoom-warning-banner');

        // Selector de Modo de Juego (Modo 1: TRON vs Modo 2: PVE)
        this.gameMode = 'TRON';
        this.modeTronBtn = document.getElementById('mode-tron-btn');
        this.modePveBtn = document.getElementById('mode-pve-btn');

        // Marcador Tron 1v1
        this.scorePill = document.getElementById('score-pill');
        this.p1ScoreVal = document.getElementById('p1-score-val');
        this.p2ScoreVal = document.getElementById('p2-score-val');
        this.p1ScoreTag = document.getElementById('p1-score-tag');
        this.p2ScoreTag = document.getElementById('p2-score-tag');

        // Métricas PvE Supervivencia
        this.pveStatsPill = document.getElementById('pve-stats-pill');
        this.pveWaveVal = document.getElementById('pve-wave-val');
        this.pveScoreVal = document.getElementById('pve-score-val');
        this.pveEnemiesVal = document.getElementById('pve-enemies-val');
        this.pveBombTag = document.getElementById('pve-bomb-tag');
        this.bombLedDot = document.getElementById('bomb-led-dot');
        this.pveBombVal = document.getElementById('pve-bomb-val');

        // HUD Dash y Botón Táctil
        this.pveDashTag = document.getElementById('pve-dash-tag');
        this.dashLedDot = document.getElementById('dash-led-dot');
        this.pveDashVal = document.getElementById('pve-dash-val');
        this.dashBtn = document.getElementById('dash-btn');
        this.dashRingProgress = document.getElementById('dash-ring-progress');
        this.dashLbl = document.getElementById('dash-lbl');

        this.myDashCooldownSec = 0;
        this.myDashReady = true;
        this.myDashActiveUntil = 0;

        this.pveWave = 1;
        this.enemies = [];
        this.lastEnemyMap = new Map(); // Para detectar muertes y emitir explosiones

        // Portales de Teletransporte (Wormholes)
        this.portals = null; // { a: { x, y, radius }, b: { x, y, radius } }

        // Corazón Flotante (+1 Vida extra cada 30 segundos)
        this.heartItem = null;       // { id, x, y, radius }
        this.nextHeartIn = 0;        // Segundos para el próximo corazón

        // Estado del Orbe EMP e Historial de la Onda
        this.bombItem = null;        // { id, x, y, radius }
        this.nextBombIn = 0;         // Segundos para el próximo orbe
        this.activeHalo = null;      // { x, y, radius }
        this.localHalos = [];        // Animaciones cosméticas cliente

        // Banner central de estado FSM
        this.gameRoleBanner = document.getElementById('game-role-banner');
        this.roleIcon = document.getElementById('role-icon');
        this.roleText = document.getElementById('role-text');

        // Joystick táctil para móvil
        this.joystickZone = document.getElementById('joystick-zone');
        this.joystickBase = document.getElementById('joystick-base');
        this.joystickKnob = document.getElementById('joystick-knob');

        // Modal de desconexión por inactividad
        this.afkModal = document.getElementById('afk-modal');
        this.afkReconnectBtn = document.getElementById('afk-reconnect-btn');
        this.isKicked = false;
        this.lastActivitySent = 0;

        if (this.afkReconnectBtn) {
            this.afkReconnectBtn.addEventListener('click', () => window.location.reload());
        }

        // Configuración de la Arena (800x900 autoritativa en servidor, 1.5x velocidad)
        this.arena = {
            width: 800,
            height: 900,
            playerRadius: 18,
            trailThickness: 6,
            speed: 420 // 1.5x velocidad de desplazamiento
        };

        // Identidad y Estado de Juego
        this.myId = null;
        this.myColor = '#00f0ff';
        this.fsmState = 'LOBBY';
        this.hunterId = null;
        this.winReason = '';
        this.roundWinnerId = null;
        this.roundCountdown = 0;

        // Entidad de Jugadores en Memoria (Map<id, Player>)
        this.players = new Map();

        // Control de Cámara y Pantalla
        this.viewportWidth = window.innerWidth;
        this.viewportHeight = window.innerHeight;
        this.dpr = window.devicePixelRatio || 1;

        // Entradas (Teclado + Joystick)
        this.keys = {};
        this.joystick = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            vx: 0,
            vy: 0
        };
        this.currentInput = { vx: 0, vy: 0 };
        this.lastSentInput = { vx: 0, vy: 0 };

        // Red y Sincronización
        this.ws = null;
        this.pingTimer = null;
        this.reconnectTimer = null;
        this.inputSyncInterval = 50; // 20 Hz
        this.lastInputSync = 0;

        // Métricas de Rendimiento
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.gameTime = 0;

        // Sistema de Efectos Visuales Arcade (VFX)
        this.particles = [];
        this.floatingTexts = [];
        this.screenShake = {
            intensity: 0,
            duration: 0,
            timer: 0,
            offsetX: 0,
            offsetY: 0
        };

        // Inicializar subsistemas
        this.initViewport();
        this.initZoomManagement();
        this.initInputs();
        this.initNetwork();
        this.startGameLoop();
    }

    /* -------------------------------------------------------------
       1. VIEWPORT & GESTIÓN DE PANTALLA
    ---------------------------------------------------------------- */
    initViewport() {
        const resize = () => {
            const rect = this.canvas.getBoundingClientRect();
            const width = Math.max(Math.floor(rect.width), window.innerWidth);
            const height = Math.max(Math.floor(rect.height), window.innerHeight);
            const dpr = Math.min(window.devicePixelRatio || 1, 2);

            this.dpr = dpr;
            this.viewportWidth = width;
            this.viewportHeight = height;

            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);

            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.checkZoomLevel();
        };

        window.addEventListener('resize', resize);
        window.addEventListener('orientationchange', () => setTimeout(resize, 150));
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', resize);
        }
        resize();
    }

    checkZoomLevel() {
        if (window.visualViewport && this.zoomWarningBanner) {
            if (window.visualViewport.scale > 1.05) {
                this.zoomWarningBanner.style.display = 'block';
            } else {
                this.zoomWarningBanner.style.display = 'none';
            }
        }
    }

    initZoomManagement() {
        const forceReset = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const meta = document.querySelector('meta[name="viewport"]');
            if (meta) {
                meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
                window.scrollTo(0, 0);

                setTimeout(() => {
                    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover');
                }, 250);
            }

            if (this.zoomWarningBanner) {
                this.zoomWarningBanner.style.display = 'none';
            }
        };

        if (this.resetZoomBtn) {
            this.resetZoomBtn.addEventListener('click', forceReset);
            this.resetZoomBtn.addEventListener('touchend', forceReset);
        }

        if (this.zoomWarningBanner) {
            this.zoomWarningBanner.addEventListener('click', forceReset);
            this.zoomWarningBanner.addEventListener('touchend', forceReset);
        }
    }

    /* -------------------------------------------------------------
       2. GESTIÓN DE ENTRADAS HÍBRIDAS (Teclado + Joystick Táctil)
    ---------------------------------------------------------------- */
    initInputs() {
        const notifyActivity = () => {
            const now = Date.now();
            if (now - this.lastActivitySent > 10000) {
                this.lastActivitySent = now;
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'activity' }));
                }
            }
        };

        window.addEventListener('pointerdown', notifyActivity, { passive: true });
        window.addEventListener('touchstart', notifyActivity, { passive: true });

        // Teclado
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            notifyActivity();
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space') {
                this.triggerDash();
            }
            this.calcInputVector();
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.calcInputVector();
        });

        // Clic derecho para Dash en PC
        window.addEventListener('contextmenu', (e) => {
            if (e.target === this.canvas) {
                e.preventDefault();
                notifyActivity();
                this.triggerDash();
            }
        });

        // Botón Táctil de Dash para Móvil
        if (this.dashBtn) {
            const onDashPress = (e) => {
                e.preventDefault();
                e.stopPropagation();
                notifyActivity();
                this.triggerDash();
            };
            this.dashBtn.addEventListener('click', onDashPress);
            this.dashBtn.addEventListener('touchstart', onDashPress, { passive: false });
        }

        // Selector de Modo
        if (this.modeTronBtn) {
            this.modeTronBtn.addEventListener('click', () => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'select_mode', mode: 'TRON' }));
                }
            });
        }
        if (this.modePveBtn) {
            this.modePveBtn.addEventListener('click', () => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'select_mode', mode: 'PVE' }));
                }
            });
        }

        // Joystick Táctil
        if (this.joystickZone) {
            const onPointerDown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.joystick.active = true;
                this.joystick.pointerId = e.pointerId;

                try {
                    this.joystickZone.setPointerCapture(e.pointerId);
                } catch (_) {}

                const rect = this.joystickBase.getBoundingClientRect();
                this.joystick.startX = rect.left + rect.width / 2;
                this.joystick.startY = rect.top + rect.height / 2;

                this.joystickBase.classList.add('active');
                this.handlePointerMove(e);
            };

            const onPointerMove = (e) => {
                if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
                e.preventDefault();
                e.stopPropagation();
                this.handlePointerMove(e);
            };

            const onPointerUp = (e) => {
                if (!this.joystick.active || e.pointerId !== this.joystick.pointerId) return;
                e.preventDefault();
                e.stopPropagation();
                this.resetJoystick();
            };

            this.joystickZone.addEventListener('pointerdown', onPointerDown);
            this.joystickZone.addEventListener('pointermove', onPointerMove);
            this.joystickZone.addEventListener('pointerup', onPointerUp);
            this.joystickZone.addEventListener('pointercancel', onPointerUp);
        }
    }

    handlePointerMove(e) {
        const dx = e.clientX - this.joystick.startX;
        const dy = e.clientY - this.joystick.startY;
        const dist = Math.hypot(dx, dy);
        const maxRadius = 38;

        if (dist < 4) {
            this.joystickKnob.style.transform = `translate(0px, 0px)`;
            this.joystick.vx = 0;
            this.joystick.vy = 0;
            this.calcInputVector();
            return;
        }

        const clampedDist = Math.min(dist, maxRadius);
        const angle = Math.atan2(dy, dx);
        const kx = Math.cos(angle) * clampedDist;
        const ky = Math.sin(angle) * clampedDist;

        this.joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
        this.joystick.vx = Math.cos(angle);
        this.joystick.vy = Math.sin(angle);
        this.calcInputVector();
    }

    resetJoystick() {
        this.joystick.active = false;
        this.joystick.pointerId = null;
        this.joystick.vx = 0;
        this.joystick.vy = 0;
        if (this.joystickBase) this.joystickBase.classList.remove('active');
        if (this.joystickKnob) {
            this.joystickKnob.style.transform = `translate(0px, 0px)`;
        }

        this.currentInput.vx = 0;
        this.currentInput.vy = 0;
        this.lastSentInput.vx = 0;
        this.lastSentInput.vy = 0;

        const myP = this.players.get(this.myId);
        if (myP) {
            myP.vx = 0;
            myP.vy = 0;
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'input',
                vx: 0,
                vy: 0
            }));
        }
    }

    calcInputVector() {
        if (this.joystick.active) {
            this.currentInput.vx = Number(this.joystick.vx.toFixed(3));
            this.currentInput.vy = Number(this.joystick.vy.toFixed(3));

            const myP = this.players.get(this.myId);
            if (myP) {
                myP.vx = this.currentInput.vx;
                myP.vy = this.currentInput.vy;
            }

            this.checkSendInput(true);
            return;
        }

        let kx = 0;
        let ky = 0;

        if (this.keys['KeyW'] || this.keys['ArrowUp']) ky -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) ky += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) kx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) kx += 1;

        const mag = Math.hypot(kx, ky);
        if (mag > 0) {
            kx /= mag;
            ky /= mag;
        }

        this.currentInput.vx = Number(kx.toFixed(3));
        this.currentInput.vy = Number(ky.toFixed(3));

        const myP = this.players.get(this.myId);
        if (myP) {
            myP.vx = this.currentInput.vx;
            myP.vy = this.currentInput.vy;
        }

        if (kx === 0 && ky === 0) {
            this.lastSentInput.vx = 0;
            this.lastSentInput.vy = 0;
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'input',
                    vx: 0,
                    vy: 0
                }));
            }
            return;
        }

        this.checkSendInput(true);
    }

    checkSendInput(force = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const now = performance.now();
        const timePassed = now - this.lastInputSync >= this.inputSyncInterval;
        const changed = (
            this.currentInput.vx !== this.lastSentInput.vx ||
            this.currentInput.vy !== this.lastSentInput.vy
        );

        if ((changed && force) || timePassed) {
            this.lastInputSync = now;
            this.lastSentInput.vx = this.currentInput.vx;
            this.lastSentInput.vy = this.currentInput.vy;

            this.ws.send(JSON.stringify({
                type: 'input',
                vx: this.currentInput.vx,
                vy: this.currentInput.vy
            }));
        }
    }

    /**
     * Activa el mini-acelerón (Dash) con impulso x2.5 durante 0.2s y cooldown de 3s
     */
    triggerDash() {
        const now = performance.now();
        if (this.myDashCooldownSec <= 0) {
            this.myDashCooldownSec = 3.0;
            this.myDashReady = false;
            this.myDashActiveUntil = now + 200;

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'dash' }));
            }

            const myP = this.players.get(this.myId);
            if (myP && myP.isAlive && !myP.isDead) {
                myP.isDashing = true;
                myP.dashUntil = now + 200;
                this.triggerScreenShake(4, 0.15);
                this.spawnDashBurst(myP.renderX, myP.renderY, myP.angle);
            }

            this.updateDashUI();
        }
    }

    /**
     * Actualiza el estado visual del Dash en la barra HUD superior y en el botón flotante
     */
    updateDashUI() {
        const isReady = this.myDashCooldownSec <= 0;
        this.myDashReady = isReady;

        // 1. Tag en barra superior HUD
        if (this.pveDashTag) {
            this.pveDashTag.classList.toggle('ready', isReady);
            this.pveDashTag.classList.toggle('cooldown', !isReady);
        }
        if (this.dashLedDot) {
            this.dashLedDot.classList.toggle('ready', isReady);
        }
        if (this.pveDashVal) {
            this.pveDashVal.textContent = isReady ? 'DASH: LISTO' : `DASH: ${this.myDashCooldownSec.toFixed(1)}s`;
        }

        // 2. Botón táctil móvil flotante
        if (this.dashBtn) {
            this.dashBtn.classList.toggle('ready', isReady);
            this.dashBtn.classList.toggle('cooldown', !isReady);
        }
        if (this.dashRingProgress) {
            // Perímetro del círculo r=28 -> 2 * PI * 28 ≈ 176
            const totalCircumference = 176;
            const progress = isReady ? 1 : Math.max(0, (3.0 - this.myDashCooldownSec) / 3.0);
            const offset = totalCircumference * (1 - progress);
            this.dashRingProgress.style.strokeDashoffset = offset.toFixed(1);
        }
        if (this.dashLbl) {
            this.dashLbl.textContent = isReady ? 'DASH' : `${this.myDashCooldownSec.toFixed(1)}s`;
        }
    }

    /* -------------------------------------------------------------
       3. CONEXIÓN WEBSOCKET & SINCRONIZACIÓN
    ---------------------------------------------------------------- */
    initNetwork() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.setConnectionState(true);
                this.startPingRoutine();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'init') {
                        this.myId = data.id;
                        if (data.gameMode) this.gameMode = data.gameMode;
                        if (data.arena) {
                            this.arena = Object.assign({}, this.arena, data.arena);
                        }
                        if (data.color) this.myColor = data.color;
                    }

                    if (data.type === 'player_dash') {
                        // Ráfaga y partículas de acelerón para el jugador
                        this.spawnDashBurst(data.x, data.y, data.angle);
                        const dp = this.players.get(data.id);
                        if (dp) {
                            dp.isDashing = true;
                            dp.dashUntil = performance.now() + 200;
                        }
                    }

                    if (data.type === 'teleport') {
                        // Efecto de salto cuántico a través de portal
                        this.spawnTeleportBurst(data.fromX, data.fromY, data.toX, data.toY);
                        this.triggerScreenShake(data.entityType === 'player' ? 5 : 2, 0.2);
                        if (data.entityType === 'player') {
                            const isMe = data.entityId === this.myId;
                            this.spawnFloatingText(isMe ? '¡SALTO CUÁNTICO!' : '¡TELETRANSPORTE!', data.toX, data.toY - 25, '#00f0ff');
                            const tpPlayer = this.players.get(data.entityId);
                            if (tpPlayer) {
                                tpPlayer.targetX = data.toX;
                                tpPlayer.targetY = data.toY;
                                tpPlayer.renderX = data.toX;
                                tpPlayer.renderY = data.toY;
                                tpPlayer.trail = []; // Resetear rastro de inmediato para evitar que cruce la arena
                            }
                        }
                    }

                    if (data.type === 'heart_collected') {
                        // Efecto de recogida de corazón (+1 vida)
                        this.triggerScreenShake(6, 0.25);
                        this.spawnHeartBurst(data.x, data.y);
                        const isMe = data.playerId === this.myId;
                        this.spawnFloatingText(isMe ? '❤️ ¡+1 VIDA EXTRA!' : `❤️ +1 VIDA: ${data.playerId}`, data.x, data.y - 32, '#fb7185');
                    }

                    if (data.type === 'player_revived') {
                        // Efecto de reanimación médica / resurrección
                        this.spawnReviveBurst(data.x, data.y);
                        this.triggerScreenShake(7, 0.3);
                        if (data.revivedId === this.myId) {
                            this.spawnFloatingText('¡REANIMADO! +ESCUDOS', data.x, data.y - 30, '#10b981');
                        } else if (data.rescuerId === this.myId) {
                            this.spawnFloatingText('+250 ¡RESCATE HEROICO!', data.x, data.y - 30, '#38bdf8');
                        } else {
                            this.spawnFloatingText('¡COMPAÑERO REVIVIDO!', data.x, data.y - 30, '#10b981');
                        }
                    }

                    if (data.type === 'bomb_triggered') {
                        // ¡Detonación de bomba por impacto de jugador!
                        this.triggerScreenShake(12, 0.45);
                        this.spawnShockwaveBurst(data.x, data.y);
                        this.spawnFloatingText('+250 ¡ONDA EMP!', data.x, data.y - 30, '#fbbf24');
                    }

                    if (data.type === 'kicked') {
                        this.isKicked = true;
                        if (this.afkModal) this.afkModal.style.display = 'flex';
                    }

                    if (data.type === 'state') {
                        this.gameMode = data.gameMode || this.gameMode || 'TRON';
                        this.fsmState = data.fsmState || 'LOBBY';
                        this.hunterId = data.hunterId || null;
                        this.winReason = data.winReason || '';
                        this.roundWinnerId = data.winnerId || null;
                        this.roundCountdown = typeof data.countdown === 'number' ? data.countdown : 0;
                        this.pveWave = data.wave || 1;

                        // Sincronizar Portales de Teletransporte (Wormholes Alfa & Beta)
                        if (data.portals) {
                            this.portals = data.portals;
                        }

                        // Sincronizar Orbe EMP y Corazón Flotante (+1 Vida)
                        this.bombItem = data.bombItem || null;
                        this.activeHalo = data.activeHalo || null;
                        this.nextBombIn = typeof data.nextBombIn === 'number' ? data.nextBombIn : 0;

                        this.heartItem = data.heartItem || null;
                        this.nextHeartIn = typeof data.nextHeartIn === 'number' ? data.nextHeartIn : 0;

                        // Procesar muertes de enemigos para emitir efectos de explosión
                        const newEnemies = Array.isArray(data.enemies) ? data.enemies : [];
                        const newEnemySet = new Set(newEnemies.map(e => e.id));

                        for (const [oldId, oldData] of this.lastEnemyMap) {
                            if (!newEnemySet.has(oldId)) {
                                // ¡Enemigo destruido! Crear explosión en su posición
                                this.spawnExplosion(oldData.x, oldData.y, oldData.type === 'fast' ? '#ff0055' : '#d946ef');
                                this.spawnFloatingText('+100', oldData.x, oldData.y - 15, '#34d399');
                            }
                        }

                        this.lastEnemyMap.clear();
                        for (const e of newEnemies) {
                            this.lastEnemyMap.set(e.id, { x: e.x, y: e.y, type: e.type });
                        }
                        this.enemies = newEnemies;

                        if (Array.isArray(data.players)) {
                            this.onServerState(data.players);
                        }
                    }

                    if (data.type === 'pong') {
                        const rtt = Date.now() - data.clientTime;
                        if (this.rttVal) {
                            this.rttVal.textContent = `${rtt} ms`;
                            this.rttVal.style.color = rtt < 60 ? '#10b981' : (rtt < 130 ? '#f59e0b' : '#ef4444');
                        }
                    }
                } catch (e) {
                    console.error("Error procesando mensaje:", e);
                }
            };

            this.ws.onclose = () => {
                this.setConnectionState(false);
                this.stopPingRoutine();
                clearTimeout(this.reconnectTimer);
                if (!this.isKicked) {
                    this.reconnectTimer = setTimeout(() => this.initNetwork(), 3000);
                }
            };

            this.ws.onerror = () => {
                this.setConnectionState(false);
            };
        } catch (err) {
            this.setConnectionState(false);
            setTimeout(() => this.initNetwork(), 3000);
        }
    }

    onServerState(serverPlayers) {
        const activeIds = new Set();

        for (const sp of serverPlayers) {
            activeIds.add(sp.id);

            const safeX = typeof sp.x === 'number' && !isNaN(sp.x) ? sp.x : 400;
            const safeY = typeof sp.y === 'number' && !isNaN(sp.y) ? sp.y : 450;
            const isAlive = sp.isAlive !== false;
            const isDead = Boolean(sp.isDead);
            const reviveTicks = sp.reviveTicks || 0;
            const reviveProgress = typeof sp.reviveProgress === 'number' ? sp.reviveProgress : 0;
            const revivingBy = sp.revivingBy || null;
            const isDashing = Boolean(sp.isDashing);
            const dashCooldownSec = typeof sp.dashCooldownSec === 'number' ? sp.dashCooldownSec : 0;
            const dashReady = Boolean(sp.dashReady);
            const isAfk = Boolean(sp.isAfk);
            const isIt = Boolean(sp.isIt);
            const score = sp.score || 0;
            const lives = sp.lives !== undefined ? sp.lives : 3;
            const trail = Array.isArray(sp.trail) ? sp.trail : [];

            let p = this.players.get(sp.id);
            if (!p) {
                p = {
                    id: sp.id,
                    targetX: safeX,
                    targetY: safeY,
                    renderX: safeX,
                    renderY: safeY,
                    vx: sp.vx || 0,
                    vy: sp.vy || 0,
                    angle: Math.atan2(sp.vy || 0, sp.vx || 0) || 0,
                    color: sp.color || (isIt ? '#ff0055' : '#00f0ff'),
                    isIt: isIt,
                    isAlive: isAlive,
                    isDead: isDead,
                    reviveTicks: reviveTicks,
                    reviveProgress: reviveProgress,
                    revivingBy: revivingBy,
                    isDashing: isDashing,
                    dashCooldownSec: dashCooldownSec,
                    dashReady: dashReady,
                    score: score,
                    lives: lives,
                    isInvulnerable: Boolean(sp.isInvulnerable),
                    trail: trail,
                    isAfk: isAfk
                };
                this.players.set(sp.id, p);
            } else {
                p.targetX = safeX;
                p.targetY = safeY;
                p.isAlive = isAlive;
                p.isDead = isDead;
                p.reviveTicks = reviveTicks;
                p.reviveProgress = reviveProgress;
                p.revivingBy = revivingBy;
                p.isDashing = isDashing;
                p.dashCooldownSec = dashCooldownSec;
                p.dashReady = dashReady;
                p.isIt = isIt;
                p.score = score;
                p.lives = lives;
                p.isInvulnerable = Boolean(sp.isInvulnerable);
                p.trail = trail;
                p.isAfk = isAfk;
                if (sp.id === this.myId) {
                    p.vx = this.currentInput.vx;
                    p.vy = this.currentInput.vy;
                    // Sincronizar dash local
                    this.myDashCooldownSec = dashCooldownSec;
                    this.myDashReady = dashReady;
                    this.updateDashUI();
                } else {
                    p.vx = sp.vx || 0;
                    p.vy = sp.vy || 0;
                }
                if (sp.color) p.color = sp.color;
            }
        }

        // Eliminar jugadores desconectados
        for (const id of this.players.keys()) {
            if (!activeIds.has(id)) {
                this.players.delete(id);
            }
        }

        if (this.playersVal) {
            this.playersVal.textContent = this.players.size;
        }

        // Métricas HUD de PvE
        if (this.pveWaveVal) this.pveWaveVal.textContent = this.pveWave;
        if (this.pveEnemiesVal) this.pveEnemiesVal.textContent = this.enemies.length;
        const myPlayer = this.players.get(this.myId);
        if (this.pveScoreVal && myPlayer) {
            this.pveScoreVal.textContent = myPlayer.score || 0;
        }

        // Estado del Orbe EMP en la barra HUD
        this.updateEmpPillUI();

        // Actualizar UI del FSM, Marcador y Banners
        this.updateFsmUI();
    }

    updateEmpPillUI() {
        if (!this.pveBombVal || !this.pveBombTag || !this.bombLedDot) return;

        if (this.bombItem) {
            this.pveBombTag.classList.add('active');
            this.pveBombVal.textContent = '¡ORBE EN ARENA!';
        } else if (this.activeHalo) {
            this.pveBombTag.classList.add('active');
            this.pveBombVal.textContent = '¡ONDA ACTIVA!';
        } else if (this.nextBombIn > 0) {
            this.pveBombTag.classList.remove('active');
            this.pveBombVal.textContent = `EMP: ${this.nextBombIn}s`;
        } else {
            this.pveBombTag.classList.remove('active');
            this.pveBombVal.textContent = 'EMP: CARGANDO';
        }
    }

    updateFsmUI() {
        if (!this.gameRoleBanner) return;

        // Sincronizar selector de modo
        if (this.modeTronBtn && this.modePveBtn) {
            this.modeTronBtn.classList.toggle('active', this.gameMode === 'TRON');
            this.modePveBtn.classList.toggle('active', this.gameMode === 'PVE');
        }

        // Visibilidad condicional
        if (this.gameMode === 'PVE') {
            if (this.scorePill) this.scorePill.style.display = 'none';
            if (this.pveStatsPill) this.pveStatsPill.style.display = 'inline-flex';
        } else {
            if (this.pveStatsPill) this.pveStatsPill.style.display = 'none';

            if (this.scorePill) {
                const playerList = [...this.players.values()];
                if (this.fsmState !== 'LOBBY' && playerList.length >= 2) {
                    this.scorePill.style.display = 'inline-flex';
                    const p1 = playerList[0];
                    const p2 = playerList[1];

                    const isP1Me = p1.id === this.myId;
                    const isP2Me = p2.id === this.myId;

                    if (this.p1ScoreTag) {
                        this.p1ScoreTag.innerHTML = `${isP1Me ? 'TÚ' : p1.id} <strong id="p1-score-val">${p1.score || 0}</strong>`;
                        this.p1ScoreTag.style.color = p1.isIt ? '#ff0055' : '#00f0ff';
                    }
                    if (this.p2ScoreTag) {
                        this.p2ScoreTag.innerHTML = `<strong id="p2-score-val">${p2.score || 0}</strong> ${isP2Me ? 'TÚ' : p2.id}`;
                        this.p2ScoreTag.style.color = p2.isIt ? '#ff0055' : '#00f0ff';
                    }
                } else {
                    this.scorePill.style.display = 'none';
                }
            }
        }

        // Banners informativos sin emojis infantiles
        const total = this.players.size;
        const amIHunter = this.myId === this.hunterId;

        switch (this.fsmState) {
            case 'LOBBY': {
                this.gameRoleBanner.className = 'game-role-banner lobby';
                if (this.roleText) {
                    if (this.gameMode === 'PVE') {
                        this.roleText.textContent = 'SUPERVIVENCIA PVE — PREPARANDO OLEADA...';
                    } else {
                        this.roleText.textContent = total < 2
                            ? `ESPERANDO OPONENTE (${total}/2)...`
                            : `OPONENTE CONECTADO — INICIANDO RONDA...`;
                    }
                }
                break;
            }

            case 'TRON_GAME': {
                const myP = this.players.get(this.myId);
                const amIAlive = myP ? myP.isAlive : true;

                if (!amIAlive) {
                    this.gameRoleBanner.className = 'game-role-banner defeat';
                    if (this.roleText) this.roleText.textContent = 'NAVE DESTRUIDA — ESPERANDO RONDA';
                } else if (amIHunter) {
                    this.gameRoleBanner.className = 'game-role-banner hunter';
                    if (this.roleText) this.roleText.textContent = 'ROL: CAZADOR — ¡INTERCEPTA AL CORREDOR!';
                } else {
                    this.gameRoleBanner.className = 'game-role-banner runner';
                    if (this.roleText) this.roleText.textContent = 'ROL: CORREDOR — ¡ESCAPA DEL CAZADOR!';
                }
                break;
            }

            case 'ROUND_OVER': {
                const countdownText = this.roundCountdown > 0 ? ` [${this.roundCountdown}s]` : '';
                const isDraw = this.roundWinnerId === 'draw';
                const amIWinner = this.roundWinnerId === this.myId;

                if (isDraw) {
                    this.gameRoleBanner.className = 'game-role-banner draw';
                    if (this.roleText) this.roleText.textContent = `EMPATE: IMPACTO SIMULTÁNEO${countdownText}`;
                } else if (this.winReason === 'tag') {
                    this.gameRoleBanner.className = amIHunter ? 'game-role-banner victory' : 'game-role-banner defeat';
                    if (this.roleText) {
                        this.roleText.textContent = amIHunter
                            ? `¡INTERCEPCIÓN EXITOSA! +1 PTO${countdownText}`
                            : `¡HAS SIDO ALCANZADO POR EL CAZADOR!${countdownText}`;
                    }
                } else if (this.winReason === 'trail') {
                    this.gameRoleBanner.className = amIWinner ? 'game-role-banner victory' : 'game-role-banner defeat';
                    if (this.roleText) {
                        this.roleText.textContent = amIWinner
                            ? `RIVAL COLISIONÓ CON EL RASTRO NEÓN +1 PTO${countdownText}`
                            : `COLISIÓN CON RASTRO NEÓN${countdownText}`;
                    }
                } else {
                    this.gameRoleBanner.className = amIWinner ? 'game-role-banner victory' : 'game-role-banner defeat';
                    if (this.roleText) {
                        this.roleText.textContent = amIWinner
                            ? `VICTORIA DE RONDA +1 PTO${countdownText}`
                            : `RONDA PERDIDA${countdownText}`;
                    }
                }
                break;
            }

            case 'PVE_GAME': {
                const myP = this.players.get(this.myId);
                const isDead = myP ? Boolean(myP.isDead) : false;
                const amIAlive = myP ? myP.isAlive : true;
                const myLives = myP ? (myP.lives !== undefined ? myP.lives : 3) : 3;

                if (isDead) {
                    this.gameRoleBanner.className = 'game-role-banner defeat';
                    if (this.roleText) {
                        const progress = myP && typeof myP.reviveProgress === 'number' ? Math.round(myP.reviveProgress * 100) : 0;
                        this.roleText.textContent = progress > 0
                            ? `¡REANIMACIÓN EN PROGRESO: ${progress}%! COMPAÑERO ASISTIENDO`
                            : 'PILOTO DERRIBADO — MANTÉN AL COMPAÑERO CERCA (<40px) DURANTE 2s PARA RESCATARTE';
                    }
                } else if (!amIAlive) {
                    this.gameRoleBanner.className = 'game-role-banner defeat';
                    if (this.roleText) this.roleText.textContent = 'NAVE CAÍDA — REAGRUPANDO EN SIGUIENTE OLEADA';
                } else {
                    this.gameRoleBanner.className = 'game-role-banner pve';
                    // Comprobar si algún compañero de escuadrón está caído
                    let teammateDead = null;
                    for (const other of this.players.values()) {
                        if (other.id !== this.myId && other.isDead) {
                            teammateDead = other;
                            break;
                        }
                    }

                    if (this.roleText) {
                        if (teammateDead) {
                            const prog = typeof teammateDead.reviveProgress === 'number' ? Math.round(teammateDead.reviveProgress * 100) : 0;
                            this.roleText.textContent = prog > 0
                                ? `¡REANIMANDO COMPAÑERO: ${prog}%! QUÉDATE DENTRO DE LOS 40px`
                                : `¡ALERTA! COMPAÑERO DERRIBADO — ACÉRCATE A SU LÁPIDA (<40px) 2s PARA RESCATARLO`;
                        } else {
                            this.roleText.textContent = `OLEADA ${this.pveWave} — ESCUDOS: ${myLives}/3 | PORTALES α/β (10s) | SHIFT DASH`;
                        }
                    }
                }
                break;
            }

            case 'PVE_GAME_OVER': {
                const countdownText = this.roundCountdown > 0 ? ` [${this.roundCountdown}s]` : '';
                this.gameRoleBanner.className = 'game-role-banner pve-gameover';
                if (this.roleText) this.roleText.textContent = `MISIÓN FALLIDA — ESCUADRÓN ELIMINADO${countdownText}`;
                break;
            }
        }
    }

    setConnectionState(isConnected) {
        if (this.statusPill) {
            if (isConnected) {
                this.statusPill.classList.remove('disconnected');
                this.statusPill.classList.add('connected');
                if (this.statusText) this.statusText.textContent = 'Online';
            } else {
                this.statusPill.classList.remove('connected');
                this.statusPill.classList.add('disconnected');
                if (this.statusText) this.statusText.textContent = 'Offline';
                if (this.rttVal) this.rttVal.textContent = '-- ms';
            }
        }
    }

    startPingRoutine() {
        this.stopPingRoutine();
        this.pingTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now()
                }));
            }
        }, 2000);
    }

    stopPingRoutine() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    /* -------------------------------------------------------------
       4. SISTEMA DE EFECTOS VISUALES ARCADE (VFX)
    ---------------------------------------------------------------- */
    triggerScreenShake(intensity, duration = 0.3) {
        this.screenShake.intensity = Math.max(this.screenShake.intensity, intensity);
        this.screenShake.duration = duration;
        this.screenShake.timer = duration;
    }

    spawnExplosion(x, y, color = '#ff0055', count = 18) {
        this.triggerScreenShake(5, 0.2);

        // Anillo de choque de fragmentación
        this.particles.push({
            type: 'ring',
            x: x,
            y: y,
            radius: 4,
            maxRadius: 40,
            color: color,
            alpha: 1,
            decay: 2.2
        });

        // Chispas de escombros de alta energía
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 220;
            this.particles.push({
                type: 'spark',
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: Math.random() > 0.4 ? color : '#ffffff',
                size: 2 + Math.random() * 3,
                alpha: 1,
                decay: 1.8 + Math.random() * 1.5
            });
        }
    }

    spawnShockwaveBurst(x, y) {
        for (let i = 0; i < 35; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 350;
            this.particles.push({
                type: 'spark',
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: Math.random() > 0.3 ? '#fbbf24' : '#ffffff',
                size: 3 + Math.random() * 3,
                alpha: 1,
                decay: 1.2
            });
        }
    }

    spawnThrusterSpark(x, y, angle, color) {
        // Chispas de propulsión de motor
        const spread = (Math.random() - 0.5) * 0.4;
        const sparkAngle = angle + Math.PI + spread;
        const speed = 80 + Math.random() * 120;
        this.particles.push({
            type: 'thruster',
            x: x,
            y: y,
            vx: Math.cos(sparkAngle) * speed,
            vy: Math.sin(sparkAngle) * speed,
            color: color,
            size: 2 + Math.random() * 2,
            alpha: 0.9,
            decay: 4.5
        });
    }

    spawnFloatingText(text, x, y, color = '#fbbf24') {
        this.floatingTexts.push({
            text: text,
            x: x,
            y: y,
            color: color,
            alpha: 1,
            vy: -40,
            decay: 1.2
        });
    }

    spawnDashBurst(x, y, angle) {
        // Ráfaga de aceleración instantánea (estela de energía inversa)
        const count = 16;
        for (let i = 0; i < count; i++) {
            const spread = (Math.random() - 0.5) * 0.9;
            const sparkAngle = (angle !== undefined ? angle : 0) + Math.PI + spread;
            const speed = 140 + Math.random() * 260;
            this.particles.push({
                type: 'spark',
                x: x,
                y: y,
                vx: Math.cos(sparkAngle) * speed,
                vy: Math.sin(sparkAngle) * speed,
                color: Math.random() > 0.4 ? '#38bdf8' : '#ffffff',
                size: 2.5 + Math.random() * 2.5,
                alpha: 1,
                decay: 3.5
            });
        }
        // Anillo de choque sónico
        this.particles.push({
            type: 'ring',
            x: x,
            y: y,
            radius: 8,
            maxRadius: 36,
            color: '#38bdf8',
            alpha: 0.9,
            decay: 4.5
        });
    }

    spawnDashStreak(x, y, angle, color) {
        const spread = (Math.random() - 0.5) * 0.3;
        const sparkAngle = angle + Math.PI + spread;
        const speed = 180 + Math.random() * 140;
        this.particles.push({
            type: 'spark',
            x: x,
            y: y,
            vx: Math.cos(sparkAngle) * speed,
            vy: Math.sin(sparkAngle) * speed,
            color: color || '#38bdf8',
            size: 2 + Math.random() * 2,
            alpha: 0.85,
            decay: 5.0
        });
    }

    spawnTeleportBurst(fromX, fromY, toX, toY) {
        // Vórtice de colapso en el portal de origen
        this.particles.push({
            type: 'ring',
            x: fromX,
            y: fromY,
            radius: 4,
            maxRadius: 35,
            color: '#00f0ff',
            alpha: 1,
            decay: 3.0
        });
        for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 30;
            this.particles.push({
                type: 'spark',
                x: fromX + Math.cos(angle) * dist,
                y: fromY + Math.sin(angle) * dist,
                vx: -Math.cos(angle) * 120,
                vy: -Math.sin(angle) * 120,
                color: '#38bdf8',
                size: 2 + Math.random() * 2,
                alpha: 1,
                decay: 3.0
            });
        }

        // Vórtice de expansión cuántica en el portal de destino
        this.particles.push({
            type: 'ring',
            x: toX,
            y: toY,
            radius: 6,
            maxRadius: 45,
            color: '#f43f5e',
            alpha: 1,
            decay: 2.2
        });
        for (let i = 0; i < 16; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 200;
            this.particles.push({
                type: 'spark',
                x: toX,
                y: toY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: Math.random() > 0.4 ? '#f43f5e' : '#ffffff',
                size: 2.5 + Math.random() * 2.5,
                alpha: 1,
                decay: 2.5
            });
        }
    }

    spawnReviveBurst(x, y) {
        // Doble anillo de nanorresurrección
        this.particles.push({
            type: 'ring',
            x: x,
            y: y,
            radius: 10,
            maxRadius: 65,
            color: '#10b981',
            alpha: 1,
            decay: 1.8
        });
        this.particles.push({
            type: 'ring',
            x: x,
            y: y,
            radius: 4,
            maxRadius: 40,
            color: '#a7f3d0',
            alpha: 1,
            decay: 2.5
        });

        // 25 partículas ascendentes de plasma médico
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 150;
            this.particles.push({
                type: 'spark',
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                color: Math.random() > 0.3 ? '#34d399' : '#ffffff',
                size: 2.5 + Math.random() * 3,
                alpha: 1,
                decay: 1.6
            });
        }
    }

    spawnHeartBurst(x, y) {
        // Anillo de energía vital rosado
        this.particles.push({
            type: 'ring',
            x: x,
            y: y,
            radius: 8,
            maxRadius: 55,
            color: '#f43f5e',
            alpha: 1,
            decay: 2.0
        });

        // Chispas flotantes de amor y vitalidad
        for (let i = 0; i < 22; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 160;
            this.particles.push({
                type: 'spark',
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 40,
                color: Math.random() > 0.35 ? '#fb7185' : '#ffffff',
                size: 2.5 + Math.random() * 2.5,
                alpha: 1,
                decay: 1.8
            });
        }
    }

    updateVFX(dt) {
        // Sacudida de pantalla
        if (this.screenShake.timer > 0) {
            this.screenShake.timer -= dt;
            const progress = this.screenShake.timer / this.screenShake.duration;
            const currentIntensity = this.screenShake.intensity * Math.max(0, progress);
            this.screenShake.offsetX = (Math.random() - 0.5) * 2 * currentIntensity;
            this.screenShake.offsetY = (Math.random() - 0.5) * 2 * currentIntensity;
        } else {
            this.screenShake.intensity = 0;
            this.screenShake.offsetX = 0;
            this.screenShake.offsetY = 0;
        }

        // Partículas
        const activeParticles = [];
        for (const p of this.particles) {
            p.alpha -= p.decay * dt;
            if (p.alpha <= 0) continue;

            if (p.type === 'ring') {
                p.radius = Math.max(0.1, p.radius + (p.maxRadius - p.radius) * 12 * dt);
            } else {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= (1 - 3 * dt);
                p.vy *= (1 - 3 * dt);
            }
            activeParticles.push(p);
        }
        this.particles = activeParticles;

        // Textos flotantes
        const activeTexts = [];
        for (const ft of this.floatingTexts) {
            ft.alpha -= ft.decay * dt;
            ft.y += ft.vy * dt;
            if (ft.alpha > 0) {
                activeTexts.push(ft);
            }
        }
        this.floatingTexts = activeTexts;
    }

    /* -------------------------------------------------------------
       5. GAME LOOP: MOVIMIENTO FLUIDO A 60 FPS
    ---------------------------------------------------------------- */
    startGameLoop() {
        const loop = (timestamp) => {
            try {
                const dt = Math.min((timestamp - this.lastFrameTime) / 1000, 0.1);
                this.lastFrameTime = timestamp;
                this.gameTime += dt;

                this.checkSendInput(false);
                this.updateInterpolation(dt);
                this.updateVFX(dt);
                this.render(dt);
                this.calculateFps(timestamp);
            } catch (err) {
                console.error("Game loop error:", err);
            }
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    updateInterpolation(dt) {
        const speed = this.arena.speed || 420;

        // Decrementar temporizador local de Dash para fluidez a 60 FPS
        if (this.myDashCooldownSec > 0) {
            this.myDashCooldownSec = Math.max(0, this.myDashCooldownSec - dt);
            if (this.myDashCooldownSec === 0) {
                this.myDashReady = true;
            }
            this.updateDashUI();
        }

        const now = performance.now();

        for (const p of this.players.values()) {
            if (isNaN(p.renderX)) p.renderX = p.targetX || 400;
            if (isNaN(p.renderY)) p.renderY = p.targetY || 450;

            if (p.isDead) {
                // Jugador caído: congelado como lápida en su posición de muerte
                p.renderX = p.targetX;
                p.renderY = p.targetY;
                p.vx = 0;
                p.vy = 0;
                continue;
            }

            if (p.isAlive) {
                // Impulso de Dash: multiplicador x2.5
                const isDashing = p.isDashing || (p.dashUntil && p.dashUntil > now) || (p.id === this.myId && now < this.myDashActiveUntil);
                const currentSpeed = isDashing ? speed * 2.5 : speed;

                // Extrapolación de movimiento autoritativo
                p.renderX += p.vx * currentSpeed * dt;
                p.renderY += p.vy * currentSpeed * dt;

                // Suave reconciliación con el servidor
                const corr = Math.min(1, 9 * dt);
                p.renderX += (p.targetX - p.renderX) * corr;
                p.renderY += (p.targetY - p.renderY) * corr;

                // Emitir chispas de motor si se está desplazando
                if (Math.hypot(p.vx, p.vy) > 0.1) {
                    if (isDashing) {
                        this.spawnDashStreak(p.renderX, p.renderY, p.angle, p.color || '#00f0ff');
                    } else if (Math.random() < 0.35) {
                        const engineColor = this.gameMode === 'PVE' ? '#34d399' : (p.isIt ? '#ff0055' : '#00f0ff');
                        this.spawnThrusterSpark(p.renderX, p.renderY, p.angle, engineColor);
                    }
                }
            } else {
                p.renderX = p.targetX;
                p.renderY = p.targetY;
            }

            // Suavizado de giro
            const velMag = Math.hypot(p.vx, p.vy);
            if (velMag > 0.08) {
                const targetAngle = Math.atan2(p.vy, p.vx);
                let diff = targetAngle - p.angle;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                p.angle += diff * Math.min(1, 16 * dt);
            }
        }
    }

    calculateFps(now) {
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            const currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
            if (this.fpsVal) this.fpsVal.textContent = `${currentFps} FPS`;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    /* -------------------------------------------------------------
       6. RENDERIZADO VISUAL DE ALTA GAMA
    ---------------------------------------------------------------- */
    render(dt = 0.016) {
        const ctx = this.ctx;
        const w = this.viewportWidth;
        const h = this.viewportHeight;

        // Limpiar fondo
        ctx.fillStyle = '#050811';
        ctx.fillRect(0, 0, w, h);

        const isMobile = w < 768;

        // Ajuste de encuadre
        const padX = isMobile ? 12 : 36;
        const padTop = isMobile ? 74 : 70;
        const padBottom = isMobile ? 135 : 40;

        const availW = w - padX * 2;
        const availH = h - padTop - padBottom;

        // Factor de zoom cenital
        const zoom = Math.min(availW / this.arena.width, availH / this.arena.height);

        const viewCenterX = w / 2;
        const viewCenterY = isMobile ? padTop + (availH / 2) : h / 2;

        ctx.save();
        // Aplicar sacudida de pantalla si está activa
        ctx.translate(this.screenShake.offsetX, this.screenShake.offsetY);

        ctx.translate(viewCenterX, viewCenterY);
        ctx.scale(zoom, zoom);
        ctx.translate(-this.arena.width / 2, -this.arena.height / 2);

        // 1. Arena de combate cibernética
        this.drawArena(ctx);

        // NUEVO: Portales de teletransporte cuánticos (Wormholes Alfa & Beta)
        if (this.gameMode === 'PVE' && this.portals) {
            this.drawPortals(ctx);
        }

        // NUEVO: Rayos de nanorrescate (Revival Beams) conectando rescatador con lápida
        if (this.gameMode === 'PVE') {
            this.drawReviveBeams(ctx);
        }

        // 2. Orbe de Bomba Táctica EMP (aparece cada 20s en punto aleatorio)
        if (this.gameMode === 'PVE' && this.bombItem) {
            this.drawBombItem(ctx, this.bombItem);
        }

        // 2.5 Corazón Flotante (+1 Vida extra cada 30 segundos)
        if (this.gameMode === 'PVE' && this.heartItem) {
            this.drawHeartItem(ctx, this.heartItem);
        }

        // 3. Halo destructor en tiempo real (expansión física a 950 px/s)
        if (this.gameMode === 'PVE' && this.activeHalo) {
            this.drawActiveHalo(ctx, this.activeHalo);
        }

        // 4. Rastros de luz / barreras letales
        for (const p of this.players.values()) {
            this.drawPlayerTrail(ctx, p);
        }

        // 5. Drones hostiles de alta visibilidad (PvE)
        if (this.gameMode === 'PVE') {
            this.drawEnemies(ctx);
        }

        // 6. Naves de combate o lápidas de los jugadores
        for (const p of this.players.values()) {
            const isLocal = p.id === this.myId;
            this.drawPlayer(ctx, p, isLocal);
        }

        // 7. Partículas y escombros arcade
        this.drawParticles(ctx);

        // 8. Textos emergentes de puntuación
        this.drawFloatingTexts(ctx);

        // 9. Radar periférico de amenaza para móviles (si hay enemigos cerca del borde)
        if (this.gameMode === 'PVE') {
            const myP = this.players.get(this.myId);
            if (myP && myP.isAlive && !myP.isDead) {
                this.drawThreatRadar(ctx, myP);
            }
        }

        ctx.restore();
    }

    drawArena(ctx) {
        const arenaW = this.arena.width;
        const arenaH = this.arena.height;

        // Suelo espacial oscuro con profundidad
        const bgGrad = ctx.createRadialGradient(
            arenaW / 2, arenaH / 2, 50,
            arenaW / 2, arenaH / 2, arenaW * 0.7
        );
        bgGrad.addColorStop(0, '#0a101f');
        bgGrad.addColorStop(1, '#04070e');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, arenaW, arenaH);

        // Cuadrícula táctica neón sutil
        ctx.beginPath();
        ctx.strokeStyle = this.gameMode === 'PVE' ? 'rgba(16, 185, 129, 0.06)' : 'rgba(0, 240, 255, 0.05)';
        ctx.lineWidth = 1;

        for (let x = 0; x <= arenaW; x += 50) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, arenaH);
        }
        for (let y = 0; y <= arenaH; y += 50) {
            ctx.moveTo(0, y);
            ctx.lineTo(arenaW, y);
        }
        ctx.stroke();

        // Círculo central táctico
        ctx.beginPath();
        ctx.strokeStyle = this.gameMode === 'PVE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 1.5;
        ctx.arc(arenaW / 2, arenaH / 2, 85, 0, Math.PI * 2);
        ctx.stroke();

        // Retícula central
        ctx.beginPath();
        ctx.moveTo(arenaW / 2 - 15, arenaH / 2);
        ctx.lineTo(arenaW / 2 + 15, arenaH / 2);
        ctx.moveTo(arenaW / 2, arenaH / 2 - 15);
        ctx.lineTo(arenaW / 2, arenaH / 2 + 15);
        ctx.stroke();

        // Borde exterior electrificado
        ctx.save();
        const borderColor = this.gameMode === 'PVE' ? '#10b981' : '#00f0ff';
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 3;
        ctx.shadowColor = borderColor;
        ctx.shadowBlur = 12;
        ctx.strokeRect(0, 0, arenaW, arenaH);

        // Cantoneras angulares de refuerzo táctico
        const cornerSize = 24;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';

        // Superior Izq
        ctx.beginPath();
        ctx.moveTo(0, cornerSize);
        ctx.lineTo(0, 0);
        ctx.lineTo(cornerSize, 0);
        ctx.stroke();

        // Superior Der
        ctx.beginPath();
        ctx.moveTo(arenaW - cornerSize, 0);
        ctx.lineTo(arenaW, 0);
        ctx.lineTo(arenaW, cornerSize);
        ctx.stroke();

        // Inferior Izq
        ctx.beginPath();
        ctx.moveTo(0, arenaH - cornerSize);
        ctx.lineTo(0, arenaH);
        ctx.lineTo(cornerSize, arenaH);
        ctx.stroke();

        // Inferior Der
        ctx.beginPath();
        ctx.moveTo(arenaW - cornerSize, arenaH);
        ctx.lineTo(arenaW, arenaH);
        ctx.lineTo(arenaW, arenaH - cornerSize);
        ctx.stroke();

        ctx.restore();
    }

    /* -------------------------------------------------------------
       7. ORBE EMP Y HALO DESTRUCTOR EXPANSIVO
    ---------------------------------------------------------------- */
    drawBombItem(ctx, bomb) {
        const t = this.gameTime;
        const bx = bomb.x;
        const by = bomb.y;
        const baseRadius = bomb.radius || 24;

        ctx.save();
        ctx.translate(bx, by);

        // 1. Campo de proximidad magnético (círculo pulsante exterior)
        const pulse = Math.sin(t * 6) * 4;
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius + 14 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Anillos giroscópicos orbitales 3D proyectados
        ctx.save();
        ctx.rotate(t * 2.2);
        ctx.beginPath();
        ctx.ellipse(0, 0, baseRadius + 7, (baseRadius + 7) * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.rotate(-t * 1.8 + Math.PI / 3);
        ctx.beginPath();
        ctx.ellipse(0, 0, baseRadius + 7, (baseRadius + 7) * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();

        // 3. Núcleo cuántico superdenso con resplandor dorado
        const coreGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, baseRadius);
        coreGrad.addColorStop(0, '#ffffff'); // Blanco incandescente
        coreGrad.addColorStop(0.35, '#fde047'); // Amarillo solar
        coreGrad.addColorStop(0.75, '#f59e0b'); // Ámbar puro
        coreGrad.addColorStop(1, '#78350f');   // Borde de plasma

        ctx.beginPath();
        ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 20;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 4. Etiqueta flotante arcade: "ORBE EMP"
        const floatBob = Math.sin(t * 4) * 3;
        const tagY = -baseRadius - 16 + floatBob;

        ctx.font = '800 10.5px Inter, sans-serif';
        const tagText = 'ORBE EMP';
        const textW = ctx.measureText(tagText).width;

        ctx.fillStyle = 'rgba(20, 15, 5, 0.9)';
        this.drawRoundedRect(ctx, -textW / 2 - 7, tagY - 8, textW + 14, 16, 8);
        ctx.fill();

        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, 0, tagY);

        ctx.restore();
    }

    /* -------------------------------------------------------------
       7.6 CORAZÓN FLOTANTE CIBERNÉTICO (+1 VIDA EXTRA CADA 30s)
    ---------------------------------------------------------------- */
    drawHeartItem(ctx, heart) {
        if (!heart) return;
        const hx = heart.x;
        const hy = heart.y;
        const baseRadius = heart.radius || 18;
        const t = this.gameTime;

        // Ondulación flotante vertical y escala con latido rítmico cardíaco
        const bob = Math.sin(t * 3.5) * 5;
        const rawPulse = Math.sin(t * 6);
        const pulse = 1 + (rawPulse > 0.4 ? (rawPulse - 0.4) * 0.28 : 0);

        ctx.save();
        ctx.translate(hx, hy + bob);

        // 1. Halo áureo/rosado exterior pulsante
        const auraRadius = baseRadius * 1.55 + Math.sin(t * 4) * 3;
        const auraGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, auraRadius);
        auraGrad.addColorStop(0, 'rgba(244, 63, 94, 0.45)');
        auraGrad.addColorStop(0.6, 'rgba(225, 29, 72, 0.18)');
        auraGrad.addColorStop(1, 'rgba(159, 18, 57, 0)');
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fillStyle = auraGrad;
        ctx.fill();

        // 2. Anillo de energía vital en órbita giroscópica
        ctx.save();
        ctx.rotate(t * 1.6);
        ctx.beginPath();
        ctx.ellipse(0, 0, baseRadius * 1.45, baseRadius * 0.55, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(254, 205, 211, 0.85)';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();

        // 3. Silueta del corazón en curvas Bézier paramétricas
        const s = baseRadius * pulse;
        ctx.beginPath();
        ctx.moveTo(0, s * 0.75); // Vértice inferior
        // Lóbulo izquierdo
        ctx.bezierCurveTo(-s * 1.35, s * 0.1, -s * 1.35, -s * 0.95, 0, -s * 0.45);
        // Lóbulo derecho
        ctx.bezierCurveTo(s * 1.35, -s * 0.95, s * 1.35, s * 0.1, 0, s * 0.75);
        ctx.closePath();

        // Gradiente radial de rubí y cristal hiper-luminoso
        const heartGrad = ctx.createRadialGradient(-s * 0.2, -s * 0.3, 1, 0, 0, s * 1.2);
        heartGrad.addColorStop(0, '#ffffff'); // Núcleo especular incandescente
        heartGrad.addColorStop(0.25, '#ffe4e6'); // Blanco rosáceo
        heartGrad.addColorStop(0.65, '#f43f5e'); // Carmesí neón
        heartGrad.addColorStop(1, '#9f1239'); // Borde de rubí profundo
        ctx.fillStyle = heartGrad;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 22;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // 4. Reflejo especular en el lóbulo superior izquierdo para dar volumen 3D
        ctx.save();
        ctx.beginPath();
        ctx.arc(-s * 0.45, -s * 0.55, s * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.restore();

        // 5. Badge táctico flotante: "+1 VIDA"
        const tagY = -s - 14;
        ctx.font = '800 10.5px Inter, sans-serif';
        const tagText = '+1 VIDA';
        const textW = ctx.measureText(tagText).width;

        ctx.fillStyle = 'rgba(15, 12, 18, 0.9)';
        this.drawRoundedRect(ctx, -textW / 2 - 7, tagY - 8, textW + 14, 16, 8);
        ctx.fill();

        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#ffe4e6';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, 0, tagY);

        ctx.restore();
    }

    drawActiveHalo(ctx, halo) {
        const hx = halo.x;
        const hy = halo.y;
        const r = halo.radius;

        if (r <= 0) return;

        ctx.save();
        ctx.translate(hx, hy);

        // 1. Frente de onda destructor exterior (anillo primario brillante)
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
        ctx.lineWidth = 5.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 25;
        ctx.stroke();

        // 2. Halo de energía expansiva secundaria (dorado/ámbar)
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0, r - 9), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.65)';
        ctx.lineWidth = 14;
        ctx.shadowColor = '#ea580c';
        ctx.shadowBlur = 18;
        ctx.stroke();

        // 3. Resplandor interno de plasma translúcido
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0, r - 16), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.05)';
        ctx.fill();

        // 4. Rayos y arcos voltaicos en el perímetro del frente de onda
        const sparkCount = 8;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        for (let i = 0; i < sparkCount; i++) {
            const angle = (i * Math.PI * 2) / sparkCount + (this.gameTime * 4);
            const sx = Math.cos(angle) * r;
            const sy = Math.sin(angle) * r;
            const ex = Math.cos(angle + 0.1) * (r + (Math.sin(this.gameTime * 15 + i) * 8));
            const ey = Math.sin(angle + 0.1) * (r + (Math.sin(this.gameTime * 15 + i) * 8));
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
        }

        ctx.restore();
    }

    /* -------------------------------------------------------------
       8. DRONES HOSTILES DE ALTA VISIBILIDAD PARA MÓVILES
    ---------------------------------------------------------------- */
    drawEnemies(ctx) {
        if (!this.enemies || this.enemies.length === 0) return;

        const t = this.gameTime;
        const enemyRadius = 22; // Radio generoso de alta visibilidad

        for (const e of this.enemies) {
            const ex = e.x;
            const ey = e.y;
            const isFast = e.type === 'fast';

            // Colores vibrantes de alto contraste que destacan instantáneamente
            const primaryColor = isFast ? '#ff0055' : '#d946ef'; // Crimson eléctrico vs Violeta neón
            const secondaryColor = isFast ? '#fb7185' : '#e879f9';
            const edgeColor = isFast ? '#ffe4e6' : '#fdf4ff';

            ctx.save();
            ctx.translate(ex, ey);

            // 1. Halo pulsante de alarma perimetral
            const pulse = Math.sin(t * 8 + ex * 0.1) * 3;
            ctx.beginPath();
            ctx.arc(0, 0, enemyRadius + 6 + pulse, 0, Math.PI * 2);
            ctx.strokeStyle = isFast ? 'rgba(255, 0, 85, 0.45)' : 'rgba(217, 70, 239, 0.45)';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = primaryColor;
            ctx.shadowBlur = 14;
            ctx.stroke();

            // 2. Cuchillas de asalto biomecánicas rotatorias
            ctx.save();
            ctx.rotate(t * (isFast ? 5.5 : 3.5));
            const blades = isFast ? 5 : 4;
            ctx.strokeStyle = secondaryColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            for (let i = 0; i < blades; i++) {
                const angle = (i * Math.PI * 2) / blades;
                const bx = Math.cos(angle) * (enemyRadius + 7);
                const by = Math.sin(angle) * (enemyRadius + 7);
                ctx.moveTo(0, 0);
                ctx.lineTo(bx, by);
            }
            ctx.stroke();
            ctx.restore();

            // 3. Carcasa blindada poligonal (Chasis facetado en grafito y neón)
            ctx.beginPath();
            const sides = isFast ? 6 : 8;
            for (let i = 0; i < sides; i++) {
                const angle = (i * Math.PI * 2) / sides;
                const px = Math.cos(angle) * enemyRadius;
                const py = Math.sin(angle) * enemyRadius;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();

            const hullGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, enemyRadius);
            hullGrad.addColorStop(0, '#ffffff'); // Núcleo incandescente
            hullGrad.addColorStop(0.3, primaryColor); // Neón puro
            hullGrad.addColorStop(0.75, isFast ? '#881337' : '#4a044e'); // Carcasa oscura
            hullGrad.addColorStop(1, '#090514'); // Borde blindado
            ctx.fillStyle = hullGrad;
            ctx.shadowColor = primaryColor;
            ctx.shadowBlur = 16;
            ctx.fill();

            ctx.strokeStyle = edgeColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // 4. Sensor óptico hostil central con destello
            ctx.beginPath();
            ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 8;
            ctx.fill();

            ctx.restore();
        }
    }

    /* Radar direccional de amenazas para pantallas móviles */
    drawThreatRadar(ctx, myPlayer) {
        const px = myPlayer.renderX;
        const py = myPlayer.renderY;
        const radarDistThreshold = 180; // Detectar drones más lejanos

        for (const e of this.enemies) {
            const dx = e.x - px;
            const dy = e.y - py;
            const dist = Math.hypot(dx, dy);

            if (dist > radarDistThreshold) {
                const angle = Math.atan2(dy, dx);
                const indicatorRadius = this.arena.playerRadius + 26;
                const ix = px + Math.cos(angle) * indicatorRadius;
                const iy = py + Math.sin(angle) * indicatorRadius;

                ctx.save();
                ctx.translate(ix, iy);
                ctx.rotate(angle);

                // Flecha / galón direccional de peligro neón
                ctx.beginPath();
                ctx.moveTo(6, 0);
                ctx.lineTo(-4, -4);
                ctx.lineTo(-1, 0);
                ctx.lineTo(-4, 4);
                ctx.closePath();

                ctx.fillStyle = e.type === 'fast' ? '#ff0055' : '#d946ef';
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 8;
                ctx.fill();

                ctx.restore();
            }
        }
    }

    /* -------------------------------------------------------------
       8.5 PORTALES DE TELETRANSPORTE CUÁNTICOS (WORMHOLES)
    ---------------------------------------------------------------- */
    drawPortals(ctx) {
        if (!this.portals || !this.portals.a || !this.portals.b) return;

        this.drawSinglePortal(ctx, this.portals.a, 'PORTAL α', '#00f0ff', '#38bdf8', '#0284c7');
        this.drawSinglePortal(ctx, this.portals.b, 'PORTAL β', '#f43f5e', '#fb7185', '#be123c');
    }

    drawSinglePortal(ctx, portal, label, primaryColor, secondaryColor, deepColor) {
        const x = portal.x;
        const y = portal.y;
        const r = portal.radius || 28;
        const t = this.gameTime;

        ctx.save();
        ctx.translate(x, y);

        // 1. Campo gravitatorio exterior pulsante
        const pulse = Math.sin(t * 5 + (portal.x * 0.05)) * 3;
        ctx.beginPath();
        ctx.arc(0, 0, r + 12 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = primaryColor;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;

        // 2. Disco de acreción giratorio con arcos de plasma
        ctx.save();
        ctx.rotate(t * 1.8);
        ctx.beginPath();
        ctx.arc(0, 0, r + 5, 0, Math.PI * 1.2);
        ctx.strokeStyle = secondaryColor;
        ctx.lineWidth = 3;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 14;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r + 5, Math.PI * 1.4, Math.PI * 1.9);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // 3. Vórtice interior contrarrotante
        ctx.save();
        ctx.rotate(-t * 2.6);
        ctx.beginPath();
        ctx.arc(0, 0, r - 3, 0, Math.PI * 1.4);
        ctx.strokeStyle = deepColor;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.restore();

        // 4. Horizonte de sucesos: Núcleo ultra-oscuro con resplandor perimetral
        const coreGrad = ctx.createRadialGradient(0, 0, 3, 0, 0, r);
        coreGrad.addColorStop(0, '#030712'); // Negro abisal
        coreGrad.addColorStop(0.65, '#090d16');
        coreGrad.addColorStop(0.9, deepColor);
        coreGrad.addColorStop(1, primaryColor);

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 20;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 5. Destellos de singularidad central
        ctx.beginPath();
        ctx.arc(0, 0, 4 + Math.sin(t * 8) * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 10;
        ctx.fill();

        // 6. Placa táctica superior de identificación del portal
        const badgeY = -r - 14 + Math.sin(t * 3.5) * 2;
        ctx.font = '800 10px "JetBrains Mono", monospace';
        const textW = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(5, 8, 17, 0.92)';
        this.drawRoundedRect(ctx, -textW / 2 - 6, badgeY - 7, textW + 12, 14, 7);
        ctx.fill();

        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.2;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 6;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, badgeY);

        ctx.restore();
    }

    /* -------------------------------------------------------------
       8.6 RAYOS DE NANORRESCATE (REVIVAL BEAMS)
    ---------------------------------------------------------------- */
    drawReviveBeams(ctx) {
        // Enlazar supervivientes con compañeros caídos en proceso de reanimación
        for (const deadP of this.players.values()) {
            if (!deadP.isDead || !deadP.revivingBy) continue;

            const rescuer = this.players.get(deadP.revivingBy);
            if (!rescuer || !rescuer.isAlive || rescuer.isDead) continue;

            const x1 = rescuer.renderX;
            const y1 = rescuer.renderY;
            const x2 = deadP.renderX;
            const y2 = deadP.renderY;

            ctx.save();

            // 1. Halo difuso del rayo
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.lineWidth = 8;
            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 16;
            ctx.stroke();

            // 2. Arco eléctrico de nanorrescate con jitter
            const segments = 6;
            const dx = (x2 - x1) / segments;
            const dy = (y2 - y1) / segments;
            const perpX = -(y2 - y1) / Math.hypot(x2 - x1, y2 - y1);
            const perpY = (x2 - x1) / Math.hypot(x2 - x1, y2 - y1);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            for (let i = 1; i < segments; i++) {
                const jitter = (Math.sin(this.gameTime * 20 + i * 2) * 5) + ((Math.random() - 0.5) * 4);
                const segX = x1 + dx * i + perpX * jitter;
                const segY = y1 + dy * i + perpY * jitter;
                ctx.lineTo(segX, segY);
            }
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = '#a7f3d0';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // 3. Filamento central de plasma blanco puro
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.restore();
        }
    }

    /* -------------------------------------------------------------
       8.7 LÁPIDA CIBERNÉTICA EN STASIS & MEDIDOR CIRCULAR DE RESCATE
    ---------------------------------------------------------------- */
    drawTombstone(ctx, p, isLocal) {
        const radius = this.arena.playerRadius || 18;
        const px = Number(p.renderX) || 0;
        const py = Number(p.renderY) || 0;
        const t = this.gameTime;
        const isBeingRevived = (p.reviveTicks > 0) || (p.reviveProgress > 0);
        const progress = Math.max(0, Math.min(1, p.reviveProgress || 0));

        ctx.save();
        ctx.translate(px, py);

        // 1. Ondas de socorro de baliza de emergencia (SOS distress waves)
        const distressPulse = (t * 2.5) % 1;
        const waveRadius = radius + (distressPulse * 28);
        ctx.beginPath();
        ctx.arc(0, 0, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isBeingRevived ? 'rgba(16, 185, 129, ' + (1 - distressPulse) + ')' : 'rgba(239, 68, 68, ' + (1 - distressPulse) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 2. Plataforma octagonal de soporte vital en stasis
        ctx.beginPath();
        const sides = 8;
        for (let i = 0; i < sides; i++) {
            const angle = (i * Math.PI * 2) / sides;
            const sx = Math.cos(angle) * (radius + 4);
            const sy = Math.sin(angle) * (radius + 4);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.closePath();

        const baseGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, radius + 4);
        if (isBeingRevived) {
            baseGrad.addColorStop(0, '#064e3b');
            baseGrad.addColorStop(0.7, '#042f2e');
            baseGrad.addColorStop(1, '#021a18');
        } else {
            baseGrad.addColorStop(0, '#7f1d1d');
            baseGrad.addColorStop(0.7, '#450a0a');
            baseGrad.addColorStop(1, '#180404');
        }
        ctx.fillStyle = baseGrad;
        ctx.shadowColor = isBeingRevived ? '#10b981' : '#ef4444';
        ctx.shadowBlur = 16;
        ctx.fill();

        ctx.strokeStyle = isBeingRevived ? '#34d399' : '#f87171';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Monolito / Cruz holográfica de emergencia médica
        const crossColor = isBeingRevived ? '#34d399' : '#ef4444';
        const crossGlow = isBeingRevived ? '#10b981' : '#dc2626';
        const armLength = radius * 0.65;
        const armWidth = 4.5;

        ctx.save();
        ctx.shadowColor = crossGlow;
        ctx.shadowBlur = 12;
        ctx.fillStyle = crossColor;

        // Barra vertical de la cruz
        this.drawRoundedRect(ctx, -armWidth / 2, -armLength, armWidth, armLength * 2, 2);
        ctx.fill();
        // Barra horizontal de la cruz
        this.drawRoundedRect(ctx, -armLength, -armWidth / 2, armLength * 2, armWidth, 2);
        ctx.fill();

        // Núcleo blanco incandescente de la cruz
        ctx.fillStyle = '#ffffff';
        this.drawRoundedRect(ctx, -armWidth / 2 + 1, -armWidth / 2 + 1, armWidth - 2, armWidth - 2, 1);
        ctx.fill();
        ctx.restore();

        // 4. Medidor circular de reanimación (Progreso continuo de 0 a 100%)
        const ringRadius = radius + 15;
        if (isBeingRevived) {
            // Anillo base de fondo
            ctx.beginPath();
            ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
            ctx.lineWidth = 4;
            ctx.stroke();

            // Arco activo de progreso de rescate
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + (progress * Math.PI * 2);

            ctx.beginPath();
            ctx.arc(0, 0, ringRadius, startAngle, endAngle);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 4.5;
            ctx.lineCap = 'round';
            ctx.shadowColor = '#34d399';
            ctx.shadowBlur = 14;
            ctx.stroke();
            ctx.lineCap = 'butt';

            // Marcador de punto activo al frente del progreso
            const headX = Math.cos(endAngle) * ringRadius;
            const headY = Math.sin(endAngle) * ringRadius;
            ctx.beginPath();
            ctx.arc(headX, headY, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 8;
            ctx.fill();
        } else {
            // Círculo perimetral intermitente pidiendo auxilio (<40px)
            ctx.beginPath();
            ctx.arc(0, 0, 40, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 5. Placas y etiquetas de estado
        const callsign = isLocal ? 'TÚ' : p.id;
        const tagY = -ringRadius - 14;

        ctx.font = '800 10px "JetBrains Mono", monospace';
        const labelText = isBeingRevived
            ? `REANIMANDO: ${Math.round(progress * 100)}%`
            : `[${callsign} DERRIBADO]`;
        const textW = ctx.measureText(labelText).width;

        ctx.fillStyle = isBeingRevived ? 'rgba(4, 47, 46, 0.95)' : 'rgba(69, 10, 10, 0.95)';
        this.drawRoundedRect(ctx, -textW / 2 - 6, tagY - 7, textW + 12, 14, 7);
        ctx.fill();

        ctx.strokeStyle = isBeingRevived ? '#34d399' : '#f87171';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = isBeingRevived ? '#a7f3d0' : '#fca5a5';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 0, tagY);

        // Subtexto táctico inferior
        const hintY = ringRadius + 14;
        ctx.font = '700 8.5px Inter, sans-serif';
        const hintText = isBeingRevived ? '¡MANTÉN POSICIÓN!' : 'ZONA RESCATE: <40px (2s)';
        const hintW = ctx.measureText(hintText).width;

        ctx.fillStyle = 'rgba(10, 15, 28, 0.85)';
        this.drawRoundedRect(ctx, -hintW / 2 - 5, hintY - 6, hintW + 10, 12, 6);
        ctx.fill();

        ctx.fillStyle = isBeingRevived ? '#34d399' : '#fbbf24';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hintText, 0, hintY);

        ctx.restore();
    }

    /* -------------------------------------------------------------
       9. NAVES DE JUGADORES (VECTORIALES PROCEDURALES DE ALTA GAMA)
    ---------------------------------------------------------------- */
    drawPlayer(ctx, p, isLocal) {
        if (p.isDead) {
            this.drawTombstone(ctx, p, isLocal);
            return;
        }

        const isPve = this.gameMode === 'PVE';
        const isHunter = Boolean(p.isIt) && !isPve;
        const radius = this.arena.playerRadius || 18;

        // Paleta cibernética
        let mainColor = isHunter ? '#ff0055' : '#00f0ff';
        if (isPve) mainColor = '#10b981';

        const px = Number(p.renderX) || 0;
        const py = Number(p.renderY) || 0;

        ctx.save();
        ctx.translate(px, py);

        if (p.isAlive) {
            // Escudo protector de inmunidad temporal
            if (p.isInvulnerable) {
                const shieldPulse = Math.sin(this.gameTime * 18) * 3;
                ctx.beginPath();
                ctx.arc(0, 0, radius + 11 + shieldPulse, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
                ctx.lineWidth = 2.2;
                ctx.shadowColor = '#38bdf8';
                ctx.shadowBlur = 15;
                ctx.setLineDash([8, 4]);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
                ctx.fill();
            }

            // Efecto visual de Dash activo: Cono de choque supersónico
            const now = performance.now();
            const isDashing = p.isDashing || (p.dashUntil && p.dashUntil > now) || (isLocal && now < this.myDashActiveUntil);
            if (isDashing) {
                ctx.save();
                ctx.rotate(p.angle || 0);
                ctx.beginPath();
                ctx.moveTo(radius * 1.6, 0);
                ctx.lineTo(-radius * 1.2, -radius * 1.4);
                ctx.lineTo(-radius * 0.8, 0);
                ctx.lineTo(-radius * 1.2, radius * 1.4);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
                ctx.lineWidth = 2.5;
                ctx.shadowColor = '#00f0ff';
                ctx.shadowBlur = 18;
                ctx.stroke();

                ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
                ctx.fill();
                ctx.restore();
            }

            ctx.save();
            ctx.rotate(p.angle || 0);

            const isMoving = Math.hypot(p.vx, p.vy) > 0.05;

            // 1. Pluma de fuego de propulsión de plasma (cuando la nave avanza)
            if (isMoving) {
                const flicker = 1 + (Math.sin(this.gameTime * 35) * 0.25);
                const flameLength = 16 * flicker;

                ctx.beginPath();
                // Boquilla izquierda
                ctx.moveTo(-radius * 0.6, -radius * 0.45);
                ctx.lineTo(-radius * 0.6 - flameLength, 0);
                ctx.lineTo(-radius * 0.6, radius * 0.45);
                ctx.closePath();

                const flameGrad = ctx.createLinearGradient(-radius * 0.6, 0, -radius * 0.6 - flameLength, 0);
                flameGrad.addColorStop(0, '#ffffff');
                flameGrad.addColorStop(0.4, mainColor);
                flameGrad.addColorStop(1, 'transparent');

                ctx.fillStyle = flameGrad;
                ctx.shadowColor = mainColor;
                ctx.shadowBlur = 12;
                ctx.fill();
            }

            // 2. Chasis del Caza Interceptor Aerodinámico (Geometría Delta Wing)
            const length = radius * 1.35;
            const wingSpan = radius * 1.15;

            ctx.beginPath();
            ctx.moveTo(length, 0); // Vértice frontal de proa
            ctx.lineTo(-length * 0.55, -wingSpan); // Ala izquierda
            ctx.lineTo(-length * 0.3, -wingSpan * 0.4); // Ranura aerodinámica
            ctx.lineTo(-length * 0.6, -wingSpan * 0.25); // Escape motor izquierdo
            ctx.lineTo(-length * 0.4, 0); // Mamparo trasero central
            ctx.lineTo(-length * 0.6, wingSpan * 0.25); // Escape motor derecho
            ctx.lineTo(-length * 0.3, wingSpan * 0.4); // Ranura aerodinámica
            ctx.lineTo(-length * 0.55, wingSpan); // Ala derecha
            ctx.closePath();

            // Relleno de aleación de titanio con reflejo
            const hullGrad = ctx.createLinearGradient(length, 0, -length * 0.6, 0);
            if (isPve) {
                hullGrad.addColorStop(0, '#34d399');
                hullGrad.addColorStop(0.4, '#059669');
                hullGrad.addColorStop(1, '#064e3b');
            } else if (isHunter) {
                hullGrad.addColorStop(0, '#fca5a5');
                hullGrad.addColorStop(0.4, '#dc2626');
                hullGrad.addColorStop(1, '#7f1d1d');
            } else {
                hullGrad.addColorStop(0, '#7dd3fc');
                hullGrad.addColorStop(0.4, '#0284c7');
                hullGrad.addColorStop(1, '#082f49');
            }

            ctx.fillStyle = hullGrad;
            ctx.shadowColor = mainColor;
            ctx.shadowBlur = isLocal ? 16 : 10;
            ctx.fill();

            // Perfilado exterior neón ultra-nítido
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.stroke();

            // 3. Cúpula de la cabina (Canopy) con reflejo de cristal
            ctx.beginPath();
            ctx.ellipse(length * 0.1, 0, length * 0.45, wingSpan * 0.24, 0, 0, Math.PI * 2);
            const canopyGrad = ctx.createLinearGradient(length * 0.4, -wingSpan * 0.2, -length * 0.2, wingSpan * 0.2);
            canopyGrad.addColorStop(0, '#ffffff');
            canopyGrad.addColorStop(0.5, mainColor);
            canopyGrad.addColorStop(1, '#051020');
            ctx.fillStyle = canopyGrad;
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // 4. Luces de posición en los extremos de las alas
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(-length * 0.55, -wingSpan, 2.2, 0, Math.PI * 2);
            ctx.arc(-length * 0.55, wingSpan, 2.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();

            // 5. Medidor táctico de escudos / vidas (Segmentos limpios, sin emojis)
            if (isPve) {
                const totalLives = 3;
                const currentLives = Math.max(0, p.lives !== undefined ? p.lives : 3);
                const pipW = 10;
                const pipH = 3.5;
                const pipGap = 3;
                const totalW = totalLives * pipW + (totalLives - 1) * pipGap;
                const startX = -totalW / 2;
                const barY = -radius - 14;

                for (let i = 0; i < totalLives; i++) {
                    const pipX = startX + i * (pipW + pipGap);
                    const isFilled = i < currentLives;

                    ctx.fillStyle = isFilled ? '#34d399' : 'rgba(239, 68, 68, 0.3)';
                    this.drawRoundedRect(ctx, pipX, barY, pipW, pipH, 1.5);
                    ctx.fill();

                    if (isFilled) {
                        ctx.strokeStyle = '#a7f3d0';
                        ctx.lineWidth = 0.8;
                        ctx.stroke();
                    }
                }
            }

            // 6. Placa de identificación del jugador (Callsign)
            const callsign = isLocal ? 'TÚ' : p.id;
            let badgeText = isLocal ? `[TÚ]` : `[${callsign}]`;
            if (p.isAfk && !isLocal) badgeText += ' ZZZ';

            ctx.font = '700 10px "JetBrains Mono", monospace';
            const badgeW = ctx.measureText(badgeText).width;
            const badgeY = isPve ? -radius - 24 : -radius - 14;

            ctx.fillStyle = isPve ? 'rgba(4, 47, 46, 0.88)' : (isHunter ? 'rgba(69, 10, 10, 0.88)' : 'rgba(8, 47, 73, 0.88)');
            this.drawRoundedRect(ctx, -badgeW / 2 - 5, badgeY - 7, badgeW + 10, 14, 7);
            ctx.fill();

            ctx.strokeStyle = isLocal ? '#ffffff' : mainColor;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = isLocal ? '#ffffff' : mainColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, 0, badgeY);

        } else {
            // NAVE DESTRUIDA: Restos de chasis humeantes
            ctx.beginPath();
            ctx.arc(0, 0, radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();

            // Cruz de destrucción
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(-radius * 0.6, -radius * 0.6);
            ctx.lineTo(radius * 0.6, radius * 0.6);
            ctx.moveTo(radius * 0.6, -radius * 0.6);
            ctx.lineTo(-radius * 0.6, radius * 0.6);
            ctx.stroke();

            const ripText = isLocal ? 'DESTRUIDO' : `${p.id} CAÍDO`;
            ctx.font = '700 9.5px "JetBrains Mono", monospace';
            const ripW = ctx.measureText(ripText).width;
            const ripY = -radius - 12;

            ctx.fillStyle = 'rgba(69, 10, 10, 0.9)';
            this.drawRoundedRect(ctx, -ripW / 2 - 6, ripY - 7, ripW + 12, 14, 7);
            ctx.fill();

            ctx.fillStyle = '#fca5a5';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ripText, 0, ripY);
        }

        ctx.restore();
    }

    /* -------------------------------------------------------------
       10. RASTRO NEÓN AGILIZADO (1.8s EN PVE)
    ---------------------------------------------------------------- */
    drawPlayerTrail(ctx, p) {
        if (!p.trail || p.trail.length < 2) return;

        const isPve = this.gameMode === 'PVE';
        const isHunter = Boolean(p.isIt) && !isPve;
        const trail = p.trail;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) {
            const prev = trail[i - 1];
            const curr = trail[i];
            const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
            // Salto cuántico o teletransporte: romper la línea para no estirar el rastro entre portales
            if (dist > 65) {
                ctx.moveTo(curr.x, curr.y);
            } else {
                ctx.lineTo(curr.x, curr.y);
            }
        }

        if (p.isAlive) {
            const last = trail[trail.length - 1];
            const dist = Math.hypot(p.renderX - last.x, p.renderY - last.y);
            if (dist > 65) {
                ctx.moveTo(p.renderX, p.renderY);
            } else {
                ctx.lineTo(p.renderX, p.renderY);
            }
        }

        if (isPve) {
            // Rastro letal de plasma esmeralda (destruye drones en contacto)
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
            ctx.lineWidth = 14;
            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 18;
            ctx.stroke();

            ctx.strokeStyle = '#a7f3d0';
            ctx.lineWidth = 4;
            ctx.shadowBlur = 6;
            ctx.stroke();
        } else {
            // Estela Tron competitiva
            const color = isHunter ? '#ff0055' : '#00f0ff';
            const innerColor = isHunter ? '#fef08a' : '#ffffff';

            ctx.strokeStyle = color;
            ctx.lineWidth = 6;
            ctx.shadowColor = color;
            ctx.shadowBlur = isHunter ? 16 : 12;
            ctx.stroke();

            ctx.lineWidth = 2.2;
            ctx.strokeStyle = innerColor;
            ctx.shadowBlur = 0;
            ctx.stroke();
        }

        ctx.restore();
    }

    /* -------------------------------------------------------------
       11. PARTICULAS Y TEXTOS FLOTANTES
    ---------------------------------------------------------------- */
    drawParticles(ctx) {
        if (!this.particles || this.particles.length === 0) return;

        for (const p of this.particles) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

            if (p.type === 'ring') {
                const r = Math.max(0.1, Number(p.radius) || 0.1);
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 2.5;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                ctx.stroke();
            } else {
                const s = Math.max(0.1, Number(p.size) || 0.1);
                ctx.beginPath();
                ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 6;
                ctx.fill();
            }

            ctx.restore();
        }
    }

    drawFloatingTexts(ctx) {
        if (!this.floatingTexts || this.floatingTexts.length === 0) return;

        for (const ft of this.floatingTexts) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, ft.alpha));
            ctx.font = '800 14px "JetBrains Mono", monospace';
            ctx.fillStyle = ft.color;
            ctx.shadowColor = ft.color;
            ctx.shadowBlur = 8;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ft.text, ft.x, ft.y);
            ctx.restore();
        }
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.arcTo(x + width, y, x + width, y + radius, radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            ctx.lineTo(x + radius, y + height);
            ctx.arcTo(x, y, x + radius, y + height - radius, radius);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.closePath();
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new MultiplayerClient();
});
