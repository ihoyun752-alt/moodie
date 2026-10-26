// MOOD 페이지: 무드 카드 선택과 추천받기 버튼
// 추천 결과 화면과 추천 계산은 아직 구현 전이므로, 버튼을 누르면 준비 중 안내만 보여 줍니다.
(function () {
  "use strict";

  var form = document.getElementById("mood-form");
  if (!form) return;

  var cards = form.querySelectorAll(".mood-card");
  var button = document.getElementById("recommend-btn");
  var hint = document.getElementById("mood-hint");
  var notice = document.getElementById("mood-notice");
  var noticeText = document.getElementById("mood-notice-text");

  function selectedInput() {
    return form.querySelector('input[name="mood"]:checked');
  }

  function moodName(input) {
    var card = input.closest(".mood-card");
    var en = card.querySelector(".mood-card__en").textContent.trim();
    var ko = card.querySelector(".mood-card__ko").textContent.trim();
    return en + " · " + ko;
  }

  // 선택 상태를 화면에 반영 (:has()를 지원하지 않는 브라우저를 위해 class도 함께 사용)
  function update() {
    var input = selectedInput();
    cards.forEach(function (card) {
      card.classList.toggle("is-selected", card.contains(input));
    });
    button.disabled = !input;
    hint.textContent = input
      ? "선택한 무드: " + moodName(input)
      : "무드를 하나 선택하면 추천받기 버튼이 활성화돼요.";
    notice.hidden = true;
  }

  form.addEventListener("change", update);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var input = selectedInput();
    if (!input) return;
    noticeText.textContent =
      "‘" + moodName(input) + "’ 무드를 선택했어요. 맞춤 추천 결과 화면은 아직 준비 중이에요.";
    notice.hidden = false;
  });

  // 뒤로 가기 등으로 브라우저가 선택을 기억하고 있는 경우도 반영
  update();
})();
