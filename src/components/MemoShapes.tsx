import { AnimatePresence, motion } from "framer-motion";
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

  return picked.map((shape, i) => {
    const r = (n: number) => rand(dateKey, i * 30 + n + 50);

    // x-position (edge-biased, stamp-like)
    const leftRaw = r(0);
    const left =
      leftRaw < 0.5
        ? 4 + leftRaw * 2 * 22
        : 74 + (leftRaw - 0.5) * 2 * 22;

    // y-position (upper/mid visual band)
    const top = 8 + r(1) * 56;

    // z-position represented as deterministic layer order
    const zIndex = 1 + Math.floor(r(2) * 5);

    // size: 60–150 px
    const size = 60 + r(3) * 90;

    // rotation: -36..+36 deg
    const rotate = r(4) * 72 - 36;

    // opacity: 0.46..0.78
    const opacity = 0.46 + r(5) * 0.32;

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

  return (
    <AnimatePresence>
      {show && stamps.map((stamp, i) => (
        <motion.img
          key={`memo-stamp-${dateKey}-${stamp.label}`}
          src={stamp.src}
          alt=""
          aria-hidden
          initial={{ opacity: 0, scale: 0.45, rotate: stamp.rotate - 20 }}
          animate={{ opacity: stamp.opacity, scale: 1, rotate: stamp.rotate }}
          exit={{ opacity: 0, scale: 0.5, rotate: stamp.rotate + 10 }}
          transition={{
            duration: 0.55,
            delay: i * 0.1,
            ease: [0.34, 1.56, 0.64, 1],
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
    </AnimatePresence>
  );
}
