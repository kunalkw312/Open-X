const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

// Ensure canvas fills the entire large format display
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let isDrawing = false;
let isErasing = false;

function startDraw(x, y) {
  isDrawing = true;
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function drawLine(x, y, isEraser) {
  if (!isDrawing) return;

  // Make the eraser massive (150px) so it feels natural on a 65"+ screen
  ctx.lineWidth = isEraser ? 150 : 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // 'destination-out' erases pixels, 'source-over' draws normally
  ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = 'black';

  ctx.lineTo(x, y);
  ctx.stroke();
}

function stopDraw() {
  isDrawing = false;
  isErasing = false;
}

// -----------------------------------------------------------
// WINDOWS / MOUSE / ACTIVE STYLUS LOGIC
// -----------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return; // Let touch events handle IR frames
  startDraw(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', stopDraw);
canvas.addEventListener('pointercancel', stopDraw);

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return; 

  const isEraser = e.pointerType === 'eraser';
  drawLine(e.clientX, e.clientY, isEraser);
});

// -----------------------------------------------------------
// ANDROID IFP / IR TOUCH LOGIC
// -----------------------------------------------------------

// Helper function to find the center of a palm/fist on the IR grid
function getTouchCenter(touches) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < touches.length; i++) {
    x += touches[i].clientX;
    y += touches[i].clientY;
  }
  return {
    x: x / touches.length,
    y: y / touches.length
  };
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault(); // CRITICAL: Stops Android zooming/scrolling on the IFP

  // 3 or more touch points indicates a palm or fist on an IR board
  if (e.touches.length >= 3) {
    isErasing = true;
    const center = getTouchCenter(e.touches);
    startDraw(center.x, center.y);
  } else if (e.touches.length === 1) {
    isErasing = false;
    startDraw(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();

  if (e.touches.length >= 3) {
    // Erasing with palm
    isErasing = true;
    const center = getTouchCenter(e.touches);
    drawLine(center.x, center.y, true);
  } else if (e.touches.length === 1 && !isErasing) {
    // Drawing with single finger or dummy stylus
    drawLine(e.touches[0].clientX, e.touches[0].clientY, false);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  // If the user lifts part of their palm and drops below 3 touches, 
  // stop erasing entirely so it doesn't accidentally draw a dot.
  if (isErasing && e.touches.length < 3) {
    stopDraw();
  } else if (e.touches.length === 0) {
    stopDraw();
  }
});

canvas.addEventListener('touchcancel', stopDraw);
