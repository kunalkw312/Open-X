const PALM_ERASER_RADIUS = 50; 
const CLUSTER_PROXIMITY_RADIUS = 75; 

// Base color palette for horizontal swiping
const SWIPE_COLORS = ['#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'];

let currentTool = 'pen';
let currentColor = '#000000';

const toolMaxSizes = {
  pen: 50, marker: 100, highlighter: 100, eraser: 100,
  line: 50, rect: 50, circle: 50, text: 50
};

const toolSizes = {
  pen: 4, marker: 8, highlighter: 30, eraser: 40,
  line: 4, rect: 4, circle: 4, text: 4
};

let currentSize = toolSizes.pen;
let markerManuallyChanged = false;

// Load persisted background state or default
let currentBgColor = localStorage.getItem('smartboard_bgColor') || '#121212'; 
let currentBgPattern = localStorage.getItem('smartboard_bgPattern') || 'plain'; 

let shapes = []; 
let selectedShapes = [];
let isDragging = false;
let isResizing = false;
let resizeShape = null;
let dragStartX = 0;
let dragStartY = 0;
let lassoBox = null;

const activePointers = new Map(); 
const activeErasers = new Map(); 

let undoStack = [];
let redoStack = [];

let needsDraftRender = false;

// --- PAGE MANAGEMENT ---
let pagesData = [{ shapes: [], undoStack: [], redoStack: [] }];
let currentPageIndex = 0;

// --- CANVAS SETUP (TRI-LAYER ARCHITECTURE) ---
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.style.backgroundColor = 'transparent'; 
canvas.style.zIndex = '1';

const bgCanvas = document.createElement('canvas');
bgCanvas.id = 'bgBoard';
bgCanvas.style.position = 'absolute';
bgCanvas.style.top = '0';
bgCanvas.style.left = '0';
bgCanvas.style.zIndex = '0'; 
bgCanvas.style.touchAction = 'none';
bgCanvas.style.pointerEvents = 'none';
canvas.parentNode.insertBefore(bgCanvas, canvas);
const bgCtx = bgCanvas.getContext('2d');

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

// --- SMART SIZE LOGIC ---
function setToolSize(tool, size) {
  let max = toolMaxSizes[tool] || 50;
  toolSizes[tool] = Math.max(1, Math.min(max, size));

  // Marker is strictly 2x Pen size until explicitly adjusted
  if (tool === 'pen' && !markerManuallyChanged) {
      toolSizes.marker = Math.min(100, toolSizes.pen * 2);
  }
  if (tool === 'marker') {
      markerManuallyChanged = true;
  }

  if (currentTool === tool) {
      currentSize = toolSizes[tool];
  }
}

// --- DYNAMIC UI THEME ENGINE ---
function updateTheme(hex) {
  let r = parseInt(hex.substring(1,3), 16) || 255;
  let g = parseInt(hex.substring(3,5), 16) || 255;
  let b = parseInt(hex.substring(5,7), 16) || 255;
  let brightness = (r * 299 + g * 587 + b * 114) / 1000;
  let isDark = brightness < 130;
  
  let bgR = isDark ? Math.min(255, r + 25) : Math.max(0, r - 15);
  let bgG = isDark ? Math.min(255, g + 25) : Math.max(0, g - 15);
  let bgB = isDark ? Math.min(255, b + 25) : Math.max(0, b - 15);
  
  document.documentElement.style.setProperty('--tb-bg', `rgba(${bgR}, ${bgG}, ${bgB}, 0.85)`);
  document.documentElement.style.setProperty('--tb-border', isDark ? `rgba(255,255,255,0.15)` : `rgba(0,0,0,0.1)`);
  document.documentElement.style.setProperty('--tb-text', isDark ? '#f8fafc' : '#1e293b');
  document.documentElement.style.setProperty('--tb-icon', isDark ? '#cbd5e1' : '#475569');
  document.documentElement.style.setProperty('--tb-hover', isDark ? `rgba(255,255,255,0.15)` : `rgba(0,0,0,0.06)`);
}

// --- BACKGROUND GENERATOR ---
function drawBackground(targetCtx, w, h) {
  targetCtx.fillStyle = currentBgColor;
  targetCtx.fillRect(0, 0, w, h);
  
  let hex = currentBgColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const r = parseInt(hex.substring(0,2), 16) || 255;
  const g = parseInt(hex.substring(2,4), 16) || 255;
  const b = parseInt(hex.substring(4,6), 16) || 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  targetCtx.strokeStyle = brightness > 130 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
  targetCtx.lineWidth = 1;

  if (currentBgPattern === 'grid') {
    const spacing = 40;
    targetCtx.beginPath();
    for (let x = 0; x <= w; x += spacing) { targetCtx.moveTo(x, 0); targetCtx.lineTo(x, h); }
    for (let y = 0; y <= h; y += spacing) { targetCtx.moveTo(0, y); targetCtx.lineTo(w, y); }
    targetCtx.stroke();
  } else if (currentBgPattern === 'lines') {
    const spacing = 40;
    targetCtx.beginPath();
    for (let y = spacing; y <= h; y += spacing) { targetCtx.moveTo(0, y); targetCtx.lineTo(w, y); }
    targetCtx.stroke();
  }
}

