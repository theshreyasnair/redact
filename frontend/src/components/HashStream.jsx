import { useEffect, useRef } from "react";

/**
 * The black box: an isometric cube built from hash text, drawn on a canvas that
 * fills its (position: relative) parent. Three faces, each clipped to its
 * polygon and transformed so rows run parallel to the face's edges. No fills,
 * no outlines. The edges come from where text stops and from the brightness
 * step between faces.
 */

const HEX = "0123456789abcdef";
const ACCENT = { r: 0xbb, g: 0x3b, b: 0x1a }; // #BB3B1A
// Printed gray on paper. Darkest face on top.
const FACE_COLORS = {
  top: { r: 0xbf, g: 0xba, b: 0xae }, // #BFBAAE
  left: { r: 0xcc, g: 0xc7, b: 0xbb }, // #CCC7BB
  right: { r: 0xd7, g: 0xd2, b: 0xc6 }, // #D7D2C6
};
const FONT_SIZE = 12;
const CHAR_W = FONT_SIZE * 0.6;
const BASE_ROW_H = 22;
const MAX_ROW_H = 44;
const CHUNK = 12;
const EDGE_DROP = 0.1;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const HIGHLIGHT_EVERY_MS = 8000;
const HIGHLIGHT_HOLD_MS = 5500;

function hex(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[(Math.random() * 16) | 0];
  return s;
}

function fragment() {
  const r = Math.random();
  if (r < 0.05) return `0x${hex(40)}`;
  if (r < 0.08) return `0x${hex(64)}`;
  if (r < 0.12) return `nonce: ${(Math.random() * 90000 + 1000) | 0}`;
  if (r < 0.16) return `block: ${(Math.random() * 9_000_000 + 20_000_000) | 0}`;
  if (r < 0.5) return `0x${hex(6 + ((Math.random() * 14) | 0))}`;
  return hex(4 + ((Math.random() * 16) | 0));
}

function rgb(c) {
  return `rgb(${c.r},${c.g},${c.b})`;
}
function mix(a, b, t) {
  return `rgb(${(a.r + (b.r - a.r) * t) | 0},${(a.g + (b.g - a.g) * t) | 0},${(a.b + (b.b - a.b) * t) | 0})`;
}

/**
 * Cube geometry for edge length s centred at (cx, cy). Total height is 2s, width 2·cos30·s.
 * Each face carries a polygon (canvas coords) and an affine transform [a b c d e f]
 * mapping face-local (u, v) → canvas, where u runs along the rows and v across them.
 */
function buildCube(cx, cy, s) {
  const w = COS30 * s;
  const A = [cx, cy - s]; // top back
  const B = [cx + w, cy - s / 2]; // right
  const C = [cx, cy]; // front (shared by all three faces)
  const D = [cx - w, cy - s / 2]; // left
  const Cb = [cx, cy + s]; // bottom front
  const Bb = [cx + w, cy + s / 2];
  const Db = [cx - w, cy + s / 2];
  return {
    top: { poly: [D, A, B, C], m: [COS30, -SIN30, COS30, SIN30, D[0], D[1]], color: FACE_COLORS.top, dir: 1 },
    left: { poly: [D, C, Cb, Db], m: [COS30, SIN30, 0, 1, D[0], D[1]], color: FACE_COLORS.left, dir: -1 },
    right: { poly: [C, B, Bb, Cb], m: [COS30, -SIN30, 0, 1, C[0], C[1]], color: FACE_COLORS.right, dir: 1 },
  };
}

/** Rows of fragments for one face. Each row is a loop of period `s` so drift can wrap. */
function buildRows(s, rowH) {
  const rows = [];
  const count = Math.floor(s / rowH);
  const pad = (s - count * rowH) / 2;
  for (let r = 0; r < count; r++) {
    const frags = [];
    let u = ((Math.random() * 4) | 0) * CHAR_W;
    while (u < s) {
      const text = fragment();
      const w = text.length * CHAR_W;
      if (u + w > s) break; // keep the row inside its loop period so the wrap never overprints
      frags.push({ text, u, w, edgeDrop: Math.random() < EDGE_DROP });
      u += w + CHAR_W;
    }
    rows.push({ v: pad + r * rowH + rowH / 2, frags, first: r === 0, last: r === count - 1 });
  }
  return rows;
}

