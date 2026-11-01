// 공용: data/products.csv 불러오기·해석과 제품 표시 도우미 (window.MoodieProducts)
// ALL 페이지(js/all-page.js)는 자체 파서를 그대로 쓰고, 추천·결과 페이지가 이 파일을 씁니다. 해석 규칙은 all-page.js와 같습니다.
(function () {
  "use strict";

  // 어떤 CSV를 쓸지는 js/data-mode.js가 정합니다. 기본은 시연 복사본(products-demo.csv), ?data=real이면 원본(products.csv).
  function csvUrl() {
    return window.MoodieDataMode ? window.MoodieDataMode.csvUrl : "data/products-demo.csv";
  }
  // 추천 계산과 화면에 필요한 컬럼 (docs/product-database-design.md 3절)
  var REQUIRED = [
    "product_id", "product_group_id", "brand", "product_name", "category", "shade_name", "shade_code",
    "personal_color", "mood_pure", "mood_nude", "mood_modern", "mood_lovely", "mood_chic", "mood_glam", "mood_hip",
    "skin_type_tags", "skin_type_caution", "skin_concern_tags", "skin_suitability",
    "review_status", "is_available", "product_image"
  ];
  var IMAGE_TYPES = ["licensed", "own-photo", "ai-generated"];
  var HEX_SOURCES = ["official", "retailer", "swatch-measured", "mixed"];

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
    return rows.filter(function (r) { return r.length > 1 || r[0] !== ""; });
  }

  // 머리글 이름으로 접근하는 객체 목록. 필요한 컬럼이 없으면 오류, 칸 수가 머리글과 다른 행은 버립니다.
  function toRecords(rows) {
    var header = rows[0] || [];
    var missing = REQUIRED.filter(function (name) { return header.indexOf(name) < 0; });
    if (missing.length) throw new Error("CSV에 필요한 컬럼이 없습니다: " + missing.join(", "));
    return rows.slice(1).filter(function (r) { return r.length === header.length; }).map(function (r) {
      var record = {};
      header.forEach(function (name, i) { record[name] = r[i].trim(); });
      return record;
    }).filter(function (p) { return p.product_id; });
  }

  // 제품 목록을 불러옵니다. 성공하면 행 객체 배열, 실패하면 reject.
  function load() {
    return fetch(csvUrl(), { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (text) { return toRecords(parseCsv(text)); });
  }

  // 보조 CSV(시뮬레이션 색·팔레트 구성)는 필수 컬럼 검사 없이 머리글 이름으로 읽습니다.
  function records(text) {
    var rows = parseCsv(text);
    var head = rows[0] || [];
    return rows.slice(1).filter(function (r) { return r.length === head.length; }).map(function (r) {
      var record = {};
      head.forEach(function (name, i) { record[name] = (r[i] || "").trim(); });
      return record;
    });
  }

  function loadRecords(url, optional) {
    return fetch(url, { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) {
          if (optional) return "";
          throw new Error("HTTP " + response.status);
        }
        return response.text();
      })
      .then(function (text) { return text ? records(text) : []; });
  }

  // 승인된 시뮬레이션 표시용 색만 돌려줍니다 (임의 색 금지).
  function loadSimulationColors() {
    return loadRecords("data/simulation-colors.csv", false).then(function (rows) {
      return rows.filter(function (c) {
        return c.status === "approved" && /^#[0-9a-f]{6}$/i.test(c.sim_hex);
      });
    });
  }

  // 팔레트 개별 칸 구성(참고값 포함). 파일이 없으면 빈 배열입니다.
  function loadPalette() {
    return loadRecords("data/palette-colors.csv", true);
  }

  // 사진 경로는 저장소 안 assets/products/ 아래의 이미지 파일만 받습니다 (all-page.js와 같은 기준).
  function safeImagePath(value) {
    if (!/^assets\/products\/[^?#]+\.(jpe?g|png|webp)$/i.test(value)) return "";
    if (value.indexOf("..") >= 0 || value.indexOf("//") >= 0 || value.indexOf("\\") >= 0) return "";
    return value;
  }

  // 경로·종류·출처·허락 근거·확인일이 모두 맞을 때만 사진 정보를 돌려줍니다 (설계 문서 8절 "화면 표시 기준").
  function verifiedImage(p, prefix) {
    var src = safeImagePath(p[prefix]);
    var ok = src &&
      IMAGE_TYPES.indexOf(p[prefix + "_type"]) >= 0 &&
      p[prefix + "_credit"] &&
      p[prefix + "_permission"] &&
      /^\d{4}-\d{2}-\d{2}$/.test(p[prefix + "_checked_at"]);
    return ok ? { src: src, credit: p[prefix + "_credit"], isAi: p[prefix + "_type"] === "ai-generated" } : null;
  }

  // 색상칩: hex_color와 hex_source가 모두 확인된 경우에만 색을 돌려줍니다.
  function verifiedHex(p) {
    return /^#[0-9a-f]{6}$/i.test(p.hex_color) && HEX_SOURCES.indexOf(p.hex_source) >= 0 ? p.hex_color : "";
  }

  function shadeLabel(p) {
    return [p.shade_code, p.shade_name].filter(Boolean).join(" ");
  }

  function productLabel(p) {
    return [p.brand, p.product_name, p.shade_name].filter(Boolean).join(" ");
  }

  window.MoodieProducts = {
    load: load,
    loadRecords: loadRecords,
    loadSimulationColors: loadSimulationColors,
    loadPalette: loadPalette,
    parseCsv: parseCsv,
    toRecords: toRecords,
    verifiedImage: verifiedImage,
    verifiedHex: verifiedHex,
    shadeLabel: shadeLabel,
    productLabel: productLabel
  };
})();
