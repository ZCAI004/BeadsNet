const socket = io();

// Base grid (desktop target)
const BASE_COLS = 64;
const BASE_ROWS = 36;

// Adaptive grid for current screen
let COLS = BASE_COLS;
let ROWS = BASE_ROWS;

// Increase this to make tiles bigger on iPhone
const MIN_CELL_PX = 16;

// Board metrics
let cellSize = 10;
let boardW = 0;
let boardH = 0;
let boardOX = 0;
let boardOY = 0;

// Store painted cells
const grid = new Map(); // "x,y" -> { r, g, b }

// Persistent offscreen layer for grid + painted cells
let boardLayer;

// Palette (32 colors)
const PALETTE = [
  "#000000","#1b1b1b","#4d4d4d","#8e8e93",
  "#c7c7cc","#ffffff","#7f1d1d","#ef4444",
  "#fb7185","#be123c","#7c2d12","#f97316",
  "#fb923c","#f59e0b","#78350f","#facc15",
  "#fde047","#fff7b2","#14532d","#22c55e",
  "#86efac","#064e3b","#065f46","#14b8a6",
  "#5eead4","#0f766e","#1e3a8a","#3b82f6",
  "#93c5fd","#0ea5e9","#312e81","#8b5cf6"
];

let currentHex = PALETTE[7];
let currentColor = hexToRgb(currentHex);

// UI refs
let guiEl, toggleBtnEl, statusEl, paletteEl, motionBtnEl;

// Mobile sensors (tilt only)
let sensorsEnabled = false;

// Cursor in grid coordinates
let cursorGX = Math.floor(BASE_COLS / 2);
let cursorGY = Math.floor(BASE_ROWS / 2);

// DeviceOrientation tilt values
let tiltGamma = 0; // left-right
let tiltBeta = 0;  // front-back

// Movement rate limiting
let lastMoveTime = 0;
const MOVE_INTERVAL_MS = 120;
const TILT_DEADZONE = 10;

// p5 setup/draw
function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("sketch-container");

  noStroke();
  updateBoardMetrics();

  boardLayer = createGraphics(windowWidth, windowHeight);
  boardLayer.noStroke();
  redrawBoardLayer();

  setupUI();
}

function draw() {
  // Clear main canvas each frame so cursor never "burns in"
  clear();

  // Draw the persistent board (grid + painted cells)
  image(boardLayer, 0, 0);

  // Draw cursor on top (not persistent)
  drawCursor();

  if (sensorsEnabled) {
    stepCursorByTilt();
  }
}

// Adaptive grid sizing (keeps tiles readable on iPhone)
function chooseGridForScreen() {
  const aspect = BASE_COLS / BASE_ROWS;

  // How many cells can fit if each cell is at least MIN_CELL_PX?
  const maxCols = Math.max(10, Math.floor(width / MIN_CELL_PX));
  const maxRows = Math.max(10, Math.floor(height / MIN_CELL_PX));

  // Start from base, clamp down by columns
  let cols = Math.min(BASE_COLS, maxCols);
  let rows = Math.floor(cols / aspect);

  // If rows don't fit, clamp by rows instead
  if (rows > maxRows) {
    rows = Math.min(BASE_ROWS, maxRows);
    cols = Math.floor(rows * aspect);
  }

  COLS = Math.max(10, cols);
  ROWS = Math.max(10, rows);
}

function updateBoardMetrics() {
  chooseGridForScreen();

  // Compute uniform (square) cell size
  cellSize = Math.floor(Math.min(width / COLS, height / ROWS));
  cellSize = Math.max(cellSize, MIN_CELL_PX);

  boardW = cellSize * COLS;
  boardH = cellSize * ROWS;

  // Center the board
  boardOX = Math.floor((width - boardW) / 2);
  boardOY = Math.floor((height - boardH) / 2);

  // Keep cursor inside bounds after resize / grid change
  cursorGX = constrain(cursorGX, 0, COLS - 1);
  cursorGY = constrain(cursorGY, 0, ROWS - 1);
}

// Convert a point on canvas to a grid cell
function pointToGrid(px, py) {
  const x = px - boardOX;
  const y = py - boardOY;
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  return { gx, gy };
}

function isValidCell(gx, gy) {
  return gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS;
}

