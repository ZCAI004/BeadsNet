/*eslint no-undef: 0*/
const socket = io();

// Grid
const COLS = 64;
const ROWS = 36;
let cellW, cellH;
const grid = new Map(); // "x,y" -> {r,g,b}

// Palette
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

// UI
let guiEl, toggleBtnEl, statusEl, paletteEl;
let motionBtnEl;

// Mobile sensors
let sensorsEnabled = false;

// cursor in grid coords
let cursorGX = Math.floor(COLS / 2);
let cursorGY = Math.floor(ROWS / 2);

// tilt values (DeviceOrientation)
let tiltGamma = 0; // left-right
let tiltBeta = 0;  // front-back

// move rate limiting (so it steps grid nicely)
let lastMoveTime = 0;
const MOVE_INTERVAL_MS = 120; // lower = faster movement
const TILT_DEADZONE = 10;     // degrees

// shake detection (DeviceMotion)
let lastShakeTime = 0;
const SHAKE_COOLDOWN_MS = 700;
const SHAKE_THRESHOLD = 17; // tune: 14-22 typical

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("sketch-container");

  noStroke();
  updateCellSize();

  setupUI();

  background(240);
  drawGridLines();
  redrawAllCells();
}

function draw() {
  // Draw cursor overlay
  drawCursorOverlay();

  // If sensors are enabled, move the cursor by tilt
  if (sensorsEnabled) {
    stepCursorByTilt();
  }
}

// Interaction
// Desktop: click places at pointer.
// Mobile: tapping places at cursor (more consistent for sensor control).
function mousePressed() {
  if (isPointInsideOpenGUI(mouseX, mouseY)) return;

  if (sensorsEnabled) {
    placeAtCell(cursorGX, cursorGY);
  } else {
    const gx = floor(mouseX / cellW);
    const gy = floor(mouseY / cellH);
    placeAtCell(gx, gy);
  }
}

function touchStarted() {
  if (isPointInsideOpenGUI(touchX, touchY)) return false;

  if (sensorsEnabled) {
    placeAtCell(cursorGX, cursorGY);
  } else {
    const gx = floor(touchX / cellW);
    const gy = floor(touchY / cellH);
    placeAtCell(gx, gy);
  }
  return false;
}

function placeAtCell(gx, gy) {
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;

  const { r, g, b } = currentColor;
  paintCell(gx, gy, r, g, b);
  socket.emit("place", { gx, gy, r, g, b });
}

// Rendering
function paintCell(gx, gy, r, g, b) {
  grid.set(`${gx},${gy}`, { r, g, b });

  // Leave a small gap to mimic a pegboard feel
  fill(r, g, b);
  rect(gx * cellW + 1, gy * cellH + 1, cellW - 2, cellH - 2);
}

function drawGridLines() {
  push();
  stroke(220);
  strokeWeight(1);
  for (let x = 0; x <= COLS; x++) line(x * cellW, 0, x * cellW, height);
  for (let y = 0; y <= ROWS; y++) line(0, y * cellH, width, y * cellH);
  pop();
}

function drawCursorOverlay() {
  // This draws a semi-transparent outline every frame.
  // It may leave a subtle trail. If you want a perfectly clean cursor,
  // use a separate overlay graphics buffer (createGraphics) for the cursor layer.
  push();
  noFill();
  stroke(0, 80);
  strokeWeight(2);
  rect(cursorGX * cellW + 1, cursorGY * cellH + 1, cellW - 2, cellH - 2);
  pop();
}

function updateCellSize() {
  cellW = width / COLS;
  cellH = height / ROWS;
}

function redrawAllCells() {
  for (const [key, c] of grid.entries()) {
    const [gx, gy] = key.split(",").map(Number);
    fill(c.r, c.g, c.b);
    rect(gx * cellW + 1, gy * cellH + 1, cellW - 2, cellH - 2);
  }
}

// Socket
socket.on("place", (data) => {
  paintCell(data.gx, data.gy, data.r, data.g, data.b);
});

socket.on("connect", () => console.log("connected:", socket.id));
socket.on("disconnect", () => console.log("disconnected"));

// Resize
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateCellSize();
  background(240);
  drawGridLines();
  redrawAllCells();
}

// UI Construction
function setupUI() {
  guiEl = document.getElementById("gui-container");
  if (!guiEl) return;

  guiEl.classList.add("open");

  // Keep motion button if present (from HTML), then rebuild rest
  motionBtnEl = document.getElementById("motionBtn");

  // Clear everything and rebuild cleanly:
  guiEl.innerHTML = "";

  // Toggle
  toggleBtnEl = document.createElement("button");
  toggleBtnEl.className = "button";
  toggleBtnEl.textContent = ">";
  toggleBtnEl.addEventListener("click", () => guiEl.classList.toggle("open"));
  guiEl.appendChild(toggleBtnEl);

  // Motion permission button
  motionBtnEl = document.createElement("button");
  motionBtnEl.id = "motionBtn";
  motionBtnEl.className = "motion-btn";
  motionBtnEl.textContent = "Enable Motion";
  motionBtnEl.addEventListener("click", requestMotionPermission);
  guiEl.appendChild(motionBtnEl);

  // Status (current color)
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

    btn.addEventListener("click", () => {
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

function randomizeColorFromPalette() {
  const idx = Math.floor(Math.random() * PALETTE.length);
  setCurrentColor(PALETTE[idx]);

  // update outline highlight
  if (paletteEl) {
    Array.from(paletteEl.children).forEach((child) => (child.style.outline = "none"));
    const btn = paletteEl.children[idx];
    if (btn) {
      btn.style.outline = "2px solid rgba(0,0,0,0.6)";
      btn.style.outlineOffset = "1px";
    }
  }
}

// Prevent "tap UI also places a bead"
function isPointInsideOpenGUI(px, py) {
  if (!guiEl) return false;
  if (!guiEl.classList.contains("open")) return false;
  const rect = guiEl.getBoundingClientRect();
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

// Motion permission + sensor handlers
async function requestMotionPermission() {
  try {
    // iOS needs explicit permission for motion/orientation
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") {
        motionBtnEl.textContent = "Motion: Denied";
        return;
      }
    }

    // Some iOS versions also gate DeviceOrientation
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
  // gamma: left-right [-90,90], beta: front-back [-180,180]
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
  // shake detection using accelerationIncludingGravity magnitude
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

// Utils
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}
