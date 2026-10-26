// moodie. 공통 동작: 전체 메뉴(≡), 준비 중 기능 안내, 손글씨 글꼴 미리보기
(function () {
  "use strict";

  // 손글씨 글꼴 미리보기: 주소 끝에 ?script=pinyon | allura | greatvibes 를 붙이면 바꿔 볼 수 있습니다.
  var scriptFonts = ["pinyon", "allura", "greatvibes"];
  var requested = new URLSearchParams(window.location.search).get("script");
  if (scriptFonts.indexOf(requested) !== -1) {
    document.documentElement.setAttribute("data-script", requested);
  }

  // 안내 메시지 (화면 아래에 잠깐 나타났다 사라짐, 화면 낭독기도 읽어 줌)
  var toast = document.querySelector("[data-toast]");
  var toastTimer;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  window.moodieToast = showToast;

  // 아직 기능이 없는 버튼 (검색, 장바구니)
  document.querySelectorAll("[data-soon]").forEach(function (button) {
    button.addEventListener("click", function () {
      showToast(button.getAttribute("data-soon") + " 기능은 준비 중이에요.");
    });
  });

  // 전체 메뉴 (≡)
  var toggle = document.querySelector("[data-menu-toggle]");
  var panel = toggle && document.getElementById(toggle.getAttribute("aria-controls"));
  if (!toggle || !panel) return;

  function setMenu(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "전체 메뉴 닫기" : "전체 메뉴 열기");
    if (open) {
      var first = panel.querySelector("a");
      if (first) first.focus();
    }
  }

  toggle.addEventListener("click", function () {
    setMenu(panel.hidden);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) {
      setMenu(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", function (event) {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) {
      setMenu(false);
    }
  });
})();
