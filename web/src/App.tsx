import PlayPage from "./pages/PlayPage";

/**
 * 앱 셸. 페이지 골격만 잡아둔 상태 — 라우팅은 D2 에 채집/뷰어가 생기면 붙인다.
 * (react-router 도입 여부는 B 가 결정)
 */
function App() {
  return (
    <main>
      <h1>세상을 악기로 만드는 카메라</h1>
      <PlayPage />
    </main>
  );
}

export default App;
