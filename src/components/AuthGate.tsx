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
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <p className="text-xs text-zinc-500">Memoryfeed Account</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Google 로그인이 필요해요</h1>
      <p className="mt-2 w-full break-keep text-sm text-zinc-600">
        계정별로 같은 피드/메모/소스를 관리하려면 로그인 후 시작해 주세요.
      </p>

      <div className="mt-4 min-h-[48px]">
        {canRenderGoogleButton ? (
          <div id="google-signin-slot" />
        ) : (
          <p className="text-xs text-zinc-500">로그인 설정을 불러오는 중이에요.</p>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-zinc-500">로그인 처리 중...</p>}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
