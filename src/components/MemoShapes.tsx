import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

// ── Shape pool ──────────────────────────────────────────────────────────────
// Add more entries here when new SVG sets arrive.
const SHAPES = [
  { src: "/shapes/flower.svg",    label: "flower"    },
  { src: "/shapes/soft-star.svg", label: "soft-star" },
  { src: "/shapes/heart.svg",     label: "heart"     },
  { src: "/shapes/dawn.svg",      label: "dawn"      },
  // Set 2 — add once exported from Figma node 445-1655:
  // { src: "/shapes/shape-5.svg", label: "shape-5" },
  // { src: "/shapes/shape-6.svg", label: "shape-6" },
  // { src: "/shapes/shape-7.svg", label: "shape-7" },
  // { src: "/shapes/shape-8.svg", label: "shape-8" },
];

const SHAPE_COUNT = 2; // stamps shown per date

// ── Seeded pseudo-random (stable per date key) ───────────────────────────────
function seededRand(seed: string, index: number): number {
  let h = index + 1;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) ^ seed.charCodeAt(i);
  }
  h ^= h >>> 16;
  return ((h >>> 0) % 10000) / 10000; // 0..1
}

// ── Stamp placement builder ──────────────────────────────────────────────────
type Stamp = {
  src: string;
  label: string;
  top: string;
  left: string;
  size: number;
  rotate: number;
  opacity: number;
};

function buildStamps(dateKey: string): Stamp[] {
  // Pick SHAPE_COUNT unique shapes from pool, determined by date
  const pool = [...SHAPES];
  const picked: typeof SHAPES[0][] = [];
  let si = 0;
  while (picked.length < SHAPE_COUNT && pool.length > 0) {
    const idx = Math.floor(seededRand(dateKey, si++) * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  // Each stamp gets a distinct placement zone
  // Zones: [top-left corner area] and [top-right corner area]
  // Vary within zone per date for freshness
  const zones = [
    { topRange: [4, 22],  leftRange: [1, 12]  },  // left side
    { topRange: [4, 22],  leftRange: [82, 96] },   // right side
  ];

  return picked.map((shape, i) => {
    const r = (n: number) => seededRand(dateKey, i * 20 + n + 100);
    const zone = zones[i % zones.length];
    const top    = zone.topRange[0]  + r(0) * (zone.topRange[1]  - zone.topRange[0]);
    const left   = zone.leftRange[0] + r(1) * (zone.leftRange[1] - zone.leftRange[0]);
    const size   = 72 + r(2) * 80;        // 72–152 px
    const rotate = r(3) * 50 - 25;        // -25 to +25 deg
    const opacity = 0.55 + r(4) * 0.3;   // 0.55–0.85

    return { ...shape, top: `${top}%`, left: `${left}%`, size, rotate, opacity };
  });
}

// ── Component ────────────────────────────────────────────────────────────────
type Props = {
  show: boolean;
  dateKey: string;
};

export default function MemoShapes({ show, dateKey }: Props) {
  const stamps = useMemo(() => buildStamps(dateKey), [dateKey]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={`memo-shapes-${dateKey}`}
          aria-hidden
          className="pointer-events-none fixed inset-0 overflow-hidden"
          style={{ zIndex: 0 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          {stamps.map((stamp, i) => (
            <motion.img
              key={`${stamp.label}-${i}`}
              src={stamp.src}
              alt=""
              initial={{ opacity: 0, scale: 0.5, rotate: stamp.rotate - 15 }}
              animate={{ opacity: stamp.opacity, scale: 1, rotate: stamp.rotate }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{
                duration: 0.5,
                delay: i * 0.1,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              style={{
                position: "absolute",
                top: stamp.top,
                left: stamp.left,
                width: stamp.size,
                height: stamp.size,
                objectFit: "contain",
                userSelect: "none",
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
