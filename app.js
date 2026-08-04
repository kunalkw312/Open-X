const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Ensure canvas fills the entire window
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let isDrawing = false;
const ERASER_THRESHOLD = 300; // Adjust this sensitivity as needed for your specific screen DPI

function startDraw(x, y) {
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function drawLine(x, y, isEraser) {
  if (!isDrawing) return;

  // Set stroke properties based on mode
  ctx.lineWidth = isEraser ? 60 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // 'destination-out' erases existing pixels, 'source-over' draws normally
  ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = 'black';

  ctx.lineTo(x, y);
  ctx.stroke();
}

function stopDraw() {
  isDrawing = false;
}

// -----------------------------------------------------------
// WINDOWS / MOUSE / STYLUS LOGIC
// -----------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  // Ignore touch events here so they don't conflict with Android logic
  if (e.pointerType === 'touch') return; 
  startDraw(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', stopDraw);
canvas.addEventListener('pointercancel', stopDraw);

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return; 

  // Detect hardware erasers or thick pointer contacts (like a thumb/palm on Windows)
  const isEraser = e.pointerType === 'eraser' || (e.width * e.height) > ERASER_THRESHOLD;
  drawLine(e.clientX, e.clientY, isEraser);
});

// -----------------------------------------------------------
// ANDROID / TOUCH LOGIC
// -----------------------------------------------------------
canvas.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  if (touch) startDraw(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  // CRITICAL: Stop Android refresh/scroll gestures from firing and canceling the stroke
  e.preventDefault(); 

  const touch = e.touches[0];
  if (!touch) return;

  // Accurately calculate the physical contact area on the glass
  const contactArea = touch.radiusX * touch.radiusY;
  const isEraser = contactArea > ERASER_THRESHOLD;

  drawLine(touch.clientX, touch.clientY, isEraser);
}, { passive: false });

canvas.addEventListener('touchend', stopDraw);
canvas.addEventListener('touchcancel', stopDraw);

