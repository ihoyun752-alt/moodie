// 마이페이지: 저장된 뷰티 프로필 요약, 수정 링크, 삭제
(function () {
  "use strict";

  var store = window.MoodieProfile;
  var card = document.getElementById("mypage-profile");
  if (!store || !card) return;

  var empty = document.getElementById("mypage-empty");
  var message = document.getElementById("mypage-message");

  function render() {
    var profile = store.load();
    card.hidden = !profile;
    empty.hidden = Boolean(profile);
    if (!profile) return;
    store.renderSummary(document.getElementById("mypage-summary"), profile);
    var updated = profile.updatedAt ? new Date(profile.updatedAt) : null;
    document.getElementById("mypage-updated").textContent = updated && !isNaN(updated)
      ? "마지막 저장: " + updated.toLocaleString("ko-KR")
      : "";
  }

  document.getElementById("mypage-delete").addEventListener("click", function () {
    if (!window.confirm("저장한 뷰티 프로필을 삭제할까요? 삭제하면 되돌릴 수 없어요.")) return;
    message.textContent = store.clear()
      ? "프로필을 삭제했어요."
      : "이 브라우저에서는 저장소에 접근할 수 없어 삭제하지 못했어요.";
    render();
  });

  render();
  // 뒤로 가기로 돌아온 경우에도 최신 프로필을 보여 줍니다.
  window.addEventListener("pageshow", render);
})();
