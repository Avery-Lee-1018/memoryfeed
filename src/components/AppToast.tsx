type AppToastState = {
  tone: "success" | "warning" | "error";
  title: string;
  description?: string;
  retryUrls?: string[];
  undoFn?: () => void;
} | null;

type Props = {
  toast: AppToastState;
  sourceSubmitting: boolean;
  onClose: () => void;
  onUndo: () => void;
  onRetry: () => void;
};

export default function AppToast({ toast, sourceSubmitting, onClose, onUndo, onRetry }: Props) {
  if (!toast) return null;

  return (
    <div className="fixed left-1/2 top-12 z-50 w-[min(92vw,560px)] -translate-x-1/2">
      <div
        className={`rounded-xl border px-4 py-3 shadow-lg backdrop-blur ${
          toast.tone === "success"
            ? "border-emerald-200 bg-emerald-50/95 text-emerald-900"
            : toast.tone === "warning"
              ? "border-amber-200 bg-amber-50/95 text-amber-900"
              : "border-rose-200 bg-rose-50/95 text-rose-900"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{toast.title}</p>
            {toast.description && <p className="mt-0.5 text-xs opacity-80">{toast.description}</p>}
          </div>
          {!toast.undoFn && (
            <button
              onClick={onClose}
              className="mt-0.5 text-xs opacity-70 hover:opacity-100"
              aria-label="토스트 닫기"
            >
              닫기
            </button>
          )}
        </div>
        {toast.undoFn && (
          <div className="mt-2">
            <button
              onClick={onUndo}
              className="rounded-full border border-current/30 bg-white/70 px-3 py-1 text-xs font-medium hover:bg-white"
            >
              실행취소
            </button>
          </div>
        )}
        {toast.retryUrls && toast.retryUrls.length > 0 && (
          <div className="mt-2">
            <button
              onClick={onRetry}
              disabled={sourceSubmitting}
              className="rounded-full border border-current/30 bg-white/70 px-3 py-1 text-xs font-medium hover:bg-white disabled:opacity-50"
            >
              {sourceSubmitting ? "재시도 중..." : "안된 것만 등록하기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export type { AppToastState };
