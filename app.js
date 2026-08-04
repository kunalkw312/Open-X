const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// --- DUAL CANVAS SETUP (FOR 0 LATENCY & HIGHLIGHTER FIX) ---
// We create a temporary top layer to draw active shapes and highlighters
// without lagging the main board or causing overlapping alpha circles.
const draftCanvas = document.createElement('canvas');
draftCanvas.id = 'draftBoard';
draftCanvas.style.position = 'absolute';
draftCanvas.style.top = '0';
draftCanvas.style.left = '0';
draftCanvas.style.zIndex = '2'; // Above board, below toolbar
draftCanvas.style.touchAction = 'none';
draftCanvas.style.pointerEvents = 'none'; // Lets touches pass through to the main board
canvas.parentNode.appendChild(draftCanvas);
const draftCtx = draftCanvas.getContext('2d');

// --- STATE MANAGEMENT ---
let currentTool = 'pen';
let currentColor = '#000000';
let currentSize = 4;
let isDrawing = false;
let isPalmErasing = false;

let points = []; // Stores coordinates for smoothing

let undoStack = [];
let redoStack = [];

// --- DPI SCALING ---
function initCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  [canvas, draftCanvas].forEach(c => {
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  });
  
  // Reset transforms before scaling
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draftCtx.setTransform(1, 0, 0, 1, 0, 0);
  
  ctx.scale(dpr, dpr);
  draftCtx.scale(dpr, dpr);
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  
  saveState();
}

window.addEventListener('resize', () => {
  const temp = ctx.getImageData(0, 0, canvas.width, canvas.height);
  initCanvas();
  ctx.putImageData(temp, 0, 0);
});

initCanvas();

// --- EXACT COORDINATE MAPPING (FIX FOR THE OFFSET) ---
function getCoordinates(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  // Because ctx.scale() is active, we just need the exact CSS pixel relative to the canvas
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

// --- UI LISTENERS ---
document.querySelectorAll('.tool').forEach(button => {
  button.addEventListener('click', (e) => {
    document.querySelectorAll('.tool').forEach(btn => btn.classList.remove('active'));
    const btn = e.currentTarget;
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

document.getElementById('colorPicker').addEventListener('input', (e) => currentColor = e.target.value);
document.getElementById('sizePicker').addEventListener('input', (e) => currentSize = parseInt(e.target.value, 10));

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

// --- UNDO / REDO ---
function saveState() {
  if (undoStack.length >= 20) undoStack.shift(); 
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  redoStack = []; 
}

document.getElementById('btnUndo').addEventListener('click', () => {
  if (undoStack.length > 1) {
    redoStack.push(undoStack.pop());
    ctx.putImageData(undoStack[undoStack.length - 1], 0, 0);
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
function applyToolSettings(context, tool) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = currentColor;
  context.globalAlpha = 1; 
  context.globalCompositeOperation = 'source-over';

  if (tool === 'pen') {
    context.lineWidth = currentSize;
  } else if (tool === 'marker') {
    context.lineWidth = currentSize * 3;
  } else if (tool === 'highlighter') {
    context.lineWidth = currentSize * 5;
    // Note: Highlighter transparency is applied during the stamp phase
  } else if (tool === 'eraser') {
    context.globalCompositeOperation = 'destination-out';
    context.lineWidth = isPalmErasing ? 150 : currentSize * 8;
  } else {
    context.lineWidth = currentSize;
  }
}

function handleStart(x, y) {
  isDrawing = true;
  points = [{x, y}];

  const actualTool = isPalmErasing ? 'eraser' : currentTool;

  // For fast, incremental tools, we draw a starting dot immediately
  if (['pen', 'marker', 'eraser'].includes(actualTool)) {
    applyToolSettings(ctx, actualTool);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1); 
    ctx.stroke();
  }
}

function handleMove(x, y, forceEraser = false) {
  if (!isDrawing) return;
  points.push({x, y});
  
  const tool = forceEraser ? 'eraser' : currentTool;

  if (['pen', 'marker', 'eraser'].includes(tool)) {
    // 0-LATENCY BEZIER SMOOTHING: Incrementally draw directly to the base canvas
    if (points.length >= 3) {
      const last2 = points[points.length - 3];
      const last1 = points[points.length - 2];
      const curr = points[points.length - 1];

      const mid1 = { x: (last2.x + last1.x) / 2, y: (last2.y + last1.y) / 2 };
      const mid2 = { x: (last1.x + curr.x) / 2, y: (last1.y + curr.y) / 2 };

      applyToolSettings(ctx, tool);
      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(last1.x, last1.y, mid2.x, mid2.y);
      ctx.stroke();
    }
  } else {
    // SHAPES & HIGHLIGHTER: Draw to the draft canvas to prevent overlap artifacts and lag
    draftCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    applyToolSettings(draftCtx, tool);
    draftCtx.beginPath();

    const start = points[0];

    if (tool === 'line') {
      draftCtx.moveTo(start.x, start.y);
      draftCtx.lineTo(x, y);
    } else if (tool === 'rect') {
      draftCtx.rect(start.x, start.y, x - start.x, y - start.y);
    } else if (tool === 'circle') {
      const radius = Math.hypot(x - start.x, y - start.y);
      draftCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
    } else if (tool === 'highlighter') {
      // Draw highlighter as one continuous, solid path on the draft layer
      draftCtx.moveTo(start.x, start.y);
      for (let i = 1; i < points.length - 1; i++) {
        const c = (points[i].x + points[i+1].x) / 2;
        const d = (points[i].y + points[i+1].y) / 2;
        draftCtx.quadraticCurveTo(points[i].x, points[i].y, c, d);
      }
      draftCtx.lineTo(x, y);
    }
    draftCtx.stroke();
  }
}

function handleEnd() {
  if (!isDrawing) return;
  isDrawing = false;
  
  const actualTool = isPalmErasing ? 'eraser' : currentTool;

  // Tie off the final segment for incremental smooth strokes
  if (['pen', 'marker', 'eraser'].includes(actualTool) && points.length > 1) {
    const last1 = points[points.length - 2] || points[0];
    const curr = points[points.length - 1];
    const mid = { x: (last1.x + curr.x) / 2, y: (last1.y + curr.y) / 2 };
    
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }

  // Stamp draft layer to base layer for shapes and highlighters
  if (['line', 'rect', 'circle', 'highlighter'].includes(actualTool) && !isPalmErasing) {
    ctx.save();
    if (actualTool === 'highlighter') {
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = 'multiply'; // Blends beautifully like real ink
    }
    
    // Scale down dimensions because ctx is already scaled by dpr
    const dpr = window.devicePixelRatio || 1;
    ctx.drawImage(draftCanvas, 0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();
    
    draftCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  isPalmErasing = false;
  saveState(); // Commit to undo history
}

// --- WINDOWS / STYLUS LOGIC ---
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
  if (isPalmErasing && e.touches.length < 3) handleEnd();
  else if (e.touches.length === 0) handleEnd();
});

canvas.addEventListener('touchcancel', handleEnd);
