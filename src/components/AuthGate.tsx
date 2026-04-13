import { useEffect, useMemo, useState } from "react";
import { loginWithGoogleIdToken, type AuthUser } from "@/lib/auth-session";

const WEB_CLIENT_ID_KEY = "memoryfeed_google_web_client_id";
const DEFAULT_WEB_CLIENT_ID = "380812389397-lk5kr88gujudk3j6ks7rb04piua1u1nr.apps.googleusercontent.com";

type Props = {
  onSignedIn: (user: AuthUser) => void;
};

export default function AuthGate({ onSignedIn }: Props) {
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(WEB_CLIENT_ID_KEY)?.trim() ?? "";
    setClientId(stored || DEFAULT_WEB_CLIENT_ID);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    localStorage.setItem(WEB_CLIENT_ID_KEY, clientId.trim());
  }, [clientId]);

  const canRenderGoogleButton = useMemo(() => {
    return !!clientId.trim() && !!window.google?.accounts?.id;
  }, [clientId]);

  useEffect(() => {
    const target = document.getElementById("google-signin-slot");
    if (!target || !canRenderGoogleButton) return;
    target.innerHTML = "";

    window.google!.accounts.id.initialize({
      client_id: clientId.trim(),
      callback: async (response) => {
        if (!response.credential) {
          setError("Google 자격증명 토큰을 받지 못했어요.");
          return;
        }
        try {
          setLoading(true);
          setError("");
          const user = await loginWithGoogleIdToken(response.credential);
          onSignedIn(user);
        } catch (e) {
          setError(e instanceof Error ? e.message : "로그인에 실패했어요.");
        } finally {
          setLoading(false);
        }
      },
    });

    window.google!.accounts.id.renderButton(target, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 280,
    });
  }, [canRenderGoogleButton, clientId, onSignedIn]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-6 py-10">
      <p className="text-xs text-zinc-500">Memoryfeed Account</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Google 로그인이 필요해요</h1>
      <p className="mt-2 text-sm text-zinc-600">
        계정별로 같은 피드/메모/소스를 관리하려면 로그인 후 시작해 주세요.
      </p>

      <div className="mt-6 space-y-2">
        <label htmlFor="google-client-id" className="text-xs text-zinc-600">
          Google Web Client ID
        </label>
        <input
          id="google-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="xxxx.apps.googleusercontent.com"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500"
        />
      </div>

      <div className="mt-4 min-h-[48px]">
        {canRenderGoogleButton ? (
          <div id="google-signin-slot" />
        ) : (
          <p className="text-xs text-zinc-500">Client ID를 입력하면 Google 로그인 버튼이 나타나요.</p>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-zinc-500">로그인 처리 중...</p>}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
