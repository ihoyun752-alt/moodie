// ALL 페이지: data/products.csv의 실제 제품을 카드로 보여 줍니다 (셰이드 1개 = 카드 1장).
// 공식 페이지에서 확인한 기본 정보만 표시하고, 비어 있는 값은 채우지 않습니다. 무드·추천 점수는 표시하지 않습니다.
// 사진은 docs/product-database-design.md 5·8절 기준(경로·종류·출처·허락 근거·확인일)을 모두 갖춘 것만 보여 주고,
// 그렇지 않거나 불러오지 못하면 CSS로 그린 "샘플 이미지"를 보여 줍니다. 반려(rejected)된 행은 보여 주지 않습니다.
(function () {
  "use strict";

  var list = document.getElementById("product-list");
  var status = document.getElementById("products-status");
  if (!list || !status) return;

  var CSV_URL = "data/products.csv";
  var EMPTY = "정보 없음";
  var REQUIRED = ["product_id", "brand", "product_name", "shade_name", "shade_code", "price", "price_checked_at", "product_url", "review_status"];
  // 검수 상태 표시 (docs/product-database-design.md 5절의 허용값). approved는 따로 표시하지 않습니다.
  var REVIEW_LABEL = { pending: "검수 전", "needs-revision": "수정 중" };
  var NO_PRICE = "가격 정보 없음";
  // 이미지 종류 허용값 (설계 문서 5절 "이미지")
  var IMAGE_TYPES = ["licensed", "own-photo"];
  // 색상칩에 쓸 수 있는 HEX 출처 허용값 (설계 문서 5절 "관리용 코드")
  var HEX_SOURCES = ["official", "retailer", "swatch-measured"];

  // RFC 4180 방식의 CSV 해석: 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈과 "" (따옴표 한 개)를 처리합니다.
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 제거
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    // 완전히 빈 줄은 버립니다.
    return rows.filter(function (r) { return r.length > 1 || r[0] !== ""; });
  }

  // 머리글 이름으로 접근할 수 있는 객체 목록으로 바꿉니다. 칸 수가 머리글과 다른 행은 버립니다.
  function toRecords(rows) {
    var header = rows[0] || [];
    var missing = REQUIRED.filter(function (name) { return header.indexOf(name) < 0; });
    if (missing.length) throw new Error("CSV에 필요한 컬럼이 없습니다: " + missing.join(", "));
    return rows.slice(1).filter(function (r) { return r.length === header.length; }).map(function (r) {
      var record = {};
      header.forEach(function (name, i) { record[name] = r[i].trim(); });
      return record;
    });
  }

  function orEmpty(value) {
    return value ? value : EMPTY;
  }

  function formatPrice(value) {
    if (!/^\d+$/.test(value)) return "";
    return Number(value).toLocaleString("ko-KR") + "원";
  }

  // 공식 페이지 주소는 http(s)만 링크로 만듭니다.
  function safeUrl(value) {
    return /^https?:\/\//i.test(value) ? value : "";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 사진 경로는 저장소 안 assets/products/ 아래의 이미지 파일만 받습니다 (외부 주소·상위 폴더 이동 금지).
  function safeImagePath(value) {
    if (!/^assets\/products\/[^?#]+\.(jpe?g|png|webp)$/i.test(value)) return "";
    if (value.indexOf("..") >= 0 || value.indexOf("//") >= 0 || value.indexOf("\\") >= 0) return "";
    return value;
  }

  // prefix = "product_image" 또는 "swatch_image". 경로·종류·출처·허락 근거·확인일이 모두 맞을 때만 사진 정보를 돌려줍니다.
  function verifiedImage(p, prefix) {
    var src = safeImagePath(p[prefix]);
    var ok = src &&
      IMAGE_TYPES.indexOf(p[prefix + "_type"]) >= 0 &&
      p[prefix + "_credit"] &&
      p[prefix + "_permission"] &&
      /^\d{4}-\d{2}-\d{2}$/.test(p[prefix + "_checked_at"]);
    return ok ? { src: src, credit: p[prefix + "_credit"] } : null;
  }

  // 색상칩: hex_color와 hex_source가 모두 확인된 경우에만 색을 돌려줍니다.
  function verifiedHex(p) {
    return /^#[0-9a-f]{6}$/i.test(p.hex_color) && HEX_SOURCES.indexOf(p.hex_source) >= 0 ? p.hex_color : "";
  }

  function productLabel(p) {
    return [p.brand, p.product_name, p.shade_name].filter(Boolean).join(" ");
  }

  // 샘플 이미지: 실제 제품 사진이 아님을 배지로 밝히고, 셰이드 색처럼 보이지 않는 중립 그림만 보여 줍니다.
  function sampleArt() {
    var sample = el("div", "product-card__sample");
    sample.setAttribute("role", "img");
    sample.setAttribute("aria-label", "샘플 이미지 (실제 제품 사진이 아니에요)");
    sample.appendChild(el("span", "product-card__sample-art"));
    sample.appendChild(el("span", "product-card__sample-tag", "샘플 이미지"));
    return sample;
  }

  // 사진 영역: 검증된 제품 사진이 있으면 사진과 출처를, 없거나 불러오지 못하면 샘플 이미지를 보여 줍니다.
  function renderMedia(p) {
    var media = el("figure", "product-card__media");
    var photo = verifiedImage(p, "product_image");
    if (!photo) {
      media.classList.add("is-sample");
      media.appendChild(sampleArt());
      return media;
    }
    var img = el("img", "product-card__photo");
    img.src = photo.src;
    img.alt = productLabel(p) + " 제품 사진";
    img.loading = "lazy";
    img.decoding = "async";
    var caption = el("figcaption", "product-card__credit", photo.credit);
    img.addEventListener("error", function () {
      if (window.console) window.console.warn("제품 사진을 불러오지 못해 샘플 이미지로 바꿉니다:", photo.src);
      media.classList.add("is-sample");
      media.replaceChild(sampleArt(), img);
      if (caption.parentNode) caption.parentNode.removeChild(caption);
    });
    media.appendChild(img);
    media.appendChild(caption);
    return media;
  }

  // 셰이드 발색 사진: 이 셰이드와 일치한다고 확인된 사진만 보여 주고, 없거나 불러오지 못하면 아무것도 보여 주지 않습니다.
  function renderSwatch(p) {
    var swatch = verifiedImage(p, "swatch_image");
    if (!swatch) return null;
    var figure = el("figure", "product-card__swatch");
    var img = el("img", "product-card__swatch-img");
    img.src = swatch.src;
    img.alt = productLabel(p) + " 발색 사진";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", function () {
      if (window.console) window.console.warn("발색 사진을 불러오지 못해 숨깁니다:", swatch.src);
      if (figure.parentNode) figure.parentNode.removeChild(figure);
    });
    figure.appendChild(img);
    figure.appendChild(el("figcaption", "product-card__credit", swatch.credit));
    return figure;
  }

  function renderCard(p) {
    var item = el("li", "product-card");
    item.appendChild(renderMedia(p));

    var review = REVIEW_LABEL[p.review_status];
    if (review) item.appendChild(el("span", "badge product-card__review", review));

    var body = el("div", "product-card__body");
    body.appendChild(el("p", "product-card__brand", orEmpty(p.brand)));
    body.appendChild(el("h2", "product-card__name", orEmpty(p.product_name)));

    // 셰이드: [색상칩] 번호 셰이드명. 칩은 검증된 HEX가 있을 때만 그립니다.
    var shade = el("p", "product-card__shade");
    var hex = verifiedHex(p);
    if (hex) {
      var chip = el("span", "product-card__chip");
      chip.style.backgroundColor = hex;
      chip.setAttribute("aria-hidden", "true");
      shade.appendChild(chip);
    }
    if (p.shade_code) shade.appendChild(el("span", "product-card__shade-code", p.shade_code));
    shade.appendChild(el("span", "product-card__shade-name", orEmpty(p.shade_name)));
    body.appendChild(shade);

    var swatch = renderSwatch(p);
    if (swatch) body.appendChild(swatch);

    var price = formatPrice(p.price);
    body.appendChild(el("p", "product-card__price" + (price ? "" : " is-empty"), price || NO_PRICE));

    // 보조 정보: 가격 확인일 · 공식 페이지 링크
    var meta = el("p", "product-card__meta");
    meta.appendChild(el("span", p.price_checked_at ? "" : "is-empty",
      "가격 확인일 " + orEmpty(p.price_checked_at)));
    var url = safeUrl(p.product_url);
    if (url) {
      var link = el("a", "product-card__link", "상세 보기");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(el("span", "visually-hidden", " (" + productLabel(p) + " 공식 페이지, 새 창)"));
      meta.appendChild(link);
    } else {
      meta.appendChild(el("span", "is-empty", "공식 페이지 " + EMPTY));
    }
    body.appendChild(meta);

    item.appendChild(body);
    return item;
  }

  function showError() {
    status.textContent = "제품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
    status.classList.add("is-error");
    list.hidden = true;
  }

  // 카테고리 탭: data-category 값이 CSV의 category 값과 같습니다 ("all"은 전체). 개수는 불러온 데이터로 매번 다시 셉니다.
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".product-filter__tab"));
  var CATEGORY_LABEL = { all: "전체", lip: "립", cheek: "치크", base: "베이스", eye: "아이섀도우" };
  var products = null; // 불러오기 전에는 null
  var current = "all";

  function inCategory(category) {
    return category === "all" ? products : products.filter(function (p) { return p.category === category; });
  }

  function updateCounts() {
    tabs.forEach(function (tab) {
      var count = tab.querySelector(".product-filter__count");
      if (count) count.textContent = inCategory(tab.getAttribute("data-category")).length + "개";
    });
  }

  function render() {
    var shown = inCategory(current);
    list.textContent = "";
    shown.forEach(function (p) {
      try {
        list.appendChild(renderCard(p));
      } catch (error) {
        if (window.console) window.console.error("제품 카드를 만들지 못했습니다:", p.product_id, error);
      }
    });
    list.hidden = shown.length === 0;
    list.setAttribute("data-count", String(shown.length));
    var label = CATEGORY_LABEL[current] || "";
    if (!products.length) {
      status.textContent = "아직 보여 드릴 제품이 없어요.";
    } else if (!shown.length) {
      status.textContent = label + " 제품은 아직 없어요.";
    } else {
      status.textContent = (current === "all" ? "실제 제품 " : label + " 제품 ") + shown.length + "개를 보여 드려요.";
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      current = tab.getAttribute("data-category");
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (products) render(); // 불러오는 중이면 불러온 뒤 이 탭으로 그립니다
    });
  });

  fetch(CSV_URL, { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    })
    .then(function (text) {
      products = toRecords(parseCsv(text)).filter(function (p) {
        return p.product_id && p.review_status !== "rejected";
      });
      updateCounts();
      render();
    })
    .catch(function (error) {
      if (window.console) window.console.error("products.csv 불러오기 실패:", error);
      showError();
    });
})();
