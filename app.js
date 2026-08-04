const canvas = document.getElementById('board');
// willReadFrequently optimizes the canvas for frequent Undo/Redo snapshots
const ctx = canvas.getContext('2d', { willReadFrequently: true }); 

// --- STATE MANAGEMENT ---
let currentTool = 'pen';
let currentColor = '#000000';
let currentSize = 4;
let isDrawing = false;
let isPalmErasing = false;

// Coordinates
let startX = 0, startY = 0;
let lastX = 0, lastY = 0;

// History for Undo/Redo and Shapes
let undoStack = [];
let redoStack = [];
let snapshot = null;

// --- DPI SCALING (HIGH RESOLUTION INK) ---
function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  
  // Set actual internal canvas resolution
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  
  // Set CSS display size
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  
  // Scale the context to match the CSS layout
  ctx.scale(dpr, dpr);
  
  // Fill with white background (crucial for export and erasing)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  
  saveState(); // Save initial blank state
}

window.addEventListener('resize', () => {
  // Save current drawing before resizing
  const temp = ctx.getImageData(0, 0, canvas.width, canvas.height);
  initCanvas();
  ctx.putImageData(temp, 0, 0);
});

initCanvas();

// --- COORDINATE MAPPING (THE FIX FOR THE OFFSET) ---
// This translates the raw screen coordinates into exact canvas coordinates,
// accounting for any browser toolbars, DPI scaling, and CSS layout shifts.
function getCoordinates(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  
  // Calculate the scale in case the canvas CSS size differs from internal pixel size
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  return {
    x: ((clientX - rect.left) * scaleX) / dpr,
    y: ((clientY - rect.top) * scaleY) / dpr
  };
}

// --- UI / TOOLBAR LISTENERS ---
document.querySelectorAll('.tool').forEach(button => {
  button.addEventListener('click', (e) => {
    // Remove active class from all tools
    document.querySelectorAll('.tool').forEach(btn => btn.classList.remove('active'));
    // Set clicked tool as active
    const btn = e.currentTarget;
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

document.getElementById('colorPicker').addEventListener('input', (e) => {
  currentColor = e.target.value;
});

document.getElementById('sizePicker').addEventListener('input', (e) => {
  currentSize = parseInt(e.target.value, 10);
});

document.getElementById('btnClear').addEventListener('click', () => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  saveState();
});

document.getElementById('btnExport').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'Smartboard-Export.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// --- UNDO / REDO LOGIC ---
function saveState() {
  // Keep history to 20 steps to prevent massive memory usage on 4K screens
  if (undoStack.length >= 20) undoStack.shift(); 
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack = []; // Clear redo stack on new action
}

document.getElementById('btnUndo').addEventListener('click', () => {
  if (undoStack.length > 1) {
    redoStack.push(undoStack.pop());
    const previousState = undoStack[undoStack.length - 1];
    ctx.putImageData(previousState, 0, 0);
  }
});

document.getElementById('btnRedo').addEventListener('click', () => {
  if (redoStack.length > 0) {
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    ctx.putImageData(nextState, 0, 0);
  }
});

// --- CORE DRAWING LOGIC ---
function applyToolSettings(forceEraser = false) {
  const activeTool = forceEraser ? 'eraser' : currentTool;
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = currentColor;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  switch (activeTool) {
    case 'pen':
      ctx.lineWidth = currentSize;
      break;
    case 'marker':
      ctx.lineWidth = currentSize * 3;
      break;
    case 'highlighter':
      ctx.lineWidth = currentSize * 5;
      ctx.globalAlpha = 0.4;
      // Multiply blends the color over existing ink like a real highlighter
      ctx.globalCompositeOperation = 'multiply'; 
      break;
    case 'eraser':
      // Erases ink, revealing the white background
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = forceEraser ? 150 : currentSize * 8; // Massive if IR Palm
      break;
    case 'line':
    case 'rect':
    case 'circle':
      ctx.lineWidth = currentSize;
      break;
  }
}

function handleStart(x, y) {
  isDrawing = true;
  startX = x;
  startY = y;
  lastX = x;
  lastY = y;
  // Save a snapshot of the canvas before we start drawing shapes over it
  snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function handleMove(x, y, forceEraser = false) {
  if (!isDrawing) return;

  const tool = forceEraser ? 'eraser' : currentTool;
  applyToolSettings(forceEraser);

  if (tool === 'pen' || tool === 'marker' || tool === 'highlighter' || tool === 'eraser') {
    // Freehand drawing
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x;
    lastY = y;
  } else {
    // Shape drawing: Restore the snapshot first, then draw the shape on top
    ctx.putImageData(snapshot, 0, 0);
    ctx.beginPath();

    if (tool === 'line') {
      ctx.moveTo(startX, startY);
      ctx.lineTo(x, y);
    } else if (tool === 'rect') {
      ctx.rect(startX, startY, x - startX, y - startY);
    } else if (tool === 'circle') {
      const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
      ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }
}

function handleEnd() {
  if (isDrawing) {
    isDrawing = false;
    isPalmErasing = false;
    saveState(); // Save to undo history when stroke finishes
  }
}

// --- WINDOWS / MOUSE / ACTIVE STYLUS LOGIC ---
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return; 
  const { x, y } = getCoordinates(e.clientX, e.clientY);
  handleStart(x, y);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return; 
  const isHardwareEraser = e.pointerType === 'eraser';
  const { x, y } = getCoordinates(e.clientX, e.clientY);
  handleMove(x, y, isHardwareEraser);
});

canvas.addEventListener('pointerup', handleEnd);
canvas.addEventListener('pointercancel', handleEnd);

// --- ANDROID IFP / IR TOUCH LOGIC ---
function getTouchCenter(touches) {
  let cx = 0, cy = 0;
  for (let i = 0; i < touches.length; i++) {
    cx += touches[i].clientX;
    cy += touches[i].clientY;
  }
  return getCoordinates(cx / touches.length, cy / touches.length);
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault(); 
  
  if (e.touches.length >= 3) {
    isPalmErasing = true;
    const { x, y } = getTouchCenter(e.touches);
    handleStart(x, y);
  } else if (e.touches.length === 1) {
    isPalmErasing = false;
    const { x, y } = getCoordinates(e.touches[0].clientX, e.touches[0].clientY);
    handleStart(x, y);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();

  if (e.touches.length >= 3) {
    isPalmErasing = true;
    const { x, y } = getTouchCenter(e.touches);
    handleMove(x, y, true);
  } else if (e.touches.length === 1 && !isPalmErasing) {
    const { x, y } = getCoordinates(e.touches[0].clientX, e.touches[0].clientY);
    handleMove(x, y, false);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  // If user lifts part of palm, drop stroke to avoid accidental dots
  if (isPalmErasing && e.touches.length < 3) {
    handleEnd();
  } else if (e.touches.length === 0) {
    handleEnd();
  }
});

canvas.addEventListener('touchcancel', handleEnd);
