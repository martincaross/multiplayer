/**
 * 2D Multiplayer Game Client - Pilla-Pilla
 * - Interfaz limpia y optimizada para iPhone sin solapamientos.
 * - Pantalla y campo de juego ampliados (~50% más grande y visible).
 * - Cámara suave que sigue al jugador sin salirse de los límites de la arena.
 */

class MultiplayerClient {
    constructor() {
        // Elementos DOM
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;

        // UI HUD
        this.statusPill = document.getElementById('status-pill');
        this.statusText = document.getElementById('status-text');
        this.rttVal = document.getElementById('rtt-val');
        this.fpsVal = document.getElementById('fps-val');
        this.posVal = document.getElementById('pos-val');
        this.playersVal = document.getElementById('players-val');
        this.resetZoomBtn = document.getElementById('reset-zoom-btn');
        this.zoomWarningBanner = document.getElementById('zoom-warning-banner');

        // Banner de rol Pilla-Pilla
        this.gameRoleBanner = document.getElementById('game-role-banner');
        this.roleIcon = document.getElementById('role-icon');
        this.roleText = document.getElementById('role-text');

        // Joystick DOM
        this.joystickZone = document.getElementById('joystick-zone');
        this.joystickBase = document.getElementById('joystick-base');
        this.joystickKnob = document.getElementById('joystick-knob');

        // Configuración de la Arena (800x600 autoritativa en servidor)
        this.arena = {
            width: 800,
            height: 600,
            playerRadius: 22,
            speed: 300
        };

        // Identidad del Jugador Local
        this.myId = null;
        this.myColor = '#38bdf8';
        this.isIt = false;

        // Cámara del juego (posicionada inicialmente en el centro)
        this.camera = {
            x: this.arena.width / 2,
            y: this.arena.height / 2
        };

        // Registro de jugadores conectados: Map<id, PlayerData>
        this.players = new Map();

        // Inputs Locales
        this.currentInput = { vx: 0, vy: 0 };
        this.lastSentInput = { vx: 0, vy: 0 };
        this.keys = {};
        this.joystick = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            maxRadius: 42,
            vx: 0,
            vy: 0
        };

        // Red
        this.ws = null;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.inputSyncInterval = 50; // ~20 Hz
        this.lastInputSync = 0;

        // Métricas de Rendimiento
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.radarAngle = 0;
        this.pulsePhase = 0;

