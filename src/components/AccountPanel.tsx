import { useState } from "react";
import type { AuthUser } from "@/lib/auth-session";
import { deleteAccount, logout } from "@/lib/auth-session";

type Props = {
  user: AuthUser;
  onClose: () => void;
  onLogout: () => void;
  onDeleted: () => void;
};

export default function AccountPanel({ user, onClose, onLogout, onDeleted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">계정 관리</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Account info */}
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-zinc-600">
                <i className="ri-user-line text-base" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {user.displayName && (
                <p className="truncate text-sm font-semibold text-zinc-800">{user.displayName}</p>
              )}
              <p className="truncate text-xs text-zinc-500">{user.email}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <i className="ri-google-fill text-sm text-zinc-400" />
            <span className="text-[11px] text-zinc-400">Google 계정으로 연동됨</span>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          {loggingOut ? "로그아웃 중…" : "로그아웃"}
        </button>

        {/* Delete section */}
        <div className="mt-2">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-xl border border-red-100 bg-red-50 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-100"
            >
              탈퇴하기
            </button>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="mb-3 text-sm font-medium text-red-700">정말 탈퇴할까요?</p>
              <p className="mb-4 text-xs text-red-500 leading-relaxed">
                모든 소스, 메모, 피드 데이터가 영구 삭제됩니다. 이 작업은 되돌릴 수 없어요.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting ? "처리 중…" : "탈퇴 확인"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
