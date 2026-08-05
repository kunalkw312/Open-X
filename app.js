import './styles.css';

// --- CONFIGURATION ---
const PALM_ERASER_RADIUS = 50; 
const CLUSTER_PROXIMITY_RADIUS = 150; // The 5 fingers must be within this pixel distance

// --- CANVAS SETUP ---
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

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

let shapes = []; 
let selectedShape = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

const activePointers = new Map(); 

let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 15;

let needsDraftRender = false;

// --- PAGE MANAGEMENT ---
let pagesData = [{ shapes: [], undoStack: [], redoStack: [] }];
let currentPageIndex = 0;

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
  
  // Force a CSS background so the eraser can use true transparency
  canvas.style.backgroundColor = '#f8f9fa';
  ctx.clearRect(0, 0, w, h);
  
  undoStack = [];
  redoStack = [];
  saveState();
}

window.addEventListener('resize', initCanvas);
initCanvas();

function getCoordinates(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// --- PAGINATION LOGIC ---
function syncCurrentPage() {
  pagesData[currentPageIndex].shapes = [...shapes];
  pagesData[currentPageIndex].undoStack = [...undoStack];
  pagesData[currentPageIndex].redoStack = [...redoStack];
}

function loadPage(index) {
  syncCurrentPage(); 
  currentPageIndex = index;
  
  shapes = [...pagesData[currentPageIndex].shapes];
  undoStack = [...pagesData[currentPageIndex].undoStack];
  redoStack = [...pagesData[currentPageIndex].redoStack];
  
  redrawBoard();
  updatePaginationUI();
}

function updatePaginationUI() {
  document.getElementById('pageDisplay').textContent = `${currentPageIndex + 1}/${pagesData.length}`;
  
  const prevBtn = document.getElementById('btnPrevPage');
  const nextBtn = document.getElementById('btnNextPage');
  
  if (currentPageIndex === 0) prevBtn.classList.add('disabled');
  else prevBtn.classList.remove('disabled');
  
  if (currentPageIndex === pagesData.length - 1) nextBtn.classList.add('disabled');
  else nextBtn.classList.remove('disabled');
}

document.getElementById('btnAddPage').addEventListener('click', () => {
  syncCurrentPage();
  pagesData.push({ shapes: [], undoStack: [], redoStack: [] });
  currentPageIndex = pagesData.length - 1;
  
  shapes = [];
  undoStack = [];
  redoStack = [];
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  saveState();
  updatePaginationUI();
});

document.getElementById('btnPrevPage').addEventListener('click', () => {
  if (currentPageIndex > 0) loadPage(currentPageIndex - 1);
});

document.getElementById('btnNextPage').addEventListener('click', () => {
  if (currentPageIndex < pagesData.length - 1) loadPage(currentPageIndex + 1);
});

// --- UI LISTENERS ---
const sizePopover = document.getElementById('size-popover');
const sizeValueDisplay = document.getElementById('sizeValue');

document.querySelectorAll('.tool').forEach(button => {
  button.addEventListener('click', (e) => {
    document.querySelectorAll('.tool').forEach(btn => btn.classList.remove('active'));
    e.currentTarget.classList.add('active');
    currentTool = e.currentTarget.dataset.tool;

    if (['pen', 'marker', 'highlighter', 'eraser'].includes(currentTool)) {
      sizePopover.classList.remove('hidden');
    } else {
      sizePopover.classList.add('hidden');
    }
  });
});

canvas.addEventListener('pointerdown', () => sizePopover.classList.add('hidden'));

document.getElementById('colorPicker').addEventListener('input', (e) => currentColor = e.target.value);
document.getElementById('sizePicker').addEventListener('input', (e) => {
  currentSize = parseInt(e.target.value, 10);
  sizeValueDisplay.textContent = `${currentSize}px`; 
});

document.getElementById('btnClear').addEventListener('click', () => {
  shapes = []; 
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  saveState();
});

document.getElementById('btnExport').addEventListener('click', () => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  
  // Fill the exported image with the background color so it isn't transparent
  tCtx.fillStyle = '#f8f9fa';
  tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tCtx.drawImage(canvas, 0, 0);

  const link = document.createElement('a');
  link.download = `Smartboard-Page-${currentPageIndex + 1}.png`;
  link.href = tempCanvas.toDataURL('image/png');
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

// --- 5-FINGER PALM DETECTION ENGINE ---
let palmActive = false;
let palmPoints = [];

function checkPalmStatus() {
  if (activePointers.size < 2) return null;

  let cx = 0, cy = 0;
  for (let p of activePointers.values()) {
    const pt = p.points[p.points.length - 1];
    cx += pt.x;
    cy += pt.y;
  }
  cx /= activePointers.size;
  cy /= activePointers.size;

  // Check if the 5 fingers are clustered closely together (a palm) or spread out (multiple people)
  for (let p of activePointers.values()) {
    const pt = p.points[p.points.length - 1];
    if (Math.hypot(pt.x - cx, pt.y - cy) > CLUSTER_PROXIMITY_RADIUS) {
      return null; 
    }
  }

  // It is a palm! Invalidate the individual fingers so they instantly stop drawing ink
  activePointers.forEach(p => p.isInvalidated = true);
  return { x: cx, y: cy };
}

// --- RENDERING & DRAWING ENGINES ---
function drawBatchedFreehand(stroke) {
  if (stroke.isInvalidated || stroke.points.length < 3) return;
  
  const pts = stroke.points;
  let i = stroke.lastRenderedIndex;
  if (i >= pts.length - 1) return;

  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.tool === 'eraser' ? (stroke.size * 8) : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

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

function getShapeAtPosition(x, y) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.tool === 'rect') {
      const minX = Math.min(s.x, s.x + s.w);
      const maxX = Math.max(s.x, s.x + s.w);
      const minY = Math.min(s.y, s.y + s.h);
      const maxY = Math.max(s.y, s.y + s.h);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return s;
    } else if (s.tool === 'circle') {
      const dist = Math.hypot(x - s.x, y - s.y);
      if (dist <= s.radius) return s;
    } else if (s.tool === 'line') {
      const minX = Math.min(s.x1, s.x2) - 10;
      const maxX = Math.max(s.x1, s.x2) + 10;
      const minY = Math.min(s.y1, s.y2) - 10;
      const maxY = Math.max(s.y1, s.y2) + 10;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return s;
    }
  }
  return null;
}

