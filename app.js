// --- CONFIGURATION ---

// 1. Palm Eraser Size: Change this to make the visual and physical eraser larger or smaller.
// A radius of 50 means the eraser is 100 pixels wide.
const PALM_ERASER_RADIUS = 45;

// 2. Palm Detection Sensitivity: Increase these to make it HARDER to accidentally trigger the palm eraser.
// - Jitter Ratio: How much the touch vibrates compared to a straight line (Normal pen is ~1.0).
const PALM_JITTER_RATIO_THRESHOLD = 4.5; 
// - Direction Reversals: How many times the touch changes X/Y direction rapidly.
const PALM_REVERSAL_THRESHOLD = 4;     


// --- INITIALIZATION ---
const canvas = document.getElementById('board');
// Removed { alpha: false } so 'destination-out' erasing works correctly again
const ctx = canvas.getContext('2d'); 

// --- DUAL CANVAS SETUP ---
const draftCanvas = document.createElement('canvas');
draftCanvas.id = 'draftBoard';
draftCanvas.style.position = 'absolute';
draftCanvas.style.top = '0';
draftCanvas.style.left = '0';
draftCanvas.style.zIndex = '2'; 
draftCanvas.style.touchAction = 'none';
draftCanvas.style.pointerEvents = 'none'; 
canvas.parentNode.appendChild(draftCanvas);
const draftCtx = draftCanvas.getContext('2d');

// --- STATE MANAGEMENT ---
let currentTool = 'pen';
let currentColor = '#000000';
let currentSize = 4;

const activePointers = new Map(); 

// GPU-Accelerated Undo/Redo using offscreen canvases
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 15;

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
  
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draftCtx.setTransform(1, 0, 0, 1, 0, 0);
  
  ctx.scale(dpr, dpr);
  draftCtx.scale(dpr, dpr);
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  
  undoStack = [];
  redoStack = [];
  saveState();
}

window.addEventListener('resize', initCanvas);
initCanvas();

// --- EXACT COORDINATE MAPPING ---
function getCoordinates(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
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

// --- ZERO-LATENCY UNDO / REDO ---
function saveState() {
  let cacheCanvas;
  if (undoStack.length >= MAX_HISTORY) {
    cacheCanvas = undoStack.shift(); 
  } else {
    cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = canvas.width;
    cacheCanvas.height = canvas.height;
  }
  
  const cacheCtx = cacheCanvas.getContext('2d');
  cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
  cacheCtx.drawImage(canvas, 0, 0);
  
  undoStack.push(cacheCanvas);
  redoStack = []; 
}

function restoreState(sourceCanvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.restore();
}

document.getElementById('btnUndo').addEventListener('click', () => {
  if (undoStack.length > 1) {
    redoStack.push(undoStack.pop());
    restoreState(undoStack[undoStack.length - 1]);
  }
});

document.getElementById('btnRedo').addEventListener('click', () => {
  if (redoStack.length > 0) {
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    restoreState(nextState);
  }
});

// --- MULTI-TOUCH & DRAWING ENGINE ---

let needsDraftRender = false;

// BEHAVIORAL PALM DETECTION (Using Jitter Heuristics)
function analyzeBehavioralPalm(stroke) {
  if (stroke.isPalm) return true; 
  
  const pts = stroke.points;
  const SAMPLE_SIZE = 8; 
  
  if (pts.length < SAMPLE_SIZE) return false;

  let dist = 0;
  let revs = 0;
  let lastDx = 0, lastDy = 0;
  
  const startIdx = pts.length - SAMPLE_SIZE;
  const startPt = pts[startIdx];
  const endPt = pts[pts.length - 1];

  for (let i = startIdx + 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    dist += Math.hypot(dx, dy);

    if ((dx > 0 && lastDx < 0) || (dx < 0 && lastDx > 0)) revs++;
    if ((dy > 0 && lastDy < 0) || (dy < 0 && lastDy > 0)) revs++;

    if (dx !== 0) lastDx = dx;
    if (dy !== 0) lastDy = dy;
  }

  const linearDist = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
  const ratio = linearDist === 0 ? 0 : dist / linearDist;

  // Uses the configuration variables defined at the top of the file
  if (ratio > PALM_JITTER_RATIO_THRESHOLD || revs >= PALM_REVERSAL_THRESHOLD) {
    stroke.isPalm = true;
    stroke.tool = 'eraser'; 
    return true; 
  }
  
  return false;
}

// BATCHED BEZIER CURVES
function drawBatch(stroke) {
  if (stroke.points.length < 3) return;
  
  const pts = stroke.points;
  let i = stroke.lastRenderedIndex;
  if (i >= pts.length - 1) return;

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  
  // Apply the custom palm eraser radius
  const eraserSize = stroke.isPalm ? (PALM_ERASER_RADIUS * 2) : (stroke.size * 8);
  ctx.lineWidth = stroke.tool === 'eraser' ? eraserSize : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

  ctx.beginPath();
  const p0 = pts[i - 1];
  const p1 = pts[i];
  ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);

  for (; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i+1].x) / 2;
    const midY = (pts[i].y + pts[i+1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.stroke();
  
  stroke.lastRenderedIndex = pts.length - 1;
}

function drawShapeOnContext(targetCtx, stroke) {
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.strokeStyle = stroke.color;
  targetCtx.lineWidth = stroke.tool === 'highlighter' ? stroke.size * 5 : stroke.size;

  const pts = stroke.points;
  if (pts.length < 2) return;

  targetCtx.beginPath();
  const start = pts[0];
  const curr = pts[pts.length - 1];

  if (stroke.tool === 'line') {
    targetCtx.moveTo(start.x, start.y);
    targetCtx.lineTo(curr.x, curr.y);
  } else if (stroke.tool === 'rect') {
    targetCtx.rect(start.x, start.y, curr.x - start.x, curr.y - start.y);
  } else if (stroke.tool === 'circle') {
    const radius = Math.hypot(curr.x - start.x, curr.y - start.y);
    targetCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
  } else if (stroke.tool === 'highlighter') {
    targetCtx.moveTo(start.x, start.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const cx = (pts[i].x + pts[i+1].x) / 2;
      const cy = (pts[i].y + pts[i+1].y) / 2;
      targetCtx.quadraticCurveTo(pts[i].x, pts[i].y, cx, cy);
    }
    targetCtx.lineTo(curr.x, curr.y);
  }
  targetCtx.stroke();
}

function stampShapeToMain(stroke) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  
  const dpr = window.devicePixelRatio || 1;
  tempCtx.scale(dpr, dpr);
  drawShapeOnContext(tempCtx, stroke);

  ctx.save();
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = 'multiply';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(tempCanvas, 0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.restore();
}

// --- OPTIMIZED DRAFT RENDER LOOP ---
function renderDraftLayer() {
  if (needsDraftRender) {
    draftCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    activePointers.forEach(stroke => {
      // Draw shapes/highlighters
      if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool) && !stroke.isPalm) {
        drawShapeOnContext(draftCtx, stroke);
      }
      
      // Draw visual feedback for palm eraser
      if (stroke.isPalm) {
        const pt = stroke.points[stroke.points.length - 1];
        draftCtx.globalCompositeOperation = 'source-over';
        draftCtx.beginPath();
        // Uses the configuration variable
        draftCtx.arc(pt.x, pt.y, PALM_ERASER_RADIUS, 0, Math.PI * 2);
        draftCtx.fillStyle = 'rgba(150, 150, 150, 0.5)';
        draftCtx.fill();
        draftCtx.lineWidth = 2;
        draftCtx.strokeStyle = '#999';
        draftCtx.stroke();
      }
    });
    
    needsDraftRender = false;
  }
  requestAnimationFrame(renderDraftLayer);
}
requestAnimationFrame(renderDraftLayer);

