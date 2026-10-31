// 결과 요약 페이지: 주소의 무드(?mood=)와 저장된 뷰티 프로필(localStorage)을 함께 보여 줍니다.
// 제품 데이터와 추천 계산은 아직 없으므로 제품, 점수, 순위는 표시하지 않습니다.
(function () {
  "use strict";

  var store = window.MoodieProfile;
  var summary = document.getElementById("result-summary");
  if (!store || !summary) return;

  var mood = new URLSearchParams(window.location.search).get("mood");
  var profile = store.load();

  // 무드가 없거나 목록에 없는 값이면 무드 선택으로, 프로필이 없으면 프로필 설정으로 안내합니다.
  if (!store.isMood(mood) || !profile) {
    if (store.isMood(mood)) {
      document.getElementById("result-missing-text").textContent = "저장된 뷰티 프로필이 없어요. 프로필을 저장하면 이 무드의 결과로 돌아와요.";
      document.getElementById("result-missing-label").textContent = "프로필 설정하기";
      document.getElementById("result-missing-link").href = "profile.html?mood=" + mood;
    } else {
      document.getElementById("result-missing-text").textContent = "선택한 무드 정보가 없거나 올바르지 않아요. 무드부터 다시 골라 주세요.";
    }
    document.getElementById("result-missing").hidden = false;
    return;
  }

  // 확정된 수정본이 있는 무드는 assets/moods/edit/, 나머지(GLAM, HIP)는 원본을 씁니다. mood.html 카드와 같은 이미지입니다.
  var EDITED_MOODS = ["pure", "nude", "modern", "lovely", "chic"];
  var photoDir = EDITED_MOODS.indexOf(mood) >= 0 ? "assets/moods/edit/" : "assets/moods/";
  document.getElementById("result-photo").src = photoDir + mood + ".png";
  document.getElementById("result-mood-name").textContent = store.moodLabel(mood);
  store.renderSummary(document.getElementById("result-profile"), profile);

  // 프로필을 고친 뒤 같은 무드의 결과로 돌아올 수 있게 무드를 함께 넘깁니다.
  document.getElementById("result-edit").href = "profile.html?mood=" + mood;
  document.getElementById("result-remood").href = "mood.html?mood=" + mood;

  summary.hidden = false;
})();
