import { motion } from "framer-motion";
import { useMemo } from "react";

// ── Full shape pool (8 shapes) ───────────────────────────────────────────────
const SHAPES = [
  { src: "/shapes/flower.svg",    label: "flower"    },
  { src: "/shapes/soft-star.svg", label: "soft-star" },
  { src: "/shapes/heart.svg",     label: "heart"     },
  { src: "/shapes/dawn.svg",      label: "dawn"      },
  { src: "/shapes/explosion.svg", label: "explosion" },
  { src: "/shapes/team.svg",      label: "team"      },
  { src: "/shapes/stairs.svg",    label: "stairs"    },
  { src: "/shapes/asterisk.svg",  label: "asterisk"  },
];

// ── Seeded PRNG — stable per (dateKey + index), deterministic per date ───────
function rand(seed: string, index: number): number {
  let h = (index + 1) * 2654435761;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2246822519);
  }
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000; // 0..1
}

// ── Build 3 stamps — shape, position, size, z-layer vary by date ─────────────
type Stamp = {
  src: string;
  label: string;
  topPct: number;
  leftPct: number;
  size: number;
  rotate: number;
  opacity: number;
  zIndex: number;
};

const SAFE_INSET_PX = 20;

const LAYOUT_PATTERNS = [
  [
    { left: 8, top: 9, z: 1 },
    { left: 92, top: 10, z: 2 },
    { left: 16, top: 18, z: 3 },
  ],
  [
    { left: 10, top: 8, z: 2 },
    { left: 90, top: 13, z: 1 },
    { left: 84, top: 20, z: 3 },
  ],
  [
    { left: 14, top: 11, z: 3 },
    { left: 86, top: 9, z: 2 },
    { left: 50, top: 8, z: 1 },
  ],
  [
    { left: 8, top: 13, z: 1 },
    { left: 92, top: 9, z: 3 },
    { left: 50, top: 10, z: 2 },
  ],
] as const;

function buildStamps(dateKey: string): Stamp[] {
  // Pick 3 unique shapes from pool (deterministic per dateKey)
  const stampCount = 3;
  const pool = [...SHAPES];
  const picked: typeof SHAPES[number][] = [];
  let si = 0;
  while (picked.length < stampCount && pool.length > 0) {
    const idx = Math.floor(rand(dateKey, si++) * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  const pattern = LAYOUT_PATTERNS[Math.floor(rand(dateKey, 777) * LAYOUT_PATTERNS.length)];
  const sizeProfilePool = [
    [1.2, 1.0, 0.9],
    [1.15, 0.95, 1.0],
    [1.1, 1.0, 1.05],
  ] as const;
  const sizeProfile = sizeProfilePool[Math.floor(rand(dateKey, 991) * sizeProfilePool.length)];

  return picked.map((shape, i) => {
    const r = (n: number) => rand(dateKey, i * 30 + n + 50);
    const base = pattern[i % pattern.length];
    // Keep stamps outside the central card rail to avoid heavy overlap with content cards.
    const leftPct = Math.min(94, Math.max(6, base.left + (r(0) * 2 - 1) * 2.2));
    const topPct = Math.min(22, Math.max(6, base.top + (r(1) * 2 - 1) * 2.4));

    const zIndex = base.z;

    // size: base 56–90 px, then harmonized per-stamp scale profile
    const baseSize = 56 + r(3) * 34;
    const size = baseSize * (sizeProfile[i] ?? 1);

    // rotation: -20..+20 deg
    const rotate = r(4) * 40 - 20;

    // opacity: 0.44..0.66
    const opacity = 0.44 + r(5) * 0.22;

    return {
      ...shape,
      topPct,
      leftPct,
      size,
      rotate,
      opacity,
      zIndex,
    };
  });
}

// ── Component ────────────────────────────────────────────────────────────────
type Props = { show: boolean; dateKey: string };

export default function MemoShapes({ show, dateKey }: Props) {
  const stamps = useMemo(() => buildStamps(dateKey), [dateKey]);
  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: SAFE_INSET_PX,
        right: SAFE_INSET_PX,
        bottom: SAFE_INSET_PX,
        left: SAFE_INSET_PX,
        pointerEvents: "none",
        userSelect: "none",
        zIndex: -1,
      }}
    >
      {stamps.map((stamp, i) => (
        <motion.img
          key={`memo-stamp-${dateKey}-${stamp.label}`}
          src={stamp.src}
          alt=""
          aria-hidden
          initial={{ opacity: 0, scale: 0.55, rotate: stamp.rotate - 12 }}
          animate={{ opacity: stamp.opacity, scale: 1, rotate: stamp.rotate }}
          transition={{
            duration: 0.4,
            delay: i * 0.08,
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            top: `${stamp.topPct}%`,
            left: `${stamp.leftPct}%`,
            width: stamp.size,
            height: stamp.size,
            objectFit: "contain",
            transform: "translate(-50%, -50%)",
            zIndex: stamp.zIndex,
          }}
        />
      ))}
    </div>
  );
}