        // Inicializar componentes
        this.initViewport();
        this.initZoomManagement();
        this.initInputs();
        this.initNetwork();
        this.startGameLoop();
    }

    /* -------------------------------------------------------------
       1. VIEWPORT & GESTIÓN DE ZOOM
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

            // Restablecer zoom en Safari iOS de forma instantánea sin recargar
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
        // Teclado
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            this.calcInputVector();
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.calcInputVector();
        });

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
                try {
                    this.joystickZone.releasePointerCapture(e.pointerId);
                } catch (_) {}
                this.resetJoystick();
            };

            this.joystickZone.addEventListener('pointerdown', onPointerDown);
            this.joystickZone.addEventListener('pointermove', onPointerMove);
            this.joystickZone.addEventListener('pointerup', onPointerUp);
            this.joystickZone.addEventListener('pointercancel', onPointerUp);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        }
    }

    handlePointerMove(e) {
        const dx = e.clientX - this.joystick.startX;
        const dy = e.clientY - this.joystick.startY;
        const dist = Math.hypot(dx, dy);
        const maxR = this.joystick.maxRadius;

        let knobX = dx;
        let knobY = dy;

        if (dist > maxR) {
            knobX = (dx / dist) * maxR;
            knobY = (dy / dist) * maxR;
        }

        this.joystickKnob.style.transform = `translate3d(${knobX}px, ${knobY}px, 0)`;

        if (dist < 6) {
            this.joystick.vx = 0;
            this.joystick.vy = 0;
        } else {
            const power = Math.min(dist / maxR, 1);
            this.joystick.vx = (dx / dist) * power;
            this.joystick.vy = (dy / dist) * power;
        }

        this.calcInputVector();
    }

    resetJoystick() {
        this.joystick.active = false;
        this.joystick.pointerId = null;
        this.joystick.vx = 0;
        this.joystick.vy = 0;
        this.joystickBase.classList.remove('active');
        this.joystickKnob.style.transform = 'translate3d(0, 0, 0)';
        this.calcInputVector();
    }

    calcInputVector() {
        if (this.joystick.active && (this.joystick.vx !== 0 || this.joystick.vy !== 0)) {
            this.currentInput.vx = Number(this.joystick.vx.toFixed(3));
            this.currentInput.vy = Number(this.joystick.vy.toFixed(3));
            this.checkSendInput(true);
            return;
        }

        let kx = 0;
        let ky = 0;

        if (this.keys['KeyW'] || this.keys['ArrowUp']) ky -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) ky += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) kx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) kx += 1;

        if (kx !== 0 && ky !== 0) {
            kx *= Math.SQRT1_2;
            ky *= Math.SQRT1_2;
        }

        this.currentInput.vx = Number(kx.toFixed(3));
        this.currentInput.vy = Number(ky.toFixed(3));
        this.checkSendInput(true);
    }

    /* -------------------------------------------------------------
       3. CONEXIÓN WEBSOCKET & RECEPCIÓN DEL ESTADO AUTORITATIVO
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
                        this.isIt = Boolean(data.isIt);
                        if (data.arena) this.arena = data.arena;
                        if (data.color) this.myColor = data.color;
                    }

                    if (data.type === 'state' && Array.isArray(data.players)) {
                        this.onServerState(data.players);
                    }

                    if (data.type === 'pong') {
                        const rtt = Date.now() - data.clientTime;
                        this.rttVal.textContent = `${rtt} ms`;
                        this.rttVal.style.color = rtt < 60 ? '#10b981' : (rtt < 130 ? '#f59e0b' : '#ef4444');
                    }
                } catch (e) {
                    console.error("Error procesando mensaje:", e);
                }
            };

            this.ws.onclose = () => {
                this.setConnectionState(false);
                this.stopPingRoutine();
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this.initNetwork(), 3000);
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
        let amIHunter = false;

        for (const sp of serverPlayers) {
            activeIds.add(sp.id);

            const safeX = typeof sp.x === 'number' && !isNaN(sp.x) ? sp.x : 400;
            const safeY = typeof sp.y === 'number' && !isNaN(sp.y) ? sp.y : 300;
            const isIt = Boolean(sp.isIt);

            if (sp.id === this.myId) {
                amIHunter = isIt;
                this.isIt = isIt;
            }

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
                    angle: 0,
                    color: sp.color || '#38bdf8',
                    isIt: isIt
                };
                this.players.set(sp.id, p);
            } else {
                p.targetX = safeX;
                p.targetY = safeY;
                p.isIt = isIt;
                if (sp.id === this.myId) {
                    p.vx = this.currentInput.vx;
                    p.vy = this.currentInput.vy;
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

        this.updateRoleBanner(amIHunter);
    }

    updateRoleBanner(amIHunter) {
        if (!this.gameRoleBanner) return;

        if (amIHunter) {
            this.gameRoleBanner.className = 'game-role-banner hunter';
            if (this.roleIcon) this.roleIcon.textContent = '🔥';
            if (this.roleText) this.roleText.textContent = '¡LA LLEVAS TÚ! ¡ATRAPA!';
        } else {
            this.gameRoleBanner.className = 'game-role-banner runner';
            if (this.roleIcon) this.roleIcon.textContent = '🏃';
            if (this.roleText) this.roleText.textContent = '¡ESCAPA DEL CAZADOR!';
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

    /* -------------------------------------------------------------
       4. GAME LOOP: MOVIMIENTO FLUIDO A 60 FPS
    ---------------------------------------------------------------- */
    startGameLoop() {
        const loop = (timestamp) => {
            try {
                const dt = Math.min((timestamp - this.lastFrameTime) / 1000, 0.1);
                this.lastFrameTime = timestamp;

                this.checkSendInput(false);
                this.updateInterpolation(dt);
                this.render();
                this.calculateFps(timestamp);
            } catch (err) {
                console.error("Game loop error:", err);
            }
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    updateInterpolation(dt) {
        const speed = this.arena.speed || 300;
        this.pulsePhase += dt * 4;

        for (const p of this.players.values()) {
            if (isNaN(p.renderX)) p.renderX = p.targetX || 400;
            if (isNaN(p.renderY)) p.renderY = p.targetY || 300;

            // Extrapolación continua a 60 FPS
            p.renderX += p.vx * speed * dt;
            p.renderY += p.vy * speed * dt;

            // Reconciliación suave con el servidor
            const corr = Math.min(1, 8 * dt);
            p.renderX += (p.targetX - p.renderX) * corr;
            p.renderY += (p.targetY - p.renderY) * corr;

            // Mantener dentro de los bordes
            const minX = this.arena.playerRadius;
            const maxX = this.arena.width - this.arena.playerRadius;
            const minY = this.arena.playerRadius;
            const maxY = this.arena.height - this.arena.playerRadius;

            p.renderX = Math.max(minX, Math.min(maxX, p.renderX));
            p.renderY = Math.max(minY, Math.min(maxY, p.renderY));

            // Suavizado angular
            const velMag = Math.hypot(p.vx, p.vy);
            if (velMag > 0.08) {
                const targetAngle = Math.atan2(p.vy, p.vx);
                let diff = targetAngle - p.angle;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                p.angle += diff * Math.min(1, 14 * dt);
            }
        }

        const localPlayer = this.players.get(this.myId);
        if (localPlayer && !isNaN(localPlayer.renderX) && !isNaN(localPlayer.renderY)) {
            if (this.posVal) {
                this.posVal.textContent = `${Math.round(localPlayer.renderX)}, ${Math.round(localPlayer.renderY)}`;
            }
        }
    }

    calculateFps(now) {
        this.frameCount++;
        if (now - this.lastFpsUpdate >= 1000) {
            const currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
            this.fpsVal.textContent = `${currentFps} FPS`;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    /* -------------------------------------------------------------
       5. RENDERIZADO: PANTALLA MÁS GRANDE Y ENCUADRE ÓPTIMO
    ---------------------------------------------------------------- */
    render() {
        const ctx = this.ctx;
        const w = this.viewportWidth;
        const h = this.viewportHeight;

        ctx.fillStyle = '#080c15';
        ctx.fillRect(0, 0, w, h);

        const isMobile = w < 768;

        // =========================================================
        // PANTALLA MÁS GRANDE: Zoom dinámico e inmersivo en iPhone
        // =========================================================
        let zoom;
        if (isMobile) {
            // En móvil: pantalla ampliada para llenar el viewport del teléfono
            // Los personajes se ven grandes (~52px) y la acción es emocionante y nítida
            const portraitFit = Math.max(w / 340, h / 680);
            zoom = Math.min(Math.max(portraitFit, 1.22), 1.5);
        } else {
            // En PC / Monitor de escritorio: encuadre espacioso
            const baseFit = Math.min((w - 40) / this.arena.width, (h - 100) / this.arena.height);
            zoom = Math.min(Math.max(baseFit * 1.1, 0.9), 1.4);
        }

        // Centro visual del canvas completo
        const viewCenterX = w / 2;
        const viewCenterY = h / 2;

        // Campo de visión visible en coordenadas del mundo
        const halfVisibleW = (w / 2) / zoom;
        const halfVisibleH = (h / 2) / zoom;

        // Seguimiento suave del jugador local
        let targetCamX = this.arena.width / 2;
        let targetCamY = this.arena.height / 2;

        const localP = this.players.get(this.myId);
        if (localP && !isNaN(localP.renderX) && !isNaN(localP.renderY)) {
            targetCamX = localP.renderX;
            targetCamY = localP.renderY;
        }

        // Delimitar la cámara para que nunca muestre espacio negro vacío fuera de la arena
        if (this.arena.width > halfVisibleW * 2) {
            targetCamX = Math.max(halfVisibleW, Math.min(this.arena.width - halfVisibleW, targetCamX));
        } else {
            targetCamX = this.arena.width / 2;
        }

        if (this.arena.height > halfVisibleH * 2) {
            targetCamY = Math.max(halfVisibleH, Math.min(this.arena.height - halfVisibleH, targetCamY));
        } else {
            targetCamY = this.arena.height / 2;
        }

        // Lerp fluido de cámara a 60 FPS
        this.camera.x += (targetCamX - this.camera.x) * 0.16;
        this.camera.y += (targetCamY - this.camera.y) * 0.16;

        ctx.save();
        ctx.translate(viewCenterX, viewCenterY);
        ctx.scale(zoom, zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        // 1. Dibujar Arena de 800x600
        this.drawArena(ctx);

        // 2. Dibujar Jugadores
        for (const p of this.players.values()) {
            const isLocal = p.id === this.myId;
            this.drawPlayer(ctx, p, isLocal);
        }

        ctx.restore();

        // 3. Dibujar Minimapa
        this.drawMinimap();
    }

    drawArena(ctx) {
        const arenaW = this.arena.width;
        const arenaH = this.arena.height;

        ctx.fillStyle = '#0c1324';
        ctx.fillRect(0, 0, arenaW, arenaH);

        // Cuadrícula interior
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
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

        // Círculo central deportivo
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 2;
        ctx.arc(arenaW / 2, arenaH / 2, 70, 0, Math.PI * 2);
        ctx.stroke();

        // Borde exterior resplandeciente de 800x600
        ctx.save();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = 'rgba(0, 240, 255, 0.5)';
        ctx.shadowBlur = 14;
        ctx.strokeRect(0, 0, arenaW, arenaH);
        ctx.restore();
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
            ctx.arcTo(x, y + height, x, y + height - radius, radius);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.closePath();
        }
    }

    drawPlayer(ctx, p, isLocal) {
        const radius = this.arena.playerRadius || 22;
        const isHunter = Boolean(p.isIt);
        const primaryColor = isHunter ? '#ef4444' : '#38bdf8';
        const px = Number(p.renderX) || 0;
        const py = Number(p.renderY) || 0;

        ctx.save();
        ctx.translate(px, py);

        // 1. Halo resplandeciente
        const pulse = isHunter ? Math.sin(this.pulsePhase) * 3 : 0;
        ctx.beginPath();
        ctx.arc(0, 0, radius + 4 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = isHunter ? '#f87171' : 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = isHunter ? 3.5 : 2;
        ctx.shadowColor = isHunter ? '#ef4444' : '#0284c7';
        ctx.shadowBlur = isHunter ? 20 : 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 2. Anillo blanco indicador para el avatar local "TÚ"
        if (isLocal) {
            ctx.beginPath();
            ctx.arc(0, 0, radius + 7 + pulse, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 3. Cuerpo del avatar con degradado
        const grad = ctx.createRadialGradient(-4, -4, 3, 0, 0, radius);
        if (isHunter) {
            grad.addColorStop(0, '#fecaca');
            grad.addColorStop(0.35, '#ef4444');
            grad.addColorStop(1, '#7f1d1d');
        } else {
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.35, '#38bdf8');
            grad.addColorStop(1, '#0c4a6e');
        }

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 4. Flecha/Visor de dirección
        ctx.save();
        ctx.rotate(p.angle || 0);
        ctx.beginPath();
        ctx.moveTo(radius + 8, 0);
        ctx.lineTo(radius - 5, -6);
        ctx.lineTo(radius - 2, 0);
        ctx.lineTo(radius - 5, 6);
        ctx.closePath();
        ctx.fillStyle = primaryColor;
        ctx.fill();
        ctx.restore();

        // 5. Núcleo central
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = isHunter ? '#fee2e2' : '#ffffff';
        ctx.fill();

        // 6. Etiqueta superior del jugador
        let labelText = '';
        if (isHunter) {
            labelText = isLocal ? `🔥 ¡LA LLEVAS TÚ! 🔥` : `⚠️ CAZADOR [${p.id}]`;
        } else {
            labelText = isLocal ? `★ TÚ [${p.id}] ★` : `${p.id}`;
        }

        ctx.font = '700 11px Inter, sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        const padX = 8;
        const labelY = -radius - 15 - pulse;

        ctx.fillStyle = isHunter ? 'rgba(239, 68, 68, 0.9)' : 'rgba(15, 23, 42, 0.85)';
        this.drawRoundedRect(ctx, -textWidth / 2 - padX, labelY - 9, textWidth + padX * 2, 18, 9);
        ctx.fill();

        ctx.strokeStyle = isHunter ? '#fca5a5' : (isLocal ? '#ffffff' : primaryColor);
        ctx.lineWidth = isLocal || isHunter ? 1.5 : 1;
        ctx.stroke();

        ctx.fillStyle = isHunter ? '#ffffff' : (isLocal ? '#ffffff' : '#e0f2fe');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 0, labelY);

        ctx.restore();
    }

    drawMinimap() {
        if (!this.minimapCtx) return;
        const mctx = this.minimapCtx;
        const w = this.minimapCanvas.width;
        const h = this.minimapCanvas.height;

        mctx.clearRect(0, 0, w, h);

        mctx.fillStyle = 'rgba(8, 12, 21, 0.9)';
        mctx.fillRect(0, 0, w, h);

        const margin = 4;
        const mw = w - margin * 2;
        const mh = h - margin * 2;

        mctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
        mctx.lineWidth = 1.5;
        mctx.strokeRect(margin, margin, mw, mh);

        this.radarAngle += 0.04;
        mctx.save();
        mctx.translate(w / 2, h / 2);
        mctx.rotate(this.radarAngle);
        const sweep = mctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
        sweep.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
        sweep.addColorStop(1, 'rgba(0, 240, 255, 0)');
        mctx.fillStyle = sweep;
        mctx.beginPath();
        mctx.moveTo(0, 0);
        mctx.arc(0, 0, w / 2, 0, 0.6);
        mctx.closePath();
        mctx.fill();
        mctx.restore();

        for (const p of this.players.values()) {
            const isHunter = Boolean(p.isIt);
            const isLocal = p.id === this.myId;
            const px = margin + ((p.renderX || 0) / this.arena.width) * mw;
            const py = margin + ((p.renderY || 0) / this.arena.height) * mh;

            mctx.beginPath();
            mctx.arc(px, py, isHunter ? 4 : (isLocal ? 3 : 2.2), 0, Math.PI * 2);
            mctx.fillStyle = isHunter ? '#ef4444' : '#38bdf8';
            mctx.shadowColor = mctx.fillStyle;
            mctx.shadowBlur = isHunter ? 8 : (isLocal ? 5 : 2);
            mctx.fill();
            mctx.shadowBlur = 0;
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameClient = new MultiplayerClient();
});