export default function HashStream({
  size = 520, // total cube height in px
  center = (W, H) => ({ x: W * 0.8, y: H / 2 }),
  opacity = 0.85,
  highlights = [],
  radius = 140,
  speed = 5,
  minWidth = 900,
}) {
  const canvasRef = useRef(null);
  const highlightKey = highlights.join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let s = size / 2;
    let cube = null;
    let faces = []; // [{ key, poly, m, color, dir, rows, offset }]
    let rowH = BASE_ROW_H;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const mouse = { x: -9999, y: -9999 };
    const r2 = radius * radius;
    let frameAvg = 16;
    let active = null; // { chunks: [{ rowIndex, text, u, w }], until }
    let nextHighlightAt = performance.now() + 2500;
    let hlIndex = 0;

    const rebuild = () => {
      if (window.innerWidth < minWidth || !cube) {
        faces = [];
        return;
      }
      faces = Object.entries(cube).map(([key, f]) => ({ key, ...f, rows: buildRows(s, rowH), offset: Math.random() * s }));
      active = null;
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s = size / 2;
      const c = center(W, H);
      cube = buildCube(c.x, c.y, s);
      rebuild();
    };

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    // The real hash is too long for one row on a small face, so it is split across consecutive rows on the top face.
    const surfaceHighlight = (now) => {
      const top = faces.find((f) => f.key === "top");
      if (!top || !highlights.length) return;
      const text = highlights[hlIndex++ % highlights.length];
      const perRow = Math.max(8, Math.floor((s - CHAR_W * 2) / CHAR_W));
      const pieces = [];
      for (let i = 0; i < text.length; i += perRow) pieces.push(text.slice(i, i + perRow));
      if (pieces.length > top.rows.length) return;
      const start = (Math.random() * (top.rows.length - pieces.length)) | 0;
      const u = CHAR_W;
      active = {
        until: now + HIGHLIGHT_HOLD_MS,
        chunks: pieces.map((p, i) => ({ rowIndex: start + i, text: p, u, w: p.length * CHAR_W })),
      };
    };

    const drawFace = (face) => {
      const [a, b, c, d, e, f] = face.m;
      ctx.save();
      ctx.beginPath();
      face.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, d, e, f);
      ctx.font = `${FONT_SIZE}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textBaseline = "middle";

      const base = face.color;
      const hlRows = active && face.key === "top" ? active.chunks : null;

      face.rows.forEach((row, rowIndex) => {
        const v = row.v;
        const hl = hlRows ? hlRows.find((ch) => ch.rowIndex === rowIndex) : null;
        // Canvas-space y of this row is needed for the cursor test; compute per chunk below.
        for (const frag of row.frags) {
          // Drift with wrap: draw at offset and one period behind so the loop is seamless.
          for (let k = -1; k <= 0; k++) {
            const u = ((frag.u + face.offset) % s) + k * s;
            if (u + frag.w < 0 || u > s) continue;
            const touchesEdge = u < 0 || u + frag.w > s || row.first || row.last;
            if (touchesEdge && frag.edgeDrop) continue;
            if (hl && u < hl.u + hl.w && u + frag.w > hl.u) continue; // make room for the highlight

            // Colour per chunk by cursor distance, measured in canvas space.
            for (let i = 0; i < frag.text.length; i += CHUNK) {
              const len = Math.min(CHUNK, frag.text.length - i);
              const cu = u + (i + len / 2) * CHAR_W;
              const px = a * cu + c * v + e;
              const py = b * cu + d * v + f;
              const dx = mouse.x - px;
              const dy = mouse.y - py;
              const d2 = dx * dx + dy * dy;
              let t = 0;
              if (d2 < r2) {
                const dist = Math.sqrt(d2) / radius;
                t = (1 - dist) * (1 - dist);
              }
              ctx.fillStyle = t > 0.01 ? mix(base, ACCENT, t) : rgb(base);
              ctx.fillText(frag.text.slice(i, i + len), u + i * CHAR_W, v);
            }
          }
        }
        if (hl) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = rgb(ACCENT);
          ctx.fillText(hl.text, hl.u, v);
          ctx.globalAlpha = opacity;
        }
      });
      ctx.restore();
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!visible || !faces.length) return;
      const dtMs = now - last;
      const dt = Math.min(dtMs / 1000, 0.1);
      last = now;

      // Frame budget: if we are consistently over 60fps budget, thin the rows.
      frameAvg = frameAvg * 0.95 + dtMs * 0.05;
      if (frameAvg > 20 && rowH < MAX_ROW_H) {
        rowH += 6;
        frameAvg = 16;
        rebuild();
      }

      if (!reduceMotion) {
        for (const face of faces) face.offset = (((face.offset + face.dir * speed * dt) % s) + s) % s;
      }
      if (active && now > active.until) active = null;
      if (!active && now > nextHighlightAt) {
        surfaceHighlight(now);
        nextHighlightAt = now + HIGHLIGHT_EVERY_MS;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = opacity;
      for (const face of faces) drawFace(face);
      ctx.globalAlpha = 1;
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      last = performance.now();
    });
    io.observe(parent);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, opacity, radius, speed, minWidth, highlightKey]);

  return <canvas ref={canvasRef} className="hash-stream" aria-hidden="true" />;
}