// --- UNIFIED POINTER EVENT LISTENERS ---

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const coords = getCoordinates(e.clientX, e.clientY);
  const tool = e.pointerType === 'eraser' ? 'eraser' : currentTool;

  activePointers.set(e.pointerId, {
    tool: tool,
    color: currentColor,
    size: currentSize,
    points: [coords],
    lastRenderedIndex: 1,
    isPalm: false 
  });

  if (['pen', 'marker', 'eraser'].includes(tool)) {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, (tool === 'eraser' ? currentSize * 8 : currentSize) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
});

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  
  for (let i = 0; i < events.length; i++) {
    stroke.points.push(getCoordinates(events[i].clientX, events[i].clientY));
  }

  analyzeBehavioralPalm(stroke);

  if (['pen', 'marker', 'eraser'].includes(stroke.tool)) {
    drawBatch(stroke);
  }
  
  if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool) || stroke.isPalm) {
    needsDraftRender = true;
  }
});

function handlePointerEnd(e) {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);

  if (['pen', 'marker', 'eraser'].includes(stroke.tool) && stroke.points.length >= 2) {
    const pts = stroke.points;
    const p0 = pts[stroke.lastRenderedIndex - 1] || pts[0];
    const curr = pts[pts.length - 1];

    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    
    // Uses the configuration variable
    const eraserSize = stroke.isPalm ? (PALM_ERASER_RADIUS * 2) : (stroke.size * 8);
    ctx.lineWidth = stroke.tool === 'eraser' ? eraserSize : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

    ctx.beginPath();
    ctx.moveTo((p0.x + curr.x) / 2, (p0.y + curr.y) / 2);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }

  if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool) && !stroke.isPalm) {
    stampShapeToMain(stroke);
  }

  activePointers.delete(e.pointerId);

  needsDraftRender = true; 
  
  if (activePointers.size === 0) {
    saveState(); 
  }
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);
canvas.addEventListener('pointerout', handlePointerEnd);