function redrawBoard() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  shapes.forEach(stroke => {
    ctx.save();
    
    if (['pen', 'marker', 'eraser', 'highlighter'].includes(stroke.tool)) {
      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.4;
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineWidth = stroke.size * 5;
      } else {
        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.lineWidth = stroke.tool === 'eraser' ? (stroke.isPalm ? PALM_ERASER_RADIUS * 2 : stroke.size * 8) : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);
      }
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color;
      
      ctx.beginPath();
      const pts = stroke.points;
      if (pts && pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mid = { x: (pts[i].x + pts[i+1].x) / 2, y: (pts[i].y + pts[i+1].y) / 2 };
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0; 
    } 
    else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;

      ctx.beginPath();
      if (stroke.tool === 'line') {
        ctx.moveTo(stroke.x1, stroke.y1);
        ctx.lineTo(stroke.x2, stroke.y2);
      } else if (stroke.tool === 'rect') {
        ctx.rect(stroke.x, stroke.y, stroke.w, stroke.h);
      } else if (stroke.tool === 'circle') {
        ctx.arc(stroke.x, stroke.y, stroke.radius, 0, Math.PI * 2);
      }
      ctx.stroke();

      if (stroke === selectedShape) {
        ctx.strokeStyle = '#5d35ff'; 
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        if (stroke.tool === 'rect') {
          ctx.strokeRect(stroke.x - 4, stroke.y - 4, stroke.w + 8, stroke.h + 8);
        } else if (stroke.tool === 'circle') {
          ctx.beginPath();
          ctx.arc(stroke.x, stroke.y, stroke.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  });
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

// --- OPTIMIZED DRAFT RENDER LOOP ---
function renderDraftLayer() {
  if (needsDraftRender) {
    draftCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    activePointers.forEach(stroke => {
      if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool) && !stroke.isInvalidated) {
        drawShapeOnContext(draftCtx, stroke);
      }
    });

    if (palmActive && palmPoints.length > 0) {
      const pt = palmPoints[palmPoints.length - 1];
      draftCtx.globalCompositeOperation = 'source-over';
      draftCtx.beginPath();
      draftCtx.arc(pt.x, pt.y, PALM_ERASER_RADIUS, 0, Math.PI * 2);
      draftCtx.fillStyle = 'rgba(150, 150, 150, 0.5)';
      draftCtx.fill();
      draftCtx.lineWidth = 2;
      draftCtx.strokeStyle = '#999';
      draftCtx.stroke();
    }
    
    needsDraftRender = false;
  }
  requestAnimationFrame(renderDraftLayer);
}
requestAnimationFrame(renderDraftLayer);

