/*eslint no-undef: 0*/
const socket = io();

// ===== Grid =====
const COLS = 64;
const ROWS = 36;

// Use square-ish cells on mobile to avoid "squeezed" tiles
let cellSize = 10;
let boardW = 0;
let boardH = 0;
let boardOX = 0; // board offset X (centered)
let boardOY = 0; // board offset Y (centered)

const grid = new Map(); // "x,y" -> { r, g, b }

// ===== Cursor overlay (no trails) =====
let overlay;

// ===== Palette (32 colors) =====
const PALETTE = [
  "#000000","#1b1b1b","#4d4d4d","#8e8e93","#c7c7cc","#ffffff",
  "#7f1d1d","#ef4444","#fb7185","#be123c",
  "#7c2d12","#f97316","#fb923c","#f59e0b",
  "#78350f","#facc15","#fde047","#fff7b2",
  "#14532d","#22c55e","#86efac","#064e3b",
  "#065f46","#14b8a6","#5eead4","#0f766e",
  "#1e3a8a","#3b82f6","#93c5fd","#0ea5e9",
  "#312e81","#8b5cf6"
];

let currentHex = PALETTE[7];
let currentColor = hexToRgb(currentHex);

// ===== UI refs =====
let guiEl, toggleBtnEl, statusEl, paletteEl, motionBtnEl;

// ===== Mobile sensors =====
let sensorsEnabled = false;

// Cursor position in grid coords
let cursorGX = Math.floor(COLS / 2);
let cursorGY = Math.floor(ROWS / 2);

// DeviceOrientation tilt values
let tiltGamma = 0; // left-right
let tiltBeta = 0;  // front-back

// Movement rate limiting
let lastMoveTime = 0;
const MOVE_INTERVAL_MS = 120;
const TILT_DEADZONE = 10;

// Shake detection
let lastShakeTime = 0;
const SHAKE_COOLDOWN_MS = 700;
const SHAKE_THRESHOLD = 17;

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("sketch-container");

  noStroke();
  updateBoardMetrics();

  overlay = createGraphics(windowWidth, windowHeight);
  overlay.clear();

  setupUI();

  background(240);
  drawGridLines();
  redrawAllCells();
}

function draw() {
  // Clear + redraw cursor on overlay only (no trails)
  overlay.clear();
  drawCursorOverlay();

  // Draw overlay on top of main canvas
  image(overlay, 0, 0);

  if (sensorsEnabled) {
    stepCursorByTilt();
  }
}

// ===== Input helpers =====
// Convert a canvas point (px, py) to a grid cell (gx, gy) considering board offsets
function pointToGrid(px, py) {
  const x = px - boardOX;
  const y = py - boardOY;
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  return { gx, gy };
}

// Check if a grid cell is inside board
function isValidCell(gx, gy) {
  return gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS;
}

// ===== Interaction =====
// Desktop: click places at pointer.
// Sensor mode: tap places at cursor.
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
  // Use touches[0] for iOS reliability
  const t = (touches && touches.length > 0) ? touches[0] : null;
  const tx = t ? t.x : touchX;
  const ty = t ? t.y : touchY;

  if (isEventOnGUI(tx, ty)) return false;

  if (sensorsEnabled) {
    placeAtCell(cursorGX, cursorGY);
  } else {
    const { gx, gy } = pointToGrid(tx, ty);
    placeAtCell(gx, gy);
  }

  return false; // prevent scroll
}

function placeAtCell(gx, gy) {
  if (!isValidCell(gx, gy)) return;

  const { r, g, b } = currentColor;

  // Local paint first
  paintCell(gx, gy, r, g, b);

  // Sync to others
  socket.emit("place", { gx, gy, r, g, b });
}

// ===== Rendering =====
function paintCell(gx, gy, r, g, b) {
  grid.set(`${gx},${gy}`, { r, g, b });

  fill(r, g, b);
  // Small inset to mimic pegboard gaps
  rect(
    boardOX + gx * cellSize + 1,
    boardOY + gy * cellSize + 1,
    cellSize - 2,
    cellSize - 2
  );
}

function drawGridLines() {
  push();
  stroke(220);
  strokeWeight(1);

  // Vertical
  for (let x = 0; x <= COLS; x++) {
    const px = boardOX + x * cellSize;
    line(px, boardOY, px, boardOY + boardH);
  }
  // Horizontal
  for (let y = 0; y <= ROWS; y++) {
    const py = boardOY + y * cellSize;
    line(boardOX, py, boardOX + boardW, py);
  }

  pop();
}

