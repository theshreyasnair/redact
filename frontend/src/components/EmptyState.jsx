const HEX = "0123456789abcdef";
function hex(n, seed) {
  let s = "";
  let x = seed * 2654435761 + 1;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += HEX[(x >>> 16) % 16];
  }
  return s;
}

// A rough box drawn out of hashes: solid top and bottom rows, hollow middle.
const ROWS = 9;
const COLS = 48;
const box = Array.from({ length: ROWS }, (_, r) => {
  if (r === 0 || r === ROWS - 1) return "0x" + hex(COLS - 2, r + 7);
  const edge = 6;
  return "0x" + hex(edge - 2, r * 13) + " ".repeat(COLS - edge * 2) + hex(edge, r * 31);
});

export default function EmptyState({ title = "No listings yet", hint }) {
  return (
    <div className="relative mx-auto flex max-w-[640px] flex-col items-center py-16 text-center">
      <pre className="mono select-none text-[11px] leading-[20px] text-hash" aria-hidden="true">
        {box.join("\n")}
      </pre>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <h2 className="serif text-4xl">{title}</h2>
        {hint && <p className="text-sm text-mute">{hint}</p>}
      </div>
    </div>
  );
}
