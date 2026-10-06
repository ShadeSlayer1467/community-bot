(() => {
  const canvas = document.getElementById('ambientBackdrop');
  const context = canvas?.getContext('2d');
  if (!context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const glyphs = ['+', '·', '○', '⌁', '01'];
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-rgb')
    .trim()
    .replace(/\s+/g, ', ');
  let width = 0;
  let height = 0;
  let offsetX = 0;
  let offsetY = 0;
  let frame;

  const color = (alpha) => `rgba(${accent}, ${alpha})`;
  const noise = (x, y) => {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const scheduleDraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };

  function resize() {
    const density = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    context.setTransform(density, 0, 0, density, 0, 0);
    scheduleDraw();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(offsetX, offsetY);

    const spacing = width < 700 ? 190 : 245;
    const columns = Math.ceil((width + spacing * 2) / spacing);
    const rows = Math.ceil((height + spacing * 2) / spacing);
    const points = [];

    for (let row = -1; row < rows; row += 1) {
      points[row + 1] = [];
      for (let column = -1; column < columns; column += 1) {
        const seed = noise(column, row);
        points[row + 1][column + 1] = {
          x: column * spacing + (row % 2 ? spacing * 0.48 : 0) + (seed - 0.5) * 44,
          y: row * spacing + (noise(row, column + 9) - 0.5) * 34,
          seed,
        };
      }
    }

    context.lineWidth = 0.75;
    context.strokeStyle = color(0.055);
    for (let row = 0; row < points.length; row += 1) {
      for (let column = 0; column < points[row].length; column += 1) {
        const point = points[row][column];
        const next = points[row][column + 1];
        const diagonal = points[row + 1]?.[column + (row % 2 ? 0 : 1)];
        if (next && point.seed > 0.25) {
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(next.x, next.y);
          context.stroke();
        }
        if (diagonal && point.seed > 0.58) {
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(diagonal.x, diagonal.y);
          context.stroke();
        }
      }
    }

    points.flat().forEach((point, index) => {
      if (!point) return;
      const radius = 24 + point.seed * 34;

      context.fillStyle = color(0.11 + point.seed * 0.07);
      context.beginPath();
      context.arc(point.x, point.y, point.seed > 0.78 ? 2.1 : 1.35, 0, tau);
      context.fill();

      if (point.seed > 0.44) {
        context.strokeStyle = color(0.045 + point.seed * 0.035);
        context.lineWidth = point.seed > 0.82 ? 1 : 0.65;
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          radius,
          point.seed * tau,
          point.seed * tau + Math.PI * (0.55 + point.seed * 0.75),
        );
        context.stroke();
      }

      if (point.seed > 0.68) {
        context.fillStyle = color(0.16);
        context.font = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
        context.fillText(glyphs[index % glyphs.length], point.x + 9, point.y - 8);
      }
    });

    context.restore();
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener(
    'pointermove',
    (event) => {
      if (reducedMotion.matches || !width || !height) return;
      offsetX = (event.clientX / width - 0.5) * 9;
      offsetY = (event.clientY / height - 0.5) * 7;
      scheduleDraw();
    },
    { passive: true },
  );
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) offsetX = offsetY = 0;
    scheduleDraw();
  });
  resize();
})();