function drawCursorOverlay() {
  // Draw cursor as a clean outline on overlay buffer
  overlay.push();
  overlay.noFill();
  overlay.stroke(0, 120);
  overlay.strokeWeight(3);
  overlay.rect(
    boardOX + cursorGX * cellSize + 1,
    boardOY + cursorGY * cellSize + 1,
    cellSize - 2,
    cellSize - 2
  );
  overlay.pop();
}

function redrawAllCells() {
  for (const [key, c] of grid.entries()) {
    const [gx, gy] = key.split(",").map(Number);
    fill(c.r, c.g, c.b);
    rect(
      boardOX + gx * cellSize + 1,
      boardOY + gy * cellSize + 1,
      cellSize - 2,
      cellSize - 2
    );
  }
}

function updateBoardMetrics() {
  // Choose a uniform cell size so tiles are not squeezed on mobile
  cellSize = Math.floor(Math.min(width / COLS, height / ROWS));
  cellSize = Math.max(cellSize, 4); // safety

  boardW = cellSize * COLS;
  boardH = cellSize * ROWS;

  // Center the board
  boardOX = Math.floor((width - boardW) / 2);
  boardOY = Math.floor((height - boardH) / 2);
}

// ===== Socket events =====
socket.on("place", (data) => {
  paintCell(data.gx, data.gy, data.r, data.g, data.b);
});

socket.on("connect", () => console.log("connected:", socket.id));
socket.on("disconnect", () => console.log("disconnected"));

// ===== Resize =====
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  updateBoardMetrics();

  overlay = createGraphics(windowWidth, windowHeight);
  overlay.clear();

  background(240);
  drawGridLines();
  redrawAllCells();
}

// ===== UI =====
function setupUI() {
  guiEl = document.getElementById("gui-container");
  if (!guiEl) return;

  guiEl.classList.add("open");
  guiEl.innerHTML = "";

  // Toggle button (CSS class .button)
  toggleBtnEl = document.createElement("button");
  toggleBtnEl.className = "button";
  toggleBtnEl.textContent = ">";
  toggleBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    guiEl.classList.toggle("open");
  });
  guiEl.appendChild(toggleBtnEl);

  // Motion permission button (iOS)
  motionBtnEl = document.createElement("button");
  motionBtnEl.id = "motionBtn";
  motionBtnEl.className = "motion-btn";
  motionBtnEl.textContent = "Enable Motion";
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

  PALETTE.forEach((hex, idx) => {
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

      // Update outline highlights
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

function randomizeColorFromPalette() {
  const idx = Math.floor(Math.random() * PALETTE.length);
  setCurrentColor(PALETTE[idx]);

  if (paletteEl) {
    Array.from(paletteEl.children).forEach((child) => (child.style.outline = "none"));
    const btn = paletteEl.children[idx];
    if (btn) {
      btn.style.outline = "2px solid rgba(0,0,0,0.6)";
      btn.style.outlineOffset = "1px";
    }
  }
}

// ===== IMPORTANT FIX =====
// Detect if the user tapped/clicked on ANY GUI element (including the toggle button that sticks out).
// We do this by checking the DOM element at the click position.
function isEventOnGUI(px, py) {
  if (!guiEl) return false;

  // Convert p5 canvas coords to viewport (client) coords
  // Since canvas is fullscreen, px/py usually match client coords,
  // but this keeps it correct if your layout changes.
  const c = document.querySelector("canvas");
  if (!c) return false;
  const rect = c.getBoundingClientRect();
  const clientX = rect.left + px;
  const clientY = rect.top + py;

  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return false;

  // If the clicked element is inside gui-container, treat as GUI
  return guiEl.contains(el);
}

// ===== Motion permission + sensors =====
async function requestMotionPermission() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") {
        motionBtnEl.textContent = "Motion: Denied";
        return;
      }
    }

    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const res2 = await DeviceOrientationEvent.requestPermission();
      if (res2 !== "granted") {
        motionBtnEl.textContent = "Orientation: Denied";
        return;
      }
    }

    enableSensors();
    motionBtnEl.textContent = "Motion: ON";
  } catch (e) {
    console.warn(e);
    motionBtnEl.textContent = "Motion: Error";
  }
}

function enableSensors() {
  if (sensorsEnabled) return;
  sensorsEnabled = true;

  window.addEventListener("deviceorientation", onDeviceOrientation, true);
  window.addEventListener("devicemotion", onDeviceMotion, true);
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

function onDeviceMotion(e) {
  const a = e.accelerationIncludingGravity || e.acceleration;
  if (!a) return;

  const ax = a.x || 0;
  const ay = a.y || 0;
  const az = a.z || 0;

  const mag = Math.sqrt(ax * ax + ay * ay + az * az);

  const now = Date.now();
  if (mag > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_COOLDOWN_MS) {
    lastShakeTime = now;
    randomizeColorFromPalette();
  }
}

// ===== Utils =====
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}
