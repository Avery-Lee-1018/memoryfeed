const titleEl = document.querySelector("#title");
const descEl = document.querySelector("#desc");
const errorEl = document.querySelector("#error");
const loginBtn = document.querySelector("#loginBtn");
const logoutBtn = document.querySelector("#logoutBtn");

function setBusy(isBusy) {
  loginBtn.disabled = isBusy;
  logoutBtn.disabled = isBusy;
}

function renderLoggedOut() {
  titleEl.textContent = "로그인이 필요해요";
  descEl.textContent = "Google 계정으로 연동해 주세요.";
  loginBtn.hidden = false;
  logoutBtn.hidden = true;
}

function renderLoggedIn(user) {
  const displayName = user?.displayName || user?.email || "사용자";
  titleEl.textContent = `${displayName}`;
  descEl.textContent = "연동 완료. 이제 확장 기능에서 같은 계정을 쓸 수 있어요.";
  loginBtn.hidden = true;
  logoutBtn.hidden = false;
}

function send(action) {
  return chrome.runtime.sendMessage({ action });
}

async function refresh() {
  errorEl.textContent = "";
  const result = await send("me");
  if (result?.ok && result.user) renderLoggedIn(result.user);
  else renderLoggedOut();
}

loginBtn.addEventListener("click", async () => {
  setBusy(true);
  errorEl.textContent = "";
  try {
    const result = await send("login");
    if (!result?.ok) throw new Error(result?.error || "LOGIN_FAILED");
    renderLoggedIn(result.user);
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : "로그인 실패";
  } finally {
    setBusy(false);
  }
});

logoutBtn.addEventListener("click", async () => {
  setBusy(true);
  errorEl.textContent = "";
  try {
    const result = await send("logout");
    if (!result?.ok) throw new Error(result?.error || "LOGOUT_FAILED");
    renderLoggedOut();
  } catch (error) {
    errorEl.textContent = error instanceof Error ? error.message : "로그아웃 실패";
  } finally {
    setBusy(false);
  }
});

refresh().catch((error) => {
  errorEl.textContent = error instanceof Error ? error.message : "초기화 실패";
});