// --- DYNAMIC UI INJECTIONS & EVENT BINDINGS ---
document.addEventListener("DOMContentLoaded", () => {
  updateTheme(currentBgColor);

  const customBgInput = document.getElementById('bg-custom');
  if (customBgInput && currentBgColor.startsWith('#')) {
    customBgInput.value = currentBgColor.slice(0, 7);
  }

  // Inject Color Strip UI
  const colorStripContainer = document.getElementById('colorStripContainer');
  if (colorStripContainer) {
    SWIPE_COLORS.forEach((color, i) => {
      const dot = document.createElement('div');
      dot.className = 'color-dot';
      dot.dataset.index = i;
      dot.style.backgroundColor = color;
      if (color === '#ffffff') dot.style.border = '1px solid #cbd5e1';
      colorStripContainer.appendChild(dot);
    });
  }

  const loader = document.createElement('div');
  loader.id = 'export-loader';
  loader.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:999999;display:none;justify-content:center;align-items:center;color:white;font-size:24px;font-weight:bold;backdrop-filter:blur(4px);flex-direction:column;';
  loader.innerHTML = `
    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite; margin-bottom: 16px;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
    Processing... Please wait.
    <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
  `;
  document.body.appendChild(loader);

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'page-picker-modal';
  modalOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);z-index:999998;display:none;justify-content:center;align-items:center;backdrop-filter:blur(4px);';
  modalOverlay.innerHTML = `
    <div style="background:white; border-radius:16px; width:90vw; max-width:850px; height:80vh; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.3); overflow:hidden;">
      <div style="padding:20px 24px; border-bottom:1px solid #e0e4e8; display:flex; justify-content:space-between; align-items:center; background:#ffffff;">
        <h2 style="margin:0; font-size:22px; color:#1e293b; font-weight:700;">Select Pages to Export</h2>
        <div style="display:flex; gap:12px; align-items:center;">
          <button id="selectAllBtn" style="padding:8px 16px; background:#f0f4f8; border:1px solid #e0e4e8; border-radius:8px; cursor:pointer; font-weight:600; color:#5d35ff; font-family:inherit;">Select All / None</button>
          <button id="closeModalBtn" style="background:none; border:none; font-size:32px; cursor:pointer; color:#94a3b8; line-height:1; padding:0; height:32px; width:32px; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>
      </div>
      <div id="pageGrid" style="padding:24px; display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:20px; overflow-y:auto; flex:1; background:#f8f9fa;">
      </div>
      <div style="padding:20px 24px; border-top:1px solid #e0e4e8; display:flex; justify-content:flex-end; gap:12px; background:#ffffff;">
        <button id="cancelExportBtn" style="padding:12px 24px; border:1px solid #cbd5e1; background:white; border-radius:10px; cursor:pointer; font-weight:600; color:#64748b; font-family:inherit; font-size:15px;">Cancel</button>
        <button id="confirmExportBtn" style="padding:12px 32px; border:none; background:#5d35ff; border-radius:10px; cursor:pointer; font-weight:600; color:white; font-family:inherit; font-size:15px; box-shadow:0 4px 12px rgba(93, 53, 255, 0.3);">Export Selected</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalOverlay);

  document.getElementById('closeModalBtn').onclick = closePagePicker;
  document.getElementById('cancelExportBtn').onclick = closePagePicker;
  
  document.getElementById('confirmExportBtn').onclick = () => {
    const cards = document.querySelectorAll('.page-card.selected');
    const selectedIndices = Array.from(cards).map(c => parseInt(c.dataset.index));
    if (selectedIndices.length === 0) {
      alert("Please select at least one page to export.");
      return;
    }
    const callback = pendingExportCallback;
    closePagePicker();
    if(callback) callback(selectedIndices);
  };

  const exportMenu = document.getElementById('exportDropdownMenu');
  const btnMore = document.getElementById('btnMore');
  const moreMenu = document.getElementById('moreDropdownMenu');

  if (btnMore && moreMenu) {
    btnMore.addEventListener('click', (e) => {
      e.stopPropagation();
      moreMenu.classList.toggle('hidden');
      if (exportMenu) exportMenu.classList.add('hidden');
    });
  }

  window.addEventListener('click', (e) => {
    if (!e.target.closest('.export-menu-container')) exportMenu?.classList.add('hidden');
    if (!e.target.closest('.more-menu-container')) moreMenu?.classList.add('hidden');
  });

  window.addEventListener('contextmenu', (e) => {
    if (toolDragActive) e.preventDefault();
  });

  const setBg = (color) => { 
    currentBgColor = color; 
    localStorage.setItem('smartboard_bgColor', color); 
    updateTheme(color);
    redrawBoard(); 
  };
  document.getElementById('bg-white')?.addEventListener('click', () => setBg('#ffffff'));
  document.getElementById('bg-black')?.addEventListener('click', () => setBg('#1e1e1e'));
  document.getElementById('bg-green')?.addEventListener('click', () => setBg('#1a4a28'));
  document.getElementById('bg-custom')?.addEventListener('input', (e) => setBg(e.target.value));

  const setPat = (pat) => { 
    currentBgPattern = pat; 
    localStorage.setItem('smartboard_bgPattern', pat); 
    redrawBoard(); 
  };
  document.getElementById('pat-plain')?.addEventListener('click', () => setPat('plain'));
  document.getElementById('pat-grid')?.addEventListener('click', () => setPat('grid'));
  document.getElementById('pat-lines')?.addEventListener('click', () => setPat('lines'));
});

function handleScreenAutoAdjust() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  [bgCanvas, canvas, draftCanvas].forEach(c => {
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  });
  
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draftCtx.setTransform(1, 0, 0, 1, 0, 0);
  
  bgCtx.scale(dpr, dpr);
  ctx.scale(dpr, dpr);
  draftCtx.scale(dpr, dpr);
  
  redrawBoard();
}

function initCanvas() {
  handleScreenAutoAdjust();
  undoStack = [];
  redoStack = [];
  saveState();
}

window.addEventListener('resize', handleScreenAutoAdjust);
window.addEventListener('orientationchange', handleScreenAutoAdjust);
initCanvas();

function getCoordinates(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function syncCurrentPage() {
  pagesData[currentPageIndex].shapes = JSON.parse(JSON.stringify(shapes));
  pagesData[currentPageIndex].undoStack = [...undoStack];
  pagesData[currentPageIndex].redoStack = [...redoStack];
}

function loadPage(index) {
  syncCurrentPage(); 
  currentPageIndex = index;
  
  shapes = JSON.parse(JSON.stringify(pagesData[currentPageIndex].shapes));
  undoStack = [...pagesData[currentPageIndex].undoStack];
  redoStack = [...pagesData[currentPageIndex].redoStack];
  
  redrawBoard();
  updatePaginationUI();
}

function updatePaginationUI() {
  const pageDisplay = document.getElementById('pageDisplay');
  if (pageDisplay) pageDisplay.textContent = `${currentPageIndex + 1}/${pagesData.length}`;
  
  const prevBtn = document.getElementById('btnPrevPage');
  const nextBtn = document.getElementById('btnNextPage');
  
  if (prevBtn) {
    if (currentPageIndex === 0) prevBtn.classList.add('disabled');
    else prevBtn.classList.remove('disabled');
  }
  if (nextBtn) {
    if (currentPageIndex === pagesData.length - 1) nextBtn.classList.add('disabled');
    else nextBtn.classList.remove('disabled');
  }
}

document.getElementById('btnAddPage')?.addEventListener('click', () => {
  syncCurrentPage();
  pagesData.push({ shapes: [], undoStack: [], redoStack: [] });
  currentPageIndex = pagesData.length - 1;
  
  shapes = [];
  undoStack = [];
  redoStack = [];
  saveState();
  redrawBoard();
  updatePaginationUI();
});

document.getElementById('btnPrevPage')?.addEventListener('click', () => {
  if (currentPageIndex > 0) loadPage(currentPageIndex - 1);
});

document.getElementById('btnNextPage')?.addEventListener('click', () => {
  if (currentPageIndex < pagesData.length - 1) loadPage(currentPageIndex + 1);
});

// --- GLOBAL DIRECT SWIPE LOGIC (NO TIMER) ---
const sizePopover = document.getElementById('size-popover');
const sizeValueDisplay = document.getElementById('sizeValue');
const sizePreviewCircle = document.getElementById('sizePreviewCircle');
const colorPicker = document.getElementById('colorPicker');

let toolDragActive = false;
let dragAxis = null; // 'x' for color, 'y' for size
let toolDragLastY = 0;
let toolDragStartX = 0;
let toolDragStartY = 0;
let swipeColorIndex = 0;

function updateSizePreview() {
  if (sizePreviewCircle) {
    sizePreviewCircle.style.width = `${currentSize}px`;
    sizePreviewCircle.style.height = `${currentSize}px`;
    sizePreviewCircle.style.backgroundColor = currentColor;
  }
}

function updateColorStrip() {
  document.querySelectorAll('.color-dot').forEach((dot, i) => {
    if (i === swipeColorIndex) {
      dot.style.transform = 'scale(1.5)';
      dot.style.boxShadow = '0 0 0 2px var(--tb-bg), 0 0 0 4px var(--tb-text)';
    } else {
      dot.style.transform = 'scale(1)';
      dot.style.boxShadow = 'none';
    }
  });
}

function handleToolAction(selectedTool) {
  if (selectedTool === 'sticky') {
    createStickyNote();
    return;
  }
  if (selectedTool === 'image') {
    document.getElementById('imageInput')?.click();
    return;
  }
  if (selectedTool === 'text') {
    currentTool = 'text';
    const textVal = prompt("Enter Text:");
    if (textVal) {
      shapes.push({
        tool: 'text',
        text: textVal,
        x: window.innerWidth / 2 - 50,
        y: window.innerHeight / 2,
        color: currentColor,
        size: currentSize,
        w: textVal.length * currentSize * 3,
        h: currentSize * 5
      });
      saveState();
      redrawBoard();
    }
    document.getElementById('moreDropdownMenu')?.classList.add('hidden');
    return;
  }
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.tool-trigger');
  if (trigger) {
    handleToolAction(trigger.dataset.tool);
  }
});

// 1. Tool Pressed - Set Active immediately and capture pointer for IFP tracking
document.querySelectorAll('.tool').forEach(button => {
  button.oncontextmenu = (e) => e.preventDefault();

  button.addEventListener('pointerdown', (e) => {
    const selectedTool = e.currentTarget.dataset.tool;
    if (!selectedTool) return;

    if (['sticky', 'image', 'text'].includes(selectedTool)) {
      handleToolAction(selectedTool);
      return;
    }

    // Instantly activate tool
    document.querySelectorAll('.tool[data-tool]').forEach(btn => btn.classList.remove('active'));
    e.currentTarget.classList.add('active');
    
    currentTool = selectedTool;
    currentSize = toolSizes[currentTool];
    updateSizePreview();

    if (['pen', 'marker', 'highlighter', 'eraser', 'line', 'rect', 'circle'].includes(currentTool)) {
      toolDragActive = true;
      dragAxis = null;
      toolDragStartX = e.clientX;
      toolDragStartY = e.clientY;
      toolDragLastY = e.clientY;

      swipeColorIndex = SWIPE_COLORS.indexOf(currentColor);
      if (swipeColorIndex === -1) swipeColorIndex = 0;

      // CRITICAL IFP FIX: Forces the panel to keep tracking this finger even outside the button
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch(err) {}
    }
  });

  // Ensure capture is cleanly released when finishing the gesture
  button.addEventListener('pointerup', (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err) {}
    if (toolDragActive) {
      toolDragActive = false;
      dragAxis = null;
      if (sizePopover) sizePopover.classList.add('hidden');
    }
  });

  button.addEventListener('pointercancel', (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err) {}
    if (toolDragActive) {
      toolDragActive = false;
      dragAxis = null;
      if (sizePopover) sizePopover.classList.add('hidden');
    }
  });
});

// 2. Track Finger Globally - Lock Axis on first 15px movement
window.addEventListener('pointermove', (e) => {
  if (toolDragActive) {
    let dx = e.clientX - toolDragStartX;
    let dy = e.clientY - toolDragStartY;

    // Determine Axis if not locked yet
    if (!dragAxis) {
      if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
        dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        
        if (sizePopover) {
          sizePopover.classList.remove('hidden');
          sizePopover.style.position = 'fixed';
          sizePopover.style.left = `${toolDragStartX}px`;
          sizePopover.style.top = `${toolDragStartY - 160}px`;
          
          if (dragAxis === 'x') {
             document.getElementById('sizePreviewContainer').style.display = 'none';
             document.getElementById('sizeValue').style.display = 'none';
             document.getElementById('colorStripContainer').style.display = 'flex';
             updateColorStrip();
          } else {
             document.getElementById('sizePreviewContainer').style.display = 'flex';
             document.getElementById('sizeValue').style.display = 'block';
             document.getElementById('colorStripContainer').style.display = 'none';
             updateSizePreview();
          }
        }
      }
    }

    // Process Movement based on locked Axis
    if (dragAxis) {
      e.preventDefault(); 
      
      if (dragAxis === 'y') {
        let stepY = toolDragLastY - e.clientY;
        toolDragLastY = e.clientY; 
        let newSize = currentSize + (stepY * 0.8);
        setToolSize(currentTool, newSize);
        if (sizeValueDisplay) sizeValueDisplay.textContent = `${Math.round(currentSize)}px`;
        updateSizePreview();
      } 
      else if (dragAxis === 'x') {
        let colorShift = Math.floor((e.clientX - toolDragStartX) / 35); 
        if (Math.abs(colorShift) > 0) {
           swipeColorIndex = (swipeColorIndex + colorShift) % SWIPE_COLORS.length;
           if (swipeColorIndex < 0) swipeColorIndex += SWIPE_COLORS.length;
           currentColor = SWIPE_COLORS[swipeColorIndex];
           
           const cPicker = document.getElementById('colorPicker');
           if (cPicker) cPicker.value = currentColor;
           
           toolDragStartX = e.clientX; 
           updateColorStrip();
        }
      }
      
      if (sizePopover) {
          sizePopover.style.left = `${e.clientX}px`;
          sizePopover.style.top = `${e.clientY - 160}px`;
      }
    }
  }
}, { passive: false });

// 3. Clear State globally when finger lifts
// Global Clear State for Window
window.addEventListener('pointerup', (e) => {
  if (toolDragActive && !e.target.closest('.tool')) {
    toolDragActive = false;
    dragAxis = null;
    if (sizePopover) sizePopover.classList.add('hidden');
  }
});
window.addEventListener('pointercancel', (e) => {
  if (toolDragActive) {
    toolDragActive = false;
    dragAxis = null;
    if (sizePopover) sizePopover.classList.add('hidden');
  }
});

colorPicker?.addEventListener('input', (e) => {
  currentColor = e.target.value;
  updateSizePreview();
});

document.getElementById('btnClear')?.addEventListener('click', () => {
  shapes = []; 
  selectedShapes = []; 
  lassoBox = null;
  isDragging = false;
  isResizing = false;
  saveState();
  redrawBoard();
});

const btnMainExport = document.getElementById('btnMainExport');
const exportDropdownMenu = document.getElementById('exportDropdownMenu');

if (btnMainExport && exportDropdownMenu) {
  btnMainExport.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdownMenu.classList.toggle('hidden');
    document.getElementById('moreDropdownMenu')?.classList.add('hidden');
  });
}

// --- IMAGE IMPORT HANDLER ---
const imageInput = document.getElementById('imageInput');
if (imageInput) {
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 300;
        const scale = maxWidth / img.width;
        shapes.push({
          tool: 'image',
          imgObj: img,
          imgSrc: event.target.result,
          x: window.innerWidth / 2 - maxWidth / 2,
          y: window.innerHeight / 2 - (img.height * scale) / 2,
          w: maxWidth,
          h: img.height * scale
        });
        saveState();
        redrawBoard();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    document.getElementById('moreDropdownMenu')?.classList.add('hidden');
  });
}

// --- UNIVERSAL OFFSCREEN RENDERER (For PDFs & Thumbnails) ---
function renderShapesToCanvas(targetCtx, pageShapes, scaleMultiplier, width, height) {
  targetCtx.save();
  drawBackground(targetCtx, width, height);
  targetCtx.scale(scaleMultiplier, scaleMultiplier);
  
  pageShapes.forEach(stroke => {
    if (['image', 'text', 'line', 'rect', 'circle'].includes(stroke.tool)) {
      targetCtx.save();
      if (stroke.tool === 'image' && stroke.imgObj) {
        targetCtx.drawImage(stroke.imgObj, stroke.x, stroke.y, stroke.w, stroke.h);
      } else if (stroke.tool === 'text') {
        targetCtx.font = `${stroke.size * 5}px sans-serif`;
        targetCtx.fillStyle = stroke.color;
        targetCtx.fillText(stroke.text, stroke.x, stroke.y + stroke.size * 4);
      } else {
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.strokeStyle = stroke.color;
        targetCtx.lineWidth = stroke.size;
        drawShapePath(targetCtx, stroke);
      }
      targetCtx.restore();
    }
  });
  targetCtx.restore();

  const inkCanvas = document.createElement('canvas');
  inkCanvas.width = width;
  inkCanvas.height = height;
  const inkCtx = inkCanvas.getContext('2d');
  inkCtx.scale(scaleMultiplier, scaleMultiplier);

  pageShapes.forEach(stroke => {
    if (['pen', 'marker', 'highlighter', 'eraser'].includes(stroke.tool)) {
      inkCtx.save();
      if (stroke.tool === 'highlighter') {
        inkCtx.globalAlpha = 0.35;
        inkCtx.globalCompositeOperation = 'source-over'; 
        inkCtx.lineWidth = stroke.size;
      } else {
        inkCtx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        const eraserSize = stroke.isPalm ? (PALM_ERASER_RADIUS * 2) : stroke.size;
        inkCtx.lineWidth = stroke.tool === 'eraser' ? eraserSize : stroke.size;
      }
      inkCtx.lineCap = 'round';
      inkCtx.lineJoin = 'round';
      inkCtx.strokeStyle = stroke.color;
      
      inkCtx.beginPath();
      const pts = stroke.points;
      if (pts && pts.length > 0) {
        inkCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mid = { x: (pts[i].x + pts[i+1].x) / 2, y: (pts[i].y + pts[i+1].y) / 2 };
          inkCtx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
        }
        inkCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      inkCtx.stroke();
      inkCtx.restore();
    }
  });

  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.drawImage(inkCanvas, 0, 0);
  targetCtx.restore();
}

function generatePageImage(pageShapes, scaleForThumb = 0.15, quality = 0.75) {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const physicalW = cssW * scaleForThumb;
  const physicalH = cssH * scaleForThumb;
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = physicalW;
  tempCanvas.height = physicalH;
  const tCtx = tempCanvas.getContext('2d');
  
  renderShapesToCanvas(tCtx, pageShapes, scaleForThumb, physicalW, physicalH);
  return tempCanvas.toDataURL('image/jpeg', quality);
}

// --- VISUAL PAGE PICKER MODAL ENGINE ---
let pendingExportCallback = null;

function openPagePicker(callback) {
  syncCurrentPage();
  pendingExportCallback = callback;
  
  const modal = document.getElementById('page-picker-modal');
  const grid = document.getElementById('pageGrid');
  grid.innerHTML = '';
  
  pagesData.forEach((page, index) => {
    const thumbUrl = generatePageImage(page.shapes, 0.15, 0.5); 
    
    const card = document.createElement('div');
    card.className = 'page-card selected'; 
    card.dataset.index = index;
    card.style.cssText = 'border:3px solid #5d35ff; border-radius:12px; background:white; cursor:pointer; overflow:hidden; position:relative; box-shadow:0 4px 12px rgba(0,0,0,0.08); transition:transform 0.1s;';
    
    card.innerHTML = `
      <div style="padding:10px 14px; background:#f0f4f8; border-bottom:1px solid #e0e4e8; font-size:14px; font-weight:700; color:#334155; display:flex; justify-content:space-between; align-items:center;">
        <span>Page ${index + 1}</span>
        <div class="check-icon" style="height:20px; width:20px; background:#5d35ff; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px;">✓</div>
      </div>
      <div style="height:140px; width:100%; display:flex; justify-content:center; align-items:center; background:#e2e8f0; position:relative;">
        <img src="${thumbUrl}" style="max-width:100%; max-height:100%; object-fit:contain; pointer-events:none;" />
      </div>
    `;
    
    card.addEventListener('click', () => {
      card.classList.toggle('selected');
      if (card.classList.contains('selected')) {
        card.style.borderColor = '#5d35ff';
        card.querySelector('.check-icon').style.background = '#5d35ff';
        card.querySelector('.check-icon').style.color = 'white';
      } else {
        card.style.borderColor = 'transparent';
        card.querySelector('.check-icon').style.background = '#cbd5e1';
        card.querySelector('.check-icon').style.color = 'transparent';
      }
    });
    grid.appendChild(card);
  });
  
  document.getElementById('selectAllBtn').onclick = () => {
    const cards = grid.querySelectorAll('.page-card');
    const allSelected = Array.from(cards).every(c => c.classList.contains('selected'));
    
    cards.forEach(card => {
       if (allSelected) {
         card.classList.remove('selected');
         card.style.borderColor = 'transparent';
         card.querySelector('.check-icon').style.background = '#cbd5e1';
         card.querySelector('.check-icon').style.color = 'transparent';
       } else {
         card.classList.add('selected');
         card.style.borderColor = '#5d35ff';
         card.querySelector('.check-icon').style.background = '#5d35ff';
         card.querySelector('.check-icon').style.color = 'white';
       }
    });
  };

  modal.style.display = 'flex';
}

function closePagePicker() {
  document.getElementById('page-picker-modal').style.display = 'none';
  pendingExportCallback = null;
}

// --- EXPORT SAVING ---
function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
}

document.getElementById('btnSaveCurrent')?.addEventListener('click', () => {
  let fileName = prompt("Enter a file name for this page:", `smartboard-page-${currentPageIndex + 1}`);
  if (!fileName) return; 
  if (!fileName.endsWith('.oxsb')) fileName += '.oxsb';

  syncCurrentPage();
  const singlePageData = {
    version: "1.1",
    pages: [{
      shapes: pagesData[currentPageIndex].shapes.map(s => {
        if (s.tool === 'image') return { ...s, imgObj: null };
        return s;
      })
    }]
  };
  downloadFile(fileName, JSON.stringify(singlePageData));
});

document.getElementById('btnSaveAll')?.addEventListener('click', () => {
  openPagePicker((exportIndices) => {
    let fileName = prompt("Enter a file name for this project:", "smartboard-document");
    if (!fileName) return; 
    if (!fileName.endsWith('.oxsb')) fileName += '.oxsb';

    const exportPages = exportIndices.map(idx => ({
      shapes: pagesData[idx].shapes.map(s => {
        if (s.tool === 'image') return { ...s, imgObj: null };
        return s;
      })
    }));

    downloadFile(fileName, JSON.stringify({ version: "1.1", pages: exportPages }));
  });
});

const btnOpenDoc = document.getElementById('btnOpenDoc');
const projectInput = document.getElementById('projectInput');
if (btnOpenDoc && projectInput) {
  btnOpenDoc.addEventListener('click', () => projectInput.click());
  projectInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.pages && Array.isArray(data.pages)) {
          pagesData = data.pages.map(p => ({
            shapes: p.shapes.map(s => {
              if (s.tool === 'image' && s.imgSrc) {
                const img = new Image();
                img.src = s.imgSrc;
                return { ...s, imgObj: img };
              }
              return s;
            }),
            undoStack: [], redoStack: []
          }));
          loadPage(0);
        }
      } catch (err) { alert("Invalid board document file."); }
    };
    reader.readAsText(file);
  });
}

document.getElementById('btnExportPDF')?.addEventListener('click', async () => {
  openPagePicker((exportIndices) => {
    let fileName = prompt("Enter a file name for your PDF:", "smartboard-document");
    if (!fileName) return;
    if (!fileName.endsWith('.pdf')) fileName += '.pdf';

    if (!window.jspdf) {
      alert("PDF library is missing. Check your internet connection.");
      return;
    }
    
    const loader = document.getElementById('export-loader');
    if(loader) loader.style.display = 'flex';

    setTimeout(() => {
      try {
        const { jsPDF } = window.jspdf;
        
        const MAX_EXPORT_WIDTH = 2560; 
        const cssW = window.innerWidth;
        const cssH = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        
        let exportScale = dpr;
        if ((cssW * dpr) > MAX_EXPORT_WIDTH) {
          exportScale = MAX_EXPORT_WIDTH / cssW;
        }
        const exportWidth = cssW * exportScale;
        const exportHeight = cssH * exportScale;

        const pdf = new jsPDF('landscape', 'px', [exportWidth, exportHeight]);
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = exportWidth;
        tempCanvas.height = exportHeight;
        const tCtx = tempCanvas.getContext('2d');

        exportIndices.forEach((pageIdx, step) => {
          renderShapesToCanvas(tCtx, pagesData[pageIdx].shapes, exportScale, exportWidth, exportHeight);
          const imgData = tempCanvas.toDataURL('image/jpeg', 0.7);
          if (step > 0) pdf.addPage([exportWidth, exportHeight], 'landscape');
          pdf.addImage(imgData, 'JPEG', 0, 0, exportWidth, exportHeight);
        });

        pdf.save(fileName);

      } catch (error) {
        console.error("PDF Export failed:", error);
        alert("An error occurred. The board might be too large for the device memory.");
      } finally {
        if(loader) loader.style.display = 'none';
      }
    }, 50);
  });
});

// --- DATA-DRIVEN UNDO / REDO ---
function saveState() {
  undoStack.push(JSON.parse(JSON.stringify(shapes.map(s => {
    if (s.tool === 'image') return { ...s, imgObj: null }; 
    return s;
  }))));
  
  undoStack[undoStack.length - 1].forEach((s, idx) => {
    if (s.tool === 'image') s.imgObj = shapes[idx].imgObj;
  });

  redoStack = []; 
}

document.getElementById('btnUndo')?.addEventListener('click', () => {
  if (undoStack.length > 1) {
    redoStack.push(undoStack.pop());
    const restoredState = undoStack[undoStack.length - 1];
    shapes = JSON.parse(JSON.stringify(restoredState));
    
    shapes.forEach((s, idx) => {
      if (s.tool === 'image') s.imgObj = restoredState[idx].imgObj;
    });
    redrawBoard();
  }
});

document.getElementById('btnRedo')?.addEventListener('click', () => {
  if (redoStack.length > 0) {
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    shapes = JSON.parse(JSON.stringify(nextState));
    
    shapes.forEach((s, idx) => {
      if (s.tool === 'image') s.imgObj = nextState[idx].imgObj;
    });
    redrawBoard();
  }
});

// --- MULTI-TOUCH CLUSTER ENGINE (N-FINGER DETECTION) ---
function getClusters(pointersMap, radius) {
  const pointers = Array.from(pointersMap.entries()).map(([id, data]) => {
    const lastPt = data.points[data.points.length - 1];
    return { id, x: lastPt.x, y: lastPt.y, data };
  });

  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < pointers.length; i++) {
    if (visited.has(pointers[i].id)) continue;
    const cluster = [pointers[i]];
    visited.add(pointers[i].id);
    let queue = [pointers[i]];
    
    while (queue.length > 0) {
      const current = queue.shift();
      for (let j = 0; j < pointers.length; j++) {
        if (!visited.has(pointers[j].id)) {
          const dist = Math.hypot(current.x - pointers[j].x, current.y - pointers[j].y);
          if (dist <= radius) {
            visited.add(pointers[j].id);
            cluster.push(pointers[j]);
            queue.push(pointers[j]);
          }
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function processEraserClusters() {
  if (activePointers.size === 0 && activeErasers.size === 0) return;
  const clusters = getClusters(activePointers, CLUSTER_PROXIMITY_RADIUS);
  const currentEraserIds = new Set();

  clusters.forEach(cluster => {
    if (cluster.length >= 2) {
      const cx = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
      const cy = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;
      const clusterId = cluster.map(p => p.id).sort().join('_');
      currentEraserIds.add(clusterId);

      cluster.forEach(p => p.data.isInvalidated = true);

      let eStroke = activeErasers.get(clusterId);
      if (!eStroke) {
        eStroke = { tool: 'eraser', isPalm: true, color: '#000000', size: 4, points: [] };
        activeErasers.set(clusterId, eStroke);
      }
      eStroke.points.push({ x: cx, y: cy });
      
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(cx, cy, PALM_ERASER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      needsDraftRender = true;
    }
  });

  for (const [eId, eStroke] of activeErasers.entries()) {
    if (!currentEraserIds.has(eId)) {
      if (eStroke.points.length > 0) {
        shapes.push({
          tool: 'eraser',
          isPalm: true,
          points: [...eStroke.points],
          color: '#000000',
          size: 4
        });
      }
      activeErasers.delete(eId);
    }
  }
}

function drawShapePath(targetCtx, stroke) {
  targetCtx.beginPath();
  if (stroke.tool === 'line') {
    targetCtx.moveTo(stroke.x1, stroke.y1);
    targetCtx.lineTo(stroke.x2, stroke.y2);
  } else if (stroke.tool === 'rect') {
    targetCtx.rect(stroke.x, stroke.y, stroke.w, stroke.h);
  } else if (stroke.tool === 'circle') {
    targetCtx.arc(stroke.x, stroke.y, stroke.radius, 0, Math.PI * 2);
  }
  targetCtx.stroke();
}

function getResizeHandleAtPosition(x, y) {
  if (selectedShapes.length === 1) {
    const s = selectedShapes[0];
    let hx, hy;
    if (['rect', 'image', 'text'].includes(s.tool)) {
      hx = s.x + (s.w || 100);
      hy = s.y + (s.h || 40);
    } else if (s.tool === 'circle') {
      hx = s.x + s.radius;
      hy = s.y + s.radius;
    } else if (['pen', 'marker', 'highlighter'].includes(s.tool) && s.points && s.points.length > 0) {
      let maxX = -Infinity, maxY = -Infinity;
      s.points.forEach(p => {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      hx = maxX;
      hy = maxY;
    }
    if (hx && hy) {
      if (Math.hypot(x - hx, y - hy) <= 15) return s;
    }
  }
  return null;
}

function getShapeAtPosition(x, y) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.tool === 'rect' || s.tool === 'image' || s.tool === 'text') {
      const minX = Math.min(s.x, s.x + (s.w || 100));
      const maxX = Math.max(s.x, s.x + (s.w || 100));
      const minY = Math.min(s.y, s.y + (s.h || 40));
      const maxY = Math.max(s.y, s.y + (s.h || 40));
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return [s];
    } else if (s.tool === 'circle') {
      const dist = Math.hypot(x - s.x, y - s.y);
      if (dist <= s.radius) return [s];
    } else if (s.tool === 'line') {
      const minX = Math.min(s.x1, s.x2) - 10;
      const maxX = Math.max(s.x1, s.x2) + 10;
      const minY = Math.min(s.y1, s.y2) - 10;
      const maxY = Math.max(s.y1, s.y2) + 10;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return [s];
    } else if (['pen', 'marker', 'highlighter'].includes(s.tool)) {
      if (s.points && s.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        s.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
        const padding = 15;
        if (x >= minX - padding && x <= maxX + padding && y >= minY - padding && y <= maxY + padding) {
          return [s];
        }
      }
    }
  }
  return [];
}

// --- TRI-LAYER SCREEN REDRAW ---
function redrawBoard() {
  bgCtx.save();
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  drawBackground(bgCtx, bgCanvas.width, bgCanvas.height);
  bgCtx.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  shapes.forEach(stroke => {
    if (['image', 'text', 'line', 'rect', 'circle'].includes(stroke.tool)) {
      bgCtx.save();
      if (stroke.tool === 'image' && stroke.imgObj) {
        bgCtx.drawImage(stroke.imgObj, stroke.x, stroke.y, stroke.w, stroke.h);
      } else if (stroke.tool === 'text') {
        bgCtx.font = `${stroke.size * 5}px sans-serif`;
        bgCtx.fillStyle = stroke.color;
        bgCtx.fillText(stroke.text, stroke.x, stroke.y + stroke.size * 4);
      } else {
        bgCtx.globalCompositeOperation = 'source-over';
        bgCtx.lineCap = 'round';
        bgCtx.lineJoin = 'round';
        bgCtx.strokeStyle = stroke.color;
        bgCtx.lineWidth = stroke.size;
        drawShapePath(bgCtx, stroke);
      }
      bgCtx.restore();
    } 
    else if (['pen', 'marker', 'highlighter', 'eraser'].includes(stroke.tool)) {
      ctx.save();
      if (stroke.tool === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.lineWidth = stroke.size;
      } else {
        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        const eraserSize = stroke.isPalm ? (PALM_ERASER_RADIUS * 2) : stroke.size;
        ctx.lineWidth = stroke.tool === 'eraser' ? eraserSize : stroke.size;
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
      ctx.restore();
    }
  });

  // UI OVERLAYS
  selectedShapes.forEach(stroke => {
    ctx.save();
    ctx.strokeStyle = '#5d35ff'; 
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    let hx = 0, hy = 0;
    
    if (['rect', 'image', 'text'].includes(stroke.tool)) {
      ctx.strokeRect(stroke.x - 4, stroke.y - 4, (stroke.w || 100) + 8, (stroke.h || 40) + 8);
      hx = stroke.x + (stroke.w || 100);
      hy = stroke.y + (stroke.h || 40);
    } else if (stroke.tool === 'circle') {
      ctx.beginPath();
      ctx.arc(stroke.x, stroke.y, stroke.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      hx = stroke.x + stroke.radius;
      hy = stroke.y + stroke.radius;
    } else if (['pen', 'marker', 'highlighter'].includes(stroke.tool) && stroke.points && stroke.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      stroke.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      ctx.strokeRect(minX - 6, minY - 6, (maxX - minX) + 12, (maxY - minY) + 12);
      hx = maxX;
      hy = maxY;
    }

    if (hx && hy && selectedShapes.length === 1) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hx, hy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  });

  if (lassoBox) {
    ctx.save();
    ctx.strokeStyle = '#5d35ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(lassoBox.x, lassoBox.y, lassoBox.w, lassoBox.h);
    ctx.restore();
  }
}

// --- OPTIMIZED DRAFT RENDER LOOP ---
function renderDraftLayer() {
  if (needsDraftRender) {
    draftCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    activePointers.forEach(stroke => {
      if (!stroke.isInvalidated) {
        if (stroke.tool === 'highlighter') {
          draftCtx.save();
          draftCtx.globalAlpha = 0.35;
          draftCtx.lineCap = 'round';
          draftCtx.lineJoin = 'round';
          draftCtx.strokeStyle = stroke.color;
          draftCtx.lineWidth = stroke.size;
          draftCtx.beginPath();
          draftCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const mid = { x: (stroke.points[i].x + stroke.points[i+1].x) / 2, y: (stroke.points[i].y + stroke.points[i+1].y) / 2 };
            draftCtx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mid.x, mid.y);
          }
          draftCtx.lineTo(stroke.points[stroke.points.length-1].x, stroke.points[stroke.points.length-1].y);
          draftCtx.stroke();
          draftCtx.restore();
        } else if (['line', 'rect', 'circle'].includes(stroke.tool)) {
          draftCtx.save();
          draftCtx.lineCap = 'round';
          draftCtx.lineJoin = 'round';
          draftCtx.strokeStyle = stroke.color;
          draftCtx.lineWidth = stroke.size;
          
          const pts = stroke.points;
          if (pts.length >= 2) {
             const start = pts[0];
             const curr = pts[pts.length - 1];
             
             draftCtx.beginPath();
             if (stroke.tool === 'line') {
               draftCtx.moveTo(start.x, start.y);
               draftCtx.lineTo(curr.x, curr.y);
             } else if (stroke.tool === 'rect') {
               draftCtx.rect(Math.min(start.x, curr.x), Math.min(start.y, curr.y), Math.abs(curr.x - start.x), Math.abs(curr.y - start.y));
             } else if (stroke.tool === 'circle') {
               const radius = Math.hypot(curr.x - start.x, curr.y - start.y);
               draftCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
             }
             draftCtx.stroke();
          }
          draftCtx.restore();
        }
      }
    });

    activeErasers.forEach(eStroke => {
      if (eStroke.points.length > 0) {
        const pt = eStroke.points[eStroke.points.length - 1];
        draftCtx.globalCompositeOperation = 'source-over';
        draftCtx.beginPath();
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

// --- POINTER LISTENERS & SELECT MODE ---

canvas.addEventListener('pointerdown', (e) => {
  if (toolDragActive) return;

  e.preventDefault();
  
  try { canvas.setPointerCapture(e.pointerId); } catch(err) {}

  const coords = getCoordinates(e.clientX, e.clientY);
  const tool = e.pointerType === 'eraser' ? 'eraser' : currentTool;

  if (tool === 'select') {
    const handleShape = getResizeHandleAtPosition(coords.x, coords.y);
    if (handleShape) {
      isResizing = true;
      resizeShape = handleShape;
      dragStartX = coords.x;
      dragStartY = coords.y;
      return;
    }

    selectedShapes = getShapeAtPosition(coords.x, coords.y);
    isDragging = true;
    dragStartX = coords.x;
    dragStartY = coords.y;
    if (selectedShapes.length === 0) {
      lassoBox = { x: coords.x, y: coords.y, w: 0, h: 0 };
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

  processEraserClusters();

  const stroke = activePointers.get(e.pointerId);
  if (stroke && !stroke.isInvalidated && ['pen', 'marker', 'eraser'].includes(tool)) {
    ctx.save();
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    const activeRadius = currentSize / 2;
    ctx.arc(coords.x, coords.y, activeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
});


canvas.addEventListener('pointermove', (e) => {
  if (toolDragActive) return;
  e.preventDefault();
  const coords = getCoordinates(e.clientX, e.clientY);

  if (currentTool === 'select') {
    const dx = coords.x - dragStartX;
    const dy = coords.y - dragStartY;

    if (isResizing && resizeShape) {
      if (['rect', 'image'].includes(resizeShape.tool)) {
        resizeShape.w = Math.max(10, resizeShape.w + dx);
        resizeShape.h = Math.max(10, resizeShape.h + dy);
      } else if (resizeShape.tool === 'circle') {
        resizeShape.radius = Math.max(5, resizeShape.radius + Math.max(dx, dy));
      } else if (resizeShape.tool === 'text') {
        resizeShape.size = Math.max(1, resizeShape.size + (dx * 0.1));
        resizeShape.w = resizeShape.text.length * resizeShape.size * 3;
        resizeShape.h = resizeShape.size * 5;
      } else if (['pen', 'marker', 'highlighter'].includes(resizeShape.tool)) {
        let minX = Infinity, minY = Infinity;
        resizeShape.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
        });
        const scaleX = 1 + (dx / 200);
        const scaleY = 1 + (dy / 200);
        resizeShape.points.forEach(p => {
          p.x = minX + (p.x - minX) * scaleX;
          p.y = minY + (p.y - minY) * scaleY;
        });
      }
      dragStartX = coords.x;
      dragStartY = coords.y;
      redrawBoard();
      return;
    }

    if (isDragging) {
      if (selectedShapes.length > 0) {
        selectedShapes.forEach(selectedShape => {
          if (['rect', 'circle', 'image', 'text'].includes(selectedShape.tool)) {
            selectedShape.x += dx;
            selectedShape.y += dy;
          } else if (selectedShape.tool === 'line') {
            selectedShape.x1 += dx;
            selectedShape.y1 += dy;
            selectedShape.x2 += dx;
            selectedShape.y2 += dy;
          } else if (selectedShape.points) {
            selectedShape.points.forEach(p => { p.x += dx; p.y += dy; });
          }
        });
      } else if (lassoBox) {
        lassoBox.w = coords.x - lassoBox.x;
        lassoBox.h = coords.y - lassoBox.y;
      }
      dragStartX = coords.x;
      dragStartY = coords.y;
      redrawBoard();
      return;
    }
  }

  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  
  for (let i = 0; i < events.length; i++) {
    stroke.points.push(getCoordinates(events[i].clientX, events[i].clientY));
  }

  if (activePointers.size >= 2 || activeErasers.size > 0) {
    processEraserClusters();
  }

  if (!stroke.isInvalidated) {
    if (['pen', 'marker', 'eraser'].includes(stroke.tool)) {
      if (stroke.points.length >= 3) {
        ctx.save();
        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.color;
        const eraserSize = stroke.isPalm ? (PALM_ERASER_RADIUS * 2) : stroke.size;
        ctx.lineWidth = stroke.tool === 'eraser' ? eraserSize : stroke.size;

        ctx.beginPath();
        let idx = stroke.lastRenderedIndex;
        
        if (idx === 1) {
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          const midX = (stroke.points[1].x + stroke.points[2].x) / 2;
          const midY = (stroke.points[1].y + stroke.points[2].y) / 2;
          ctx.quadraticCurveTo(stroke.points[1].x, stroke.points[1].y, midX, midY);
          stroke.lastRenderedIndex = 2;
        }
        
        while (stroke.lastRenderedIndex < stroke.points.length - 1) {
          idx = stroke.lastRenderedIndex;
          const p0 = stroke.points[idx];
          const p1 = stroke.points[idx+1];
          
          const prevMidX = (stroke.points[idx-1].x + p0.x) / 2;
          const prevMidY = (stroke.points[idx-1].y + p0.y) / 2;
          const nextMidX = (p0.x + p1.x) / 2;
          const nextMidY = (p0.y + p1.y) / 2;
          
          ctx.moveTo(prevMidX, prevMidY);
          ctx.quadraticCurveTo(p0.x, p0.y, nextMidX, nextMidY);
          
          stroke.lastRenderedIndex++;
        }
        
        ctx.stroke();
        ctx.restore();
      }
    }
    if (stroke.tool === 'highlighter' || ['line', 'rect', 'circle'].includes(stroke.tool)) {
      needsDraftRender = true;
    }
  }
});

function handlePointerEnd(e) {
  if (toolDragActive) return;
  e.preventDefault();
  
  try { canvas.releasePointerCapture(e.pointerId); } catch(err) {}

  if (currentTool === 'select') {
    if (isResizing) {
      isResizing = false;
      resizeShape = null;
      saveState();
      return;
    }
    if (isDragging) {
      isDragging = false;
      if (lassoBox) {
        const lx1 = Math.min(lassoBox.x, lassoBox.x + lassoBox.w);
        const lx2 = Math.max(lassoBox.x, lassoBox.x + lassoBox.w);
        const ly1 = Math.min(lassoBox.y, lassoBox.y + lassoBox.h);
        const ly2 = Math.max(lassoBox.y, lassoBox.y + lassoBox.h);

        selectedShapes = shapes.filter(s => {
          if (s.x >= lx1 && s.x <= lx2 && s.y >= ly1 && s.y <= ly2) return true;
          if (s.points && s.points.some(p => p.x >= lx1 && p.x <= lx2 && p.y >= ly1 && p.y <= ly2)) return true;
          return false;
        });
        lassoBox = null;
      }
      redrawBoard();
      saveState();
    }
    return;
  }

  if (!activePointers.has(e.pointerId)) return;

  const stroke = activePointers.get(e.pointerId);

  if (!stroke.isInvalidated) {
    if (['pen', 'marker', 'highlighter', 'eraser'].includes(stroke.tool) && stroke.points.length >= 2) {
      shapes.push({
        tool: stroke.tool,
        points: [...stroke.points],
        color: stroke.color,
        size: stroke.size,
        isPalm: false 
      });
      redrawBoard();
    }

    if (['line', 'rect', 'circle'].includes(stroke.tool)) {
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
        }
      }
      redrawBoard(); 
    }
  }

  activePointers.delete(e.pointerId);
  processEraserClusters();
  needsDraftRender = true; 

  if (activePointers.size === 0) {
    saveState(); 
  }
}

canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);
canvas.addEventListener('pointerout', handlePointerEnd);

// --- STICKY NOTE ENGINE ---
function createStickyNote(x = window.innerWidth / 2 - 90, y = window.innerHeight / 2 - 90) {
  const note = document.createElement('div');
  note.className = 'sticky-note';
  note.style.left = `${x}px`;
  note.style.top = `${y}px`;
  note.style.zIndex = '9999';

  const noteBg = currentColor === '#000000' ? '#fef08a' : currentColor;
  note.style.backgroundColor = noteBg;

  note.innerHTML = `
    <div class="sticky-header">
      <span class="sticky-title">NOTE</span>
      <button class="sticky-delete" title="Delete Note">✕</button>
    </div>
    <textarea class="sticky-textarea" placeholder="Type here..."></textarea>
  `;

  note.querySelector('.sticky-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    note.remove();
  });

  let isDraggingNote = false;
  let offsetX = 0;
  let offsetY = 0;

  note.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    isDraggingNote = true;
    offsetX = e.clientX - note.offsetLeft;
    offsetY = e.clientY - note.offsetTop;
    note.setPointerCapture(e.pointerId);
  });

  note.addEventListener('pointermove', (e) => {
    if (!isDraggingNote) return;
    note.style.left = `${e.clientX - offsetX}px`;
    note.style.top = `${e.clientY - offsetY}px`;
  });

  note.addEventListener('pointerup', (e) => {
    isDraggingNote = false;
    try { note.releasePointerCapture(e.pointerId); } catch(err) {}
  });

  document.body.appendChild(note);
}
