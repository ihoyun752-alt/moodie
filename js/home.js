// 메인 페이지: 출석체크 주간 날짜 표시, 슬라이더(이전/다음, 현재/전체 번호, 마우스 끌기)
// 출석 기록은 저장하지 않습니다.
(function () {
  "use strict";

  var today = new Date();

  // 출석체크: 이번 주(월~일) 날짜와 오늘 위치만 표시합니다.
  var week = document.getElementById("attendance-week");
  if (week) {
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    week.querySelectorAll("li").forEach(function (item, i) {
      var date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      item.querySelector(".attendance__date").textContent = (date.getMonth() + 1) + "/" + date.getDate();
      if (date.toDateString() === today.toDateString()) {
        item.classList.add("is-today");
        item.setAttribute("aria-current", "date");
      }
    });
  }

  // 슬라이더: 카드 한 장이 트랙 너비를 꽉 채웁니다. 현재 카드 번호 = 스크롤 위치 ÷ 트랙 너비 (반올림).
  // 스와이프·트랙패드·Shift+휠·키보드 화살표는 브라우저 기본 스크롤이고, 어떤 방법으로 넘겨도 scroll 이벤트로 번호를 갱신합니다.
  // 슬라이더마다 자기 트랙과 자기 버튼·번호만 다루므로 서로 영향을 주지 않습니다.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll(".slider").forEach(function (slider) {
    var track = slider.querySelector(".slider__track");
    if (!track) return;
    var slides = Array.prototype.slice.call(track.children);
    var total = slides.length;
    var prev = slider.querySelector('.carousel-btn[data-dir="-1"]');
    var next = slider.querySelector('.carousel-btn[data-dir="1"]');
    var current = slider.querySelector("[data-current]");
    slider.querySelector("[data-total]").textContent = total;
    var index = -1;

    // 화면 낭독기용: 각 카드에 "n/전체"를 붙이고, 보이지 않는 카드는 읽지 않게 합니다.
    slides.forEach(function (slide, i) {
      slide.setAttribute("aria-label", (i + 1) + "/" + total);
    });

    function currentIndex() {
      var width = track.clientWidth || 1;
      return Math.min(total - 1, Math.max(0, Math.round(track.scrollLeft / width)));
    }

    function update() {
      var i = currentIndex();
      if (i === index) return;
      index = i;
      current.textContent = i + 1;
      prev.disabled = i === 0;
      next.disabled = i === total - 1;
      slides.forEach(function (slide, n) {
        slide.setAttribute("aria-hidden", n === i ? "false" : "true");
        // 보이지 않는 카드 안의 버튼·링크는 Tab으로 가지 않게 합니다.
        slide.querySelectorAll("a, button").forEach(function (el) {
          if (n === i) {
            if (el.hasAttribute("data-slider-tabindex")) {
              el.removeAttribute("tabindex");
              el.removeAttribute("data-slider-tabindex");
            }
          } else if (!el.hasAttribute("data-slider-tabindex")) {
            el.setAttribute("tabindex", "-1");
            el.setAttribute("data-slider-tabindex", "");
          }
        });
      });
    }

    function go(i) {
      var target = Math.min(total - 1, Math.max(0, i));
      track.scrollTo({ left: target * track.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
    }

    prev.addEventListener("click", function () { go(currentIndex() - 1); });
    next.addEventListener("click", function () { go(currentIndex() + 1); });

    // 스크롤이 일어날 때마다(스와이프·트랙패드·버튼 모두) 번호를 바로 갱신합니다.
    var frame = 0;
    track.addEventListener("scroll", function () {
      if (frame) return;
      frame = window.requestAnimationFrame(function () {
        frame = 0;
        update();
      });
    }, { passive: true });

    // 화면 크기가 바뀌면 보고 있던 카드가 시작 위치에 다시 맞도록 합니다.
    window.addEventListener("resize", function () {
      track.scrollTo({ left: Math.max(index, 0) * track.clientWidth, behavior: "auto" });
      update();
    });

    // 마우스로 끌어서 넘기기 (터치는 브라우저 기본 스와이프 사용). 놓으면 가장 가까운 카드로 맞춥니다.
    var startX = 0;
    var startScroll = 0;
    var pointer = null;
    var dragged = false;

    track.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pointer = event.pointerId;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      dragged = false;
    });

    track.addEventListener("pointermove", function (event) {
      if (event.pointerId !== pointer) return;
      var dx = event.clientX - startX;
      if (!dragged && Math.abs(dx) > 6) {
        dragged = true;
        track.classList.add("is-dragging");
        track.setPointerCapture(pointer);
      }
      if (dragged) track.scrollLeft = startScroll - dx;
    });

    function endDrag(event) {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (dragged) {
        track.classList.remove("is-dragging");
        go(currentIndex());
      }
      // 끌기 직후의 클릭만 막고, 그 뒤의 클릭(키보드 포함)은 그대로 둡니다.
      window.setTimeout(function () { dragged = false; }, 0);
    }

    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    track.addEventListener("click", function (event) {
      if (dragged) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    update();
  });
})();
