import { useEffect, useState } from "react";
import { SpiralAnimation } from "@/components/ui/spiral-animation";

type Props = {
  onComplete: () => void;
};

export function SpiralDemo({ onComplete }: Props) {
  const [textStage, setTextStage] = useState<"hidden" | "visible" | "fading">("hidden");
  const [closing, setClosing] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    // Text starts later than the background and fades out first.
    const showTimer = window.setTimeout(() => setTextStage("visible"), 1700);
    const fadeTimer = window.setTimeout(() => setTextStage("fading"), 9000);
    // End intro while background is fading out (do not wait for full cycle end).
    const closeTimer = window.setTimeout(() => setClosing(true), 10200);
    const completeTimer = window.setTimeout(() => {
      setCompleted(true);
      onComplete();
    }, 10950);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete]);

  const handleSceneComplete = () => {
    if (completed) return;
    setClosing(true);
    setCompleted(true);
    window.setTimeout(() => onComplete(), 500);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] h-full w-full overflow-hidden bg-black transition-opacity duration-700 ${
        closing ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="absolute inset-0">
        <SpiralAnimation onCycleComplete={handleSceneComplete} />
      </div>

      <div
        className={`absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-1000 ${
          textStage === "hidden"
            ? "translate-y-4 opacity-0"
            : textStage === "visible"
              ? "translate-y-0 opacity-100"
              : "translate-y-0 opacity-0"
        }`}
        style={{ transitionDuration: "1600ms" }}
      >
        <p className="text-3xl font-extralight tracking-[0.06em] text-white sm:text-4xl" style={{ fontFamily: "'Manrope', sans-serif" }}>
          Memoryfeed
        </p>
      </div>
    </div>
  );
}
