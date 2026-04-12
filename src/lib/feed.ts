export const FEED_START_DATE = "2026-04-01";

const TITLE_CANDIDATES = [
  "수면 위로 떠오른 것들",
  "오늘은 이 셋이면 충분하다",
  "다시 보게 된 이유가 있다면",
  "그냥 지나치긴 아쉬운 것들",
  "익숙한데 낯선 단서들",
  "오늘따라 오래 남는 문장들",
  "말없이 붙잡히는 장면들",
  "조용히 다시 열어본 것들",
  "지금의 마음에 닿는 기록",
  "잠깐 멈추게 되는 이유",
  "한 번 더 읽게 된 조각들",
  "어제와는 다른 결의 문장",
  "지나쳤다가 돌아온 생각",
  "오늘의 속도를 바꾸는 힌트",
  "문득 다시 붙는 연결들",
  "가볍게 넘기기 어려운 것",
  "지금 필요한 온도의 문장",
  "늦게 도착한 좋은 단서",
  "한 칸 더 깊어지는 시선",
  "의외로 오래 머무는 장면",
  "잊힌 줄 알았던 감각들",
  "다시 보면 달라지는 조각",
  "오늘의 맥락을 깨우는 것",
  "잠깐의 정적을 만드는 글",
  "익숙함 바깥의 작은 힌트",
  "지금 꺼내기 좋은 기억",
  "어쩐지 오늘 맞는 흐름",
  "생각보다 가까이 있던 단서",
  "한 번쯤 멈춰 볼 이유",
  "계속 남아 있던 여운",
];

export const toIsoDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const shiftDate = (isoDate: string, deltaDays: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return toIsoDate(d);
};

export const getTitleForDate = (isoDate: string) => {
  // Coprime step keeps sequential days from repeating nearby titles.
  const serialDay = Math.floor(new Date(`${isoDate}T00:00:00`).getTime() / 86400000);
  const len = TITLE_CANDIDATES.length;
  const step = 7;
  const offset = 11;
  const idx = ((serialDay * step + offset) % len + len) % len;
  return TITLE_CANDIDATES[idx];
};