// Interaction: place a bead
function mousePressed() {
  if (isEventOnGUI(mouseX, mouseY)) return;

  if (sensorsEnabled) {
    placeAtCell(cursorGX, cursorGY);
  } else {
    const { gx, gy } = pointToGrid(mouseX, mouseY);
    placeAtCell(gx, gy);
  }
}

function touchStarted() {
  const t = (touches && touches.length > 0) ? touches[0] : null;
  const tx = t ? t.x : touchX;
  const ty = t ? t.y : touchY;

  // If touch is on UI, let UI handle it
  if (isEventOnGUI(tx, ty)) return true;

  if (sensorsEnabled) {
    placeAtCell(cursorGX, cursorGY);
  } else {
    const { gx, gy } = pointToGrid(tx, ty);
    placeAtCell(gx, gy);
  }

  return false; // prevent scroll on canvas interaction
}

function placeAtCell(gx, gy) {
  if (!isValidCell(gx, gy)) return;

  const { r, g, b } = currentColor;

  // Local paint first
  paintCell(gx, gy, r, g, b);

  // Sync to others
  socket.emit("place", { gx, gy, r, g, b });
}

// Rendering: persistent layer (boardLayer)
function paintCell(gx, gy, r, g, b) {
  grid.set(`${gx},${gy}`, { r, g, b });

  // Paint directly onto the persistent layer
  boardLayer.fill(r, g, b);
  boardLayer.rect(
    boardOX + gx * cellSize + 1,
    boardOY + gy * cellSize + 1,
    cellSize - 2,
    cellSize - 2
  );
}

function drawGridLinesTo(layer) {
  layer.push();
  layer.stroke(220);
  layer.strokeWeight(1);

  for (let x = 0; x <= COLS; x++) {
    const px = boardOX + x * cellSize;
    layer.line(px, boardOY, px, boardOY + boardH);
  }
  for (let y = 0; y <= ROWS; y++) {
    const py = boardOY + y * cellSize;
    layer.line(boardOX, py, boardOX + boardW, py);
  }

  layer.pop();
}

function redrawBoardLayer() {
  boardLayer.clear();
  boardLayer.background(240);

  // Draw grid
  drawGridLinesTo(boardLayer);

  // Draw all painted cells
  for (const [key, c] of grid.entries()) {
    const [gx, gy] = key.split(",").map(Number);
    boardLayer.fill(c.r, c.g, c.b);
    boardLayer.rect(
      boardOX + gx * cellSize + 1,
      boardOY + gy * cellSize + 1,
      cellSize - 2,
      cellSize - 2
    );
  }
}

// Cursor is drawn on main canvas only (non-persistent)
function drawCursor() {
  push();
  noFill();
  stroke(0, 140);
  strokeWeight(3);
  rect(
    boardOX + cursorGX * cellSize + 1,
    boardOY + cursorGY * cellSize + 1,
    cellSize - 2,
    cellSize - 2
  );
  pop();
}

// Socket events
socket.on("place", (data) => {
  paintCell(data.gx, data.gy, data.r, data.g, data.b);
});

socket.on("connect", () => console.log("connected:", socket.id));
socket.on("disconnect", () => console.log("disconnected"));

// Resize handling
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  updateBoardMetrics();

  boardLayer = createGraphics(windowWidth, windowHeight);
  boardLayer.noStroke();

  redrawBoardLayer();
}

