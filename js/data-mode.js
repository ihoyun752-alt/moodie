// 데이터 모드 (window.MoodieDataMode): 기본은 시연 데이터(data/products-demo.csv)입니다.
// 주소에 ?data=real을 붙이면 실제 data/products.csv의 승인 상태를 그대로 씁니다. ?data=demo로 되돌릴 수 있습니다.
// 고른 모드는 이 탭(sessionStorage)에서 페이지를 옮겨도 유지하고, 모든 페이지 상단에 배지로 표시합니다.
(function () {
  "use strict";

  var KEY = "moodie.dataMode";
  var CSV = { demo: "data/products-demo.csv", real: "data/products.csv" };
  var param = new URLSearchParams(window.location.search).get("data");
  var mode = "demo";
  try {
    if (param === "real" || param === "demo") window.sessionStorage.setItem(KEY, param);
    if (window.sessionStorage.getItem(KEY) === "real") mode = "real";
  } catch (e) {
    mode = param === "real" ? "real" : "demo";
  }

  // 화면 모드: 기본은 고객 화면(내부 점수·근거·검수 정보 숨김). ?view=dev를 붙이면 이 탭에서 개발 화면(모든 정보 표시).
  // 숨김은 css/pages.css의 html:not(.view-dev) 규칙으로 처리하고, DOM에는 그대로 남겨 테스트가 읽을 수 있습니다.
  var VIEW_KEY = "moodie.view";
  var viewParam = new URLSearchParams(window.location.search).get("view");
  var view = "customer";
  try {
    if (viewParam === "dev" || viewParam === "customer") window.sessionStorage.setItem(VIEW_KEY, viewParam);
    if (window.sessionStorage.getItem(VIEW_KEY) === "dev") view = "dev";
  } catch (e) {
    view = viewParam === "dev" ? "dev" : "customer";
  }
  if (view === "dev") document.documentElement.classList.add("view-dev");

  var isDemo = mode === "demo";
  var BADGE = isDemo ? "시연 데이터 · 가상 승인 정보 포함" : "실제 데이터 · products.csv의 승인 상태 그대로 표시";
  var OTHER = isDemo ? "real" : "demo";
  var OTHER_LABEL = isDemo ? "실제 데이터로 보기" : "시연 데이터로 보기";

  window.MoodieDataMode = {
    mode: mode,
    isDemo: isDemo,
    csvUrl: CSV[mode],
    badge: BADGE,
    view: view,
    isCustomer: view === "customer"
  };

  function addBar() {
    if (!document.body || document.querySelector(".data-mode-bar")) return;
    if (view === "customer") return; // 고객 화면에서는 데이터 모드 띠를 보이지 않습니다

    var style = document.createElement("style");
    style.textContent =
      ".data-mode-bar{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 14px;padding:8px 16px;font-size:13px;line-height:1.4;border-bottom:1px solid #d9c9a8;}" +
      ".data-mode-bar.is-demo{background:#fff3cf;color:#5c4612;}" +
      ".data-mode-bar.is-real{background:#e3f0e6;color:#1f4a2c;border-bottom-color:#b9d6c0;}" +
      ".data-mode-bar strong{font-weight:600;}" +
      ".data-mode-bar a{color:inherit;text-decoration:underline;}";
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.className = "data-mode-bar is-" + mode;
    bar.setAttribute("role", "status");
    bar.setAttribute("data-data-mode", mode);
    var strong = document.createElement("strong");
    strong.textContent = BADGE;
    bar.appendChild(strong);

    var url = new URL(window.location.href);
    url.searchParams.set("data", OTHER);
    var link = document.createElement("a");
    link.href = url.pathname + url.search + url.hash;
    link.textContent = OTHER_LABEL;
    bar.appendChild(link);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.body) addBar();
  else document.addEventListener("DOMContentLoaded", addBar);
})();