// --- POINTER EVENT LISTENERS ---
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const coords = getCoordinates(e.clientX, e.clientY);
  const tool = e.pointerType === 'eraser' ? 'eraser' : currentTool;

  if (tool === 'select') {
    selectedShape = getShapeAtPosition(coords.x, coords.y);
    if (selectedShape) {
      isDragging = true;
      dragStartX = coords.x;
      dragStartY = coords.y;
    } else {
      selectedShape = null; 
    }
    redrawBoard();
    return; 
  }

  activePointers.set(e.pointerId, {
    tool: tool,
    color: currentColor,
    size: currentSize,
    points: [coords],
    lastRenderedIndex: 1,
    isInvalidated: false
  });

  const centroid = checkPalmStatus();
  if (centroid) needsDraftRender = true;

  const stroke = activePointers.get(e.pointerId);
  if (!stroke.isInvalidated && ['pen', 'marker', 'eraser'].includes(tool)) {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, (tool === 'eraser' ? currentSize * 8 : currentSize) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
});

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault();

  if (currentTool === 'select') {
    const coords = getCoordinates(e.clientX, e.clientY);
    if (isDragging && selectedShape) {
      const dx = coords.x - dragStartX;
      const dy = coords.y - dragStartY;
      
      if (selectedShape.tool === 'rect' || selectedShape.tool === 'circle') {
        selectedShape.x += dx;
        selectedShape.y += dy;
      } else if (selectedShape.tool === 'line') {
        selectedShape.x1 += dx;
        selectedShape.y1 += dy;
        selectedShape.x2 += dx;
        selectedShape.y2 += dy;
      }
      
      dragStartX = coords.x;
      dragStartY = coords.y;
      redrawBoard();
    }
    return;
  }

  const centroid = checkPalmStatus();

  if (centroid) {
    if (!palmActive) {
      palmActive = true;
      palmPoints = [centroid];
    } else {
      palmPoints.push(centroid);
    }

    // Instantly erase using the centroid on the main canvas
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, PALM_ERASER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    
    needsDraftRender = true;
  }

  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  
  for (let i = 0; i < events.length; i++) {
    stroke.points.push(getCoordinates(events[i].clientX, events[i].clientY));
  }

  if (['pen', 'marker', 'eraser'].includes(stroke.tool)) {
    drawBatchedFreehand(stroke);
  }
  
  if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool)) {
    needsDraftRender = true;
  }
});

function handlePointerEnd(e) {
  e.preventDefault();
  
  if (currentTool === 'select') {
    if (isDragging) {
      isDragging = false;
      saveState();
    }
    return;
  }

  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);

  // Normal Strokes
  if (!stroke.isInvalidated) {
    if (['pen', 'marker', 'eraser'].includes(stroke.tool) && stroke.points.length >= 2) {
      const pts = stroke.points;
      const p0 = pts[stroke.lastRenderedIndex - 1] || pts[0];
      const curr = pts[pts.length - 1];

      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.tool === 'eraser' ? (stroke.size * 8) : (stroke.tool === 'marker' ? stroke.size * 3 : stroke.size);

      ctx.beginPath();
      ctx.moveTo((p0.x + curr.x) / 2, (p0.y + curr.y) / 2);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
      
      shapes.push({
        tool: stroke.tool,
        points: [...stroke.points],
        color: stroke.color,
        size: stroke.size,
        isPalm: false
      });
    }

    if (['line', 'rect', 'circle', 'highlighter'].includes(stroke.tool)) {
      stampShapeToMain(stroke);
      const pts = stroke.points;
      if (pts.length >= 2) {
        const start = pts[0];
        const curr = pts[pts.length - 1];
        
        if (stroke.tool === 'line') {
          shapes.push({ tool: 'line', x1: start.x, y1: start.y, x2: curr.x, y2: curr.y, color: stroke.color, size: stroke.size });
        } else if (stroke.tool === 'rect') {
          shapes.push({ tool: 'rect', x: Math.min(start.x, curr.x), y: Math.min(start.y, curr.y), w: Math.abs(curr.x - start.x), h: Math.abs(curr.y - start.y), color: stroke.color, size: stroke.size });
        } else if (stroke.tool === 'circle') {
          const radius = Math.hypot(curr.x - start.x, curr.y - start.y);
          shapes.push({ tool: 'circle', x: start.x, y: start.y, radius: radius, color: stroke.color, size: stroke.size });
        } else if (stroke.tool === 'highlighter') {
          shapes.push({ tool: 'highlighter', points: [...stroke.points], color: stroke.color, size: stroke.size });
        }
      }
      redrawBoard(); 
    }
  }

  activePointers.delete(e.pointerId);

  // If the palm has lifted (drops below 5 fingers), tie off the palm stroke
  if (palmActive && activePointers.size < 5) {
    if (palmPoints.length > 0) {
      shapes.push({
        tool: 'eraser',
        isPalm: true,
        points: [...palmPoints],
        color: '#000000',
        size: 4
      });
    }
    palmActive = false;
    palmPoints = [];
  }

  needsDraftRender = true; 
  
  if (activePointers.size === 0) {
    saveState(); 
  }
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);
canvas.addEventListener('pointerout', handlePointerEnd);