// UI construction
function setupUI() {
  guiEl = document.getElementById("gui-container");
  if (!guiEl) return;

  guiEl.classList.add("open");
  guiEl.innerHTML = "";

  // Stop GUI touches/clicks from reaching the canvas (iOS-friendly)
  guiEl.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
  guiEl.addEventListener("touchend", (e) => e.stopPropagation(), { passive: true });
  guiEl.addEventListener("mousedown", (e) => e.stopPropagation());
  guiEl.addEventListener("click", (e) => e.stopPropagation());

  // Toggle panel button (uses your CSS .button)
  toggleBtnEl = document.createElement("button");
  toggleBtnEl.className = "button";
  toggleBtnEl.textContent = ">";
  toggleBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    guiEl.classList.toggle("open");
  });
  guiEl.appendChild(toggleBtnEl);

  // Motion permission button (tilt only)
  motionBtnEl = document.createElement("button");
  motionBtnEl.id = "motionBtn";
  motionBtnEl.className = "motion-btn";
  motionBtnEl.textContent = "Enable Tilt";
  motionBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    requestMotionPermission();
  });
  guiEl.appendChild(motionBtnEl);

  // Status row
  statusEl = document.createElement("div");
  statusEl.style.marginTop = "12px";
  statusEl.style.fontFamily = "sans-serif";
  statusEl.style.fontSize = "14px";
  statusEl.style.color = "#222";
  statusEl.style.display = "flex";
  statusEl.style.alignItems = "center";
  statusEl.style.gap = "10px";

  const swatch = document.createElement("div");
  swatch.id = "swatch";
  swatch.style.width = "22px";
  swatch.style.height = "22px";
  swatch.style.borderRadius = "6px";
  swatch.style.border = "1px solid rgba(0,0,0,0.2)";
  swatch.style.background = currentHex;

  const label = document.createElement("div");
  label.id = "colorLabel";
  label.textContent = `Selected: ${currentHex.toUpperCase()}`;

  statusEl.appendChild(swatch);
  statusEl.appendChild(label);
  guiEl.appendChild(statusEl);

  // Palette grid
  paletteEl = document.createElement("div");
  paletteEl.id = "palette";
  paletteEl.style.marginTop = "12px";
  paletteEl.style.display = "grid";
  paletteEl.style.gridTemplateColumns = "repeat(8, 1fr)";
  paletteEl.style.gap = "6px";

  PALETTE.forEach((hex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.height = "28px";
    btn.style.borderRadius = "8px";
    btn.style.border = "1px solid rgba(0,0,0,0.18)";
    btn.style.background = hex;
    btn.style.cursor = "pointer";
    btn.style.padding = "0";

    if (hex === currentHex) {
      btn.style.outline = "2px solid rgba(0,0,0,0.6)";
      btn.style.outlineOffset = "1px";
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      setCurrentColor(hex);

      Array.from(paletteEl.children).forEach((child) => (child.style.outline = "none"));
      btn.style.outline = "2px solid rgba(0,0,0,0.6)";
      btn.style.outlineOffset = "1px";
    });

    paletteEl.appendChild(btn);
  });

  guiEl.appendChild(paletteEl);
}

function setCurrentColor(hex) {
  currentHex = hex;
  currentColor = hexToRgb(hex);

  const swatch = document.getElementById("swatch");
  const label = document.getElementById("colorLabel");
  if (swatch) swatch.style.background = currentHex;
  if (label) label.textContent = `Selected: ${currentHex.toUpperCase()}`;
}

// Treat any tap/click on DOM inside #gui-container as GUI interaction
function isEventOnGUI(px, py) {
  if (!guiEl) return false;

  const c = document.querySelector("canvas");
  if (!c) return false;

  const rect = c.getBoundingClientRect();
  const clientX = rect.left + px;
  const clientY = rect.top + py;

  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return false;

  return guiEl.contains(el);
}

// Motion permission + sensors (tilt only)
async function requestMotionPermission() {
  try {
    // Some iOS versions gate motion permission here
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") {
        motionBtnEl.textContent = "Tilt: Denied";
        return;
      }
    }

    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const res2 = await DeviceOrientationEvent.requestPermission();
      if (res2 !== "granted") {
        motionBtnEl.textContent = "Tilt: Denied";
        return;
      }
    }

    enableTilt();
    motionBtnEl.textContent = "Tilt: ON";
  } catch (e) {
    console.warn(e);
    motionBtnEl.textContent = "Tilt: Error";
  }
}

function enableTilt() {
  if (sensorsEnabled) return;
  sensorsEnabled = true;

  window.addEventListener("deviceorientation", onDeviceOrientation, true);
}

function onDeviceOrientation(e) {
  if (typeof e.gamma === "number") tiltGamma = e.gamma;
  if (typeof e.beta === "number") tiltBeta = e.beta;
}

function stepCursorByTilt() {
  const now = millis();
  if (now - lastMoveTime < MOVE_INTERVAL_MS) return;

  let dx = 0;
  let dy = 0;

  if (tiltGamma > TILT_DEADZONE) dx = 1;
  else if (tiltGamma < -TILT_DEADZONE) dx = -1;

  if (tiltBeta > TILT_DEADZONE) dy = 1;
  else if (tiltBeta < -TILT_DEADZONE) dy = -1;

  if (dx === 0 && dy === 0) return;

  cursorGX = constrain(cursorGX + dx, 0, COLS - 1);
  cursorGY = constrain(cursorGY + dy, 0, ROWS - 1);
  lastMoveTime = now;
}

// Utils
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}
