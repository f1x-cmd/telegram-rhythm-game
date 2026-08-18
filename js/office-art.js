/**
 * Читаемые офисные иконки и стрелки направления для DRIVE.
 * Стрелки рисуются в экранных координатах — не крутятся вместе с предметом.
 */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function outline(ctx, r) {
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.stroke();
}

/** Предмет офиса в локальных координатах (центр 0,0). */
export function drawOfficeIcon(ctx, r, prop) {
  switch (prop.icon) {
    case 'doc':
      drawDoc(ctx, r, prop);
      break;
    case 'phone':
      drawPhone(ctx, r, prop);
      break;
    case 'mug':
      drawMug(ctx, r, prop);
      break;
    case 'call':
      drawCall(ctx, r, prop);
      break;
    case 'keyboard':
      drawKeyboard(ctx, r, prop);
      break;
    case 'mail':
      drawMail(ctx, r, prop);
      break;
    case 'laptop':
      drawLaptop(ctx, r, prop);
      break;
    case 'stapler':
      drawStapler(ctx, r, prop);
      break;
    case 'cactus':
      drawCactus(ctx, r, prop);
      break;
    case 'headset':
      drawHeadset(ctx, r, prop);
      break;
    case 'bonus':
      drawBonus(ctx, r, prop);
      break;
    default:
      ctx.fillStyle = prop.color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      outline(ctx, r);
  }
}

function drawDoc(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.52, -r * 0.68, r * 1.04, r * 1.36, r * 0.08);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = prop.accent;
  roundRect(ctx, -r * 0.18, -r * 0.78, r * 0.36, r * 0.28, r * 0.06);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(-r * 0.34, -r * 0.38 + i * r * 0.22, r * 0.68, r * 0.07);
  }
}

function drawPhone(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.36, -r * 0.7, r * 0.72, r * 1.4, r * 0.16);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = prop.accent;
  roundRect(ctx, -r * 0.26, -r * 0.52, r * 0.52, r * 0.95, r * 0.06);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, r * 0.58, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function drawMug(ctx, r, prop) {
  ctx.strokeStyle = prop.accent;
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(r * 0.5, 0.02 * r, r * 0.28, -Math.PI * 0.55, Math.PI * 0.55);
  ctx.stroke();
  ctx.fillStyle = prop.color;
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, r * 0.52);
  ctx.lineTo(-r * 0.32, -r * 0.32);
  ctx.lineTo(r * 0.32, -r * 0.32);
  ctx.lineTo(r * 0.42, r * 0.52);
  ctx.closePath();
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = '#5C3A22';
  ctx.fillRect(-r * 0.28, -r * 0.46, r * 0.56, r * 0.16);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.moveTo(-r * 0.12, -r * 0.58);
  ctx.quadraticCurveTo(-r * 0.22, -r * 0.78, -r * 0.06, -r * 0.9);
  ctx.moveTo(r * 0.1, -r * 0.55);
  ctx.quadraticCurveTo(r * 0.22, -r * 0.76, r * 0.08, -r * 0.9);
  ctx.stroke();
}

function drawCall(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  ctx.beginPath();
  ctx.arc(-r * 0.28, r * 0.28, r * 0.28, 0, Math.PI * 2);
  ctx.arc(r * 0.28, -r * 0.28, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.28;
  ctx.strokeStyle = prop.color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.18, r * 0.18);
  ctx.quadraticCurveTo(r * 0.35, r * 0.12, r * 0.18, -r * 0.18);
  ctx.stroke();
  ctx.fillStyle = prop.accent;
  ctx.beginPath();
  ctx.arc(-r * 0.28, r * 0.28, r * 0.12, 0, Math.PI * 2);
  ctx.arc(r * 0.28, -r * 0.28, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawKeyboard(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.78, -r * 0.32, r * 1.56, r * 0.64, r * 0.1);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = prop.accent;
  for (let row = 0; row < 3; row++) {
    const count = row === 2 ? 5 : 6;
    const start = -((count - 1) * r * 0.2) / 2;
    for (let i = 0; i < count; i++) {
      roundRect(ctx, start + i * r * 0.2 - r * 0.07, -r * 0.2 + row * r * 0.18, r * 0.14, r * 0.12, r * 0.03);
      ctx.fill();
    }
  }
}

function drawMail(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.7, -r * 0.42, r * 1.4, r * 0.9, r * 0.08);
  ctx.fill();
  outline(ctx, r);
  ctx.strokeStyle = prop.accent;
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, -r * 0.34);
  ctx.lineTo(0, r * 0.12);
  ctx.lineTo(r * 0.7, -r * 0.34);
  ctx.stroke();
}

