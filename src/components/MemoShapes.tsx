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
  top: string;
  left: string;
  size: number;
  rotate: number;
  opacity: number;
  zIndex: number;
};

const SAFE_ZONES = [
  { leftMin: 2, leftMax: 16, topMin: 4, topMax: 18 },
  { leftMin: 84, leftMax: 98, topMin: 4, topMax: 18 },
  { leftMin: 4, leftMax: 14, topMin: 18, topMax: 30 },
  { leftMin: 86, leftMax: 96, topMin: 18, topMax: 30 },
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

  const zonePool = [...SAFE_ZONES];
  const pickedZones: (typeof SAFE_ZONES)[number][] = [];
  while (pickedZones.length < stampCount && zonePool.length > 0) {
    const idx = Math.floor(rand(dateKey, si++) * zonePool.length);
    pickedZones.push(zonePool.splice(idx, 1)[0]);
  }

  return picked.map((shape, i) => {
    const r = (n: number) => rand(dateKey, i * 30 + n + 50);
    const zone = pickedZones[i] ?? SAFE_ZONES[i % SAFE_ZONES.length];
    const left = zone.leftMin + r(0) * (zone.leftMax - zone.leftMin);
    const top = zone.topMin + r(1) * (zone.topMax - zone.topMin);

    // z-position represented as deterministic layer order
    const zIndex = 1 + Math.floor(r(2) * 2);

    // size: 54–116 px
    const size = 54 + r(3) * 62;

    // rotation: -26..+26 deg
    const rotate = r(4) * 52 - 26;

    // opacity: 0.42..0.68
    const opacity = 0.42 + r(5) * 0.26;

    return {
      ...shape,
      top:  `${top.toFixed(1)}%`,
      left: `${left.toFixed(1)}%`,
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
    <>
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
            position: "fixed",
            top: stamp.top,
            left: stamp.left,
            width: stamp.size,
            height: stamp.size,
            objectFit: "contain",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: stamp.zIndex,
          }}
        />
      ))}
    </>
  );
}
