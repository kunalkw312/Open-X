const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// --- DUAL CANVAS SETUP (FOR 0 LATENCY & HIGHLIGHTER FIX) ---
const draftCanvas = document.createElement('canvas');
draftCanvas.id = 'draftBoard';
draftCanvas.style.position = 'absolute';
draftCanvas.style.top = '0';
draftCanvas.style.left = '0';
draftCanvas.style.zIndex = '2'; 
draftCanvas.style.touchAction = 'none';
draftCanvas.style.pointerEvents = 'none'; // Passes touches to main canvas
canvas.parentNode.appendChild(draftCanvas);
const draftCtx = draftCanvas.getContext('2d');

// --- STATE MANAGEMENT ---
let currentTool = 'pen';
let currentColor = '#000000';
let currentSize = 4;

// Tracks simultaneous touches for multi-user drawing
const activePointers = new Map(); 

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
    e.currentTarget.classList.add('active');
    currentTool = e.currentTarget.dataset.tool;
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

// --- MULTI-TOUCH & DRAWING ENGINE ---

let needsDraftRender = false;
let currentPalmCenter = null;

// PROXIMITY PALM DETECTION: 6+ touches clustered together
function checkPalmStatus() {
  if (activePointers.size < 6) return null;

  let cx = 0, cy = 0;
  let pts = [];
  activePointers.forEach(p => {
    const lastPt = p.points[p.points.length - 1];
    cx += lastPt.x;
    cy += lastPt.y;
    pts.push(lastPt);
  });
  cx /= pts.length;
  cy /= pts.length;

  // Max distance between the centroid and any single finger to be considered a palm/fist
  const MAX_RADIUS = 300; 
  for (let pt of pts) {
    if (Math.hypot(pt.x - cx, pt.y - cy) > MAX_RADIUS) {
      return null; // Touches are too spread out (likely multiple people drawing)
    }
  }

  // If we reach here, it's a palm. Invalidate these strokes so they don't draw ink
  activePointers.forEach(p => p.isInvalidated = true);
  return { x: cx, y: cy };
}

function drawFreehandSegment(stroke) {
  if (stroke.points.length < 3 || stroke.isInvalidated) return;
  const pts = stroke.points;
  const last2 = pts[pts.length - 3];
  const last1 = pts[pts.length - 2];
  const curr = pts[pts.length - 1];

  const mid1 = { x: (last2.x + last1.x) / 2, y: (last2.y + last1.y) / 2 };
  const mid2 = { x: (last1.x + curr.x) / 2, y: (last1.y + curr.y) / 2 };

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.tool === 'eraser' ? stroke.size * 8 : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

  ctx.beginPath();
  ctx.moveTo(mid1.x, mid1.y);
  ctx.quadraticCurveTo(last1.x, last1.y, mid2.x, mid2.y);
  ctx.stroke();
}

function drawShapeOnContext(targetCtx, stroke) {
  if (stroke.isInvalidated) return;
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
  if (stroke.isInvalidated) return;
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

// --- OPTIMIZED RENDER LOOP (DECOUPLED FROM EVENTS) ---
function renderDraftLayer() {
  if (needsDraftRender) {
    draftCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw visual indicator for palm eraser
    if (currentPalmCenter) {
      draftCtx.globalCompositeOperation = 'source-over';
      draftCtx.beginPath();
      draftCtx.arc(currentPalmCenter.x, currentPalmCenter.y, 75, 0, Math.PI * 2);
      draftCtx.fillStyle = 'rgba(150, 150, 150, 0.5)';
      draftCtx.fill();
    } else {
      // Draw active shapes and highlighters
      activePointers.forEach(stroke => {
        if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool)) {
          drawShapeOnContext(draftCtx, stroke);
        }
      });
    }
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
    isInvalidated: false
  });

  currentPalmCenter = checkPalmStatus();

  // Draw initial dot if not palm erasing
  if (['pen', 'marker', 'eraser'].includes(tool) && !currentPalmCenter) {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, (tool === 'eraser' ? currentSize * 8 : currentSize) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (currentPalmCenter) needsDraftRender = true;
});

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);
  currentPalmCenter = checkPalmStatus();
  
  // Use Coalesced Events for perfect zero-latency curves
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  
  for (let event of events) {
    stroke.points.push(getCoordinates(event.clientX, event.clientY));
    
    if (currentPalmCenter) {
      // Physically erase on the main canvas
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(currentPalmCenter.x, currentPalmCenter.y, 75, 0, Math.PI * 2);
      ctx.fill();
      needsDraftRender = true;
    } else if (['pen', 'marker', 'eraser'].includes(stroke.tool)) {
      drawFreehandSegment(stroke);
    } else {
      needsDraftRender = true;
    }
  }
});

function handlePointerEnd(e) {
  e.preventDefault();
  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);

  // Tie off freehand strokes cleanly
  if (['pen', 'marker', 'eraser'].includes(stroke.tool) && stroke.points.length >= 2 && !stroke.isInvalidated) {
    const pts = stroke.points;
    const last1 = pts[pts.length - 2];
    const curr = pts[pts.length - 1];
    const mid = { x: (last1.x + curr.x) / 2, y: (last1.y + curr.y) / 2 };

    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.tool === 'eraser' ? stroke.size * 8 : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }

  // Stamp finished shapes to the main board
  if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool)) {
    stampShapeToMain(stroke);
  }

  activePointers.delete(e.pointerId);
  currentPalmCenter = checkPalmStatus(); // Re-evaluate if palm is still active

  if (activePointers.size === 0) {
    needsDraftRender = true; // Clear the draft canvas
    saveState(); // Commit stroke to undo history
  }
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);
canvas.addEventListener('pointerout', handlePointerEnd);