function drawLaptop(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.62, -r * 0.58, r * 1.24, r * 0.82, r * 0.08);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = prop.accent;
  roundRect(ctx, -r * 0.5, -r * 0.46, r * 1.0, r * 0.58, r * 0.04);
  ctx.fill();
  ctx.fillStyle = '#1a1a22';
  roundRect(ctx, -r * 0.78, r * 0.22, r * 1.56, r * 0.22, r * 0.04);
  ctx.fill();
}

function drawStapler(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.62, -r * 0.08, r * 1.24, r * 0.28, r * 0.08);
  ctx.fill();
  roundRect(ctx, -r * 0.55, -r * 0.38, r * 0.95, r * 0.32, r * 0.1);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = prop.accent;
  ctx.fillRect(-r * 0.52, -r * 0.02, r * 0.18, r * 0.16);
}

function drawCactus(ctx, r, prop) {
  ctx.fillStyle = prop.accent;
  roundRect(ctx, -r * 0.32, r * 0.18, r * 0.64, r * 0.42, r * 0.08);
  ctx.fill();
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.18, -r * 0.62, r * 0.36, r * 0.9, r * 0.18);
  ctx.fill();
  roundRect(ctx, -r * 0.52, -r * 0.22, r * 0.34, r * 0.22, r * 0.11);
  ctx.fill();
  roundRect(ctx, r * 0.18, -r * 0.08, r * 0.34, r * 0.22, r * 0.11);
  ctx.fill();
}

function drawHeadset(ctx, r, prop) {
  ctx.strokeStyle = prop.color;
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.arc(0, -r * 0.05, r * 0.48, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.fillStyle = prop.accent;
  ctx.beginPath();
  ctx.arc(-r * 0.48, r * 0.08, r * 0.22, 0, Math.PI * 2);
  ctx.arc(r * 0.48, r * 0.08, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = prop.color;
  roundRect(ctx, -r * 0.12, r * 0.18, r * 0.24, r * 0.38, r * 0.08);
  ctx.fill();
}

function drawBonus(ctx, r, prop) {
  ctx.fillStyle = prop.color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  outline(ctx, r);
  ctx.fillStyle = '#7A4A00';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFF8DC';
  ctx.font = `800 ${Math.round(r * 0.85)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₽', 0, r * 0.04);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** Бомба: green help / gray dust / red damage. */
export function drawOfficeBomb(ctx, r, mode) {
  const help = mode === 'help';
  const dust = mode === 'dust';
  const body = help ? '#1E3A1E' : dust ? '#3A342E' : '#141414';
  const accent = help ? '#7CFC4A' : dust ? '#D8C8B0' : '#FF3300';

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, r * 0.08, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.stroke();

  ctx.fillStyle = '#2A2A2A';
  roundRect(ctx, -r * 0.16, -r * 0.82, r * 0.32, r * 0.22, r * 0.06);
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.82);
  ctx.quadraticCurveTo(r * 0.28, -r * 1.05, r * 0.38, -r * 0.78);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(r * 0.4, -r * 0.76, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  if (help) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, r * 0.08);
    ctx.lineTo(r * 0.22, r * 0.08);
    ctx.moveTo(0, -r * 0.14);
    ctx.lineTo(0, r * 0.3);
    ctx.stroke();
  } else if (dust) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-r * 0.18, r * 0.06, r * 0.16, 0, Math.PI * 2);
    ctx.arc(r * 0.14, r * 0.16, r * 0.22, 0, Math.PI * 2);
    ctx.arc(0, -r * 0.06, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-r * 0.18, r * 0.02, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.18, r * 0.02, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(0, r * 0.22, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

const DIR_ANGLE = {
  left: Math.PI,
  right: 0,
  up: -Math.PI / 2,
  down: Math.PI / 2,
};

/**
 * Стрелка направления свайпа — экранные координаты, пульс по AudioContext.now.
 */
export function drawSliceHint(ctx, x, y, r, dir, now) {
  const angle = DIR_ANGLE[dir];
  if (angle === undefined) return;

  const pulse = 0.72 + 0.28 * Math.sin(now * 9);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.fillStyle = `rgba(255, 214, 70, ${0.2 * pulse})`;
  ctx.beginPath();
  ctx.ellipse(r * 0.18, 0, r * 1.38, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 236, 110, ${0.72 + 0.28 * pulse})`;
  ctx.strokeStyle = 'rgba(20, 16, 8, 0.65)';
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.22, -r * 0.16);
  ctx.lineTo(r * 0.22, -r * 0.16);
  ctx.lineTo(r * 0.22, -r * 0.4);
  ctx.lineTo(r * 0.78, 0);
  ctx.lineTo(r * 0.22, r * 0.4);
  ctx.lineTo(r * 0.22, r * 0.16);
  ctx.lineTo(-r * 0.22, r * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
