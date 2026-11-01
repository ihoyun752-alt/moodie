// MOOD 페이지: 무드 카드 선택과 다음 단계로 이동
// 저장된 뷰티 프로필이 있으면 제품 추천(recommend.html?mood=…)으로, 없으면 프로필 설정(profile.html?mood=…)으로 먼저 보냅니다.
// 주소에 ?mood= 가 있으면 그 카드를 미리 선택합니다.
(function () {
  "use strict";

  var form = document.getElementById("mood-form");
  if (!form) return;

  var store = window.MoodieProfile;
  var cards = form.querySelectorAll(".mood-card");
  var button = document.getElementById("recommend-btn");
  var hint = document.getElementById("mood-hint");
  var profileLine = document.getElementById("mood-profile");
  var profile = null;

  function selectedInput() {
    return form.querySelector('input[name="mood"]:checked');
  }

  function moodName(input) {
    var card = input.closest(".mood-card");
    var en = card.querySelector(".mood-card__en").textContent.trim();
    var ko = card.querySelector(".mood-card__ko").textContent.trim();
    return en + " · " + ko;
  }

  // 저장된 프로필 상태를 버튼 문구와 안내 줄에 반영합니다.
  function showProfile() {
    profile = store ? store.load() : null;
    button.firstChild.textContent = profile ? "다음: 제품 추천 보기 " : "다음: 뷰티 프로필 설정 ";
    profileLine.textContent = "";
    var link = document.createElement("a");
    if (profile) {
      var pc = store.personalColorLabel(profile.personalColor);
      profileLine.appendChild(document.createTextNode(
        "저장된 프로필: " + store.SKIN[profile.skin] + (pc ? " · " + pc : "") + " "
      ));
      link.href = "profile.html";
      link.textContent = "수정";
    } else {
      profileLine.appendChild(document.createTextNode("아직 뷰티 프로필이 없어요. 무드를 고른 뒤 프로필을 저장하면 제품 추천으로 이어져요. "));
      link.href = "profile.html";
      link.textContent = "프로필 먼저 설정하기";
    }
    profileLine.appendChild(link);
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
      : "무드를 하나 선택하면 다음 단계로 넘어갈 수 있어요.";
  }

  // 이전 단계로 돌아온 경우: 주소의 ?mood= 값으로 선택 복원 (목록에 있는 값만)
  var requested = new URLSearchParams(window.location.search).get("mood");
  if (requested && !selectedInput()) {
    var match = form.querySelector('input[name="mood"][value="' + requested.replace(/[^a-z]/g, "") + '"]');
    if (match) match.checked = true;
  }

  form.addEventListener("change", update);

  form.addEventListener("submit", function (event) {
    var input = selectedInput();
    if (!input) {
      event.preventDefault();
      return;
    }
    // 프로필이 없으면 프로필 설정을 거쳐 결과로 갑니다.
    if (!profile) {
      event.preventDefault();
      window.location.href = "profile.html?mood=" + encodeURIComponent(input.value);
    }
  });

  // 뒤로 가기 등으로 브라우저가 선택을 기억하고 있는 경우도 반영
  update();
  showProfile();
  window.addEventListener("pageshow", function () {
    update();
    showProfile();
  });
})();
