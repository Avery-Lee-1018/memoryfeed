type FeedCard = {
  title: string;
  source: string;
  summary: string;
};

const placeholderCard: FeedCard = {
  title: "오늘의 기억 카드 (Placeholder)",
  source: "sample source",
  summary: "Phase 1에서는 API 연동 대신 하드코딩 데이터로 카드 1장만 렌더링합니다."
};

export default function App() {
  return (
    <main className="page">
      <header>
        <h1>Memory Feed</h1>
        <p>Home (MVP Phase 1)</p>
      </header>

      <section className="card">
        <h2>{placeholderCard.title}</h2>
        <p className="meta">{placeholderCard.source}</p>
        <p>{placeholderCard.summary}</p>
      </section>
    </main>
  );
}
