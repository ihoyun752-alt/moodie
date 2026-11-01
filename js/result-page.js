// 결과 요약 페이지: 주소의 무드(?mood=)와 저장된 뷰티 프로필(localStorage), 추천 페이지에서 고른 제품(moodie.selection)을 함께 보여 줍니다.
// 레이아웃: 왼쪽 = 메이크업 시뮬레이션(js/simulation.js) + 뷰티 프로필, 오른쪽 = 오늘의 무드 + 사용한 추천 제품 (2026-11-02 담당자 예시)
// v7: 선택한 product_id·셰이드·색상 상태를 카드에 함께 표시하고, 아이 팔레트 구성과 치크 양쪽 볼 적용 영역을 보여 줍니다.
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

  // 무드 카드 설명 (docs/design.md 6절, mood.html 카드 문구와 같음)
  var MOOD_DESC = {
    pure: "맑은 피부에 은은한 생기",
    nude: "차분한 가을빛의 누디한 무드",
    modern: "정돈된 선과 세련된 분위기",
    lovely: "화사한 혈색과 사랑스러운 눈매",
    chic: "날렵한 눈매와 차가운 분위기",
    glam: "빛나는 눈가와 선명한 립",
    hip: "개성 있는 컬러와 그래픽 포인트"
  };
  var MOOD_NAME = { pure: "PURE", nude: "NUDE", modern: "MODERN", lovely: "LOVELY", chic: "CHIC", glam: "GLAM", hip: "HIP" };
  var AREA_LABEL = {
    lip: "입술", "cheek-l": "왼쪽 볼", "cheek-r": "오른쪽 볼",
    "eyelid-l": "왼쪽 눈꺼풀", "eyelid-r": "오른쪽 눈꺼풀", skin: "얼굴 피부"
  };

  // 확정된 수정본이 있는 무드는 assets/moods/edit/, 나머지(GLAM, HIP)는 원본을 씁니다. mood.html 카드와 같은 이미지입니다.
  var EDITED_MOODS = ["pure", "nude", "modern", "lovely", "chic"];
  var photoDir = EDITED_MOODS.indexOf(mood) >= 0 ? "assets/moods/edit/" : "assets/moods/";
  document.getElementById("result-photo").src = photoDir + mood + ".png";
  document.getElementById("result-mood-name").textContent = store.moodLabel(mood);
  document.getElementById("result-mood-desc").textContent = MOOD_DESC[mood] + " · " + MOOD_NAME[mood] + " 무드의 메이크업이에요.";
  store.renderSummary(document.getElementById("result-profile"), profile);

  // 프로필을 고친 뒤 같은 무드의 결과로 돌아올 수 있게 무드를 함께 넘깁니다.
  document.getElementById("result-edit").href = "profile.html?mood=" + mood;
  document.getElementById("result-remood").href = "mood.html?mood=" + mood;
  document.getElementById("result-repick").href = "recommend.html?mood=" + mood;

  summary.hidden = false;
  var resultNotice = document.getElementById("result-notice");
  if (resultNotice && window.MoodieDataMode) {
    resultNotice.textContent = window.MoodieDataMode.isDemo
      ? "시연용 가상 데이터로 구성된 결과입니다. 실제 제품 검수 및 판매 상태를 의미하지 않습니다. 승인 정보는 시연용 가상 승인입니다."
      : "실제 데이터 모드의 결과입니다. 제품의 검수·판매 상태와 색상은 data/products.csv와 승인된 시뮬레이션 색 기록을 따릅니다.";
  }
  renderPicks();

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function list(value) {
    return value ? value.split("|").map(function (v) { return v.trim(); }).filter(Boolean) : [];
  }

  function chip(hex) {
    var node = el("span", "result-pick__chip");
    node.style.backgroundColor = hex;
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  // 고객 화면: HEX·product_id·적용 영역·검수/근거 문구는 css/pages.css에서 숨기고(DOM에는 남김), 아래 고객용 문구를 씁니다.
  var CUSTOMER = !window.MoodieDataMode || window.MoodieDataMode.isCustomer;
  var MOOD_NAME = { pure: "PURE", nude: "NUDE", modern: "MODERN", lovely: "LOVELY", chic: "CHIC", glam: "GLAM", hip: "HIP" };

  function customerBadge(category, p) {
    if (category === "base") return list(p.skin_type_tags).length ? ["피부 맞춤", "추천"] : ["베이스", "선택 제품"];
    if (p.mood_tag_status === "approved" && list(p.mood_primary).indexOf(mood) >= 0) return [MOOD_NAME[mood], "무드 추천"];
    if (p.mood_tag_status === "approved" && list(p.mood_secondary).indexOf(mood) >= 0) return [MOOD_NAME[mood], "무드와 어울림"];
    return ["선택한", "제품"];
  }

  // 미리보기(얼굴 시뮬레이션)에 색이 반영되는지: 승인된 시뮬레이션 색 또는 승인된 팔레트 칸이 있을 때만
  function hasPreview(p, ctx) {
    return ctx.simColors.some(function (c) { return c.product_id === p.product_id; }) ||
      ctx.palette.some(function (c) { return c.product_id === p.product_id && c.status === "approved"; });
  }

  // 카드 오른쪽 배지: 립·치크·아이는 무드 태그 일치(대표/보조), 색감 근거 보완, 베이스는 피부 정보 그룹.
  function badgeText(category, p) {
    if (CUSTOMER) return customerBadge(category, p);
    if (category === "base") {
      if (!list(p.skin_type_tags).length) return ["피부 정보", "미확인"];
      return ["피부 맞춤", list(p.skin_concern_tags).length ? "(A그룹)" : "(B그룹)"];
    }
    if (p.mood_tag_status !== "approved") return ["검수 후보", "무드 태그 미승인"];
    if (list(p.mood_primary).indexOf(mood) >= 0) return ["무드 일치", "(대표)"];
    if (list(p.mood_secondary).indexOf(mood) >= 0) return ["무드 일치", "(보조)"];
    var engine = window.MoodieRecommend;
    if (engine && engine.colorEvidence(p, mood).length) return ["색감 근거", "제품 승인 · 무드 태그 미승인"];
    return ["무드", "불일치"];
  }

  // 퍼스널 컬러 근거가 없는 제품은 확인된 제품처럼 보이지 않게 안내합니다 (neutral, 쿨·웜만 확인은 따로 표시).
  function pcNote(p) {
    var tempOnly = /^(cool|warm)$/.test(p.personal_color);
    if (p.personal_color && !tempOnly) return "";
    if (tempOnly) return "공식 정보에 " + (p.personal_color === "cool" ? "쿨" : "웜") + "톤만 있어 계절별 적합성은 확인되지 않은 제품입니다.";
    if (p.tone_temperature === "neutral") return "퍼스널 컬러 중립(neutral) 제품입니다.";
    return "퍼스널 컬러 정보가 확인되지 않은 제품입니다.";
  }

  // 승인된 시뮬레이션 색 또는 공식 HEX만 표시합니다. 색이 없으면 임의 HEX를 만들지 않습니다.
  function colorLine(p, simColors) {
    var line = el("p", "result-pick__color");
    var hexes = [];
    simColors.forEach(function (c) {
      var hex = c.sim_hex.toUpperCase();
      if (hexes.indexOf(hex) < 0) hexes.push(hex);
    });
    if (hexes.length) {
      hexes.forEach(function (hex) { line.appendChild(chip(hex)); });
      line.appendChild(el("span", "", "시뮬레이션 표시용 색 " + hexes.join(" · ")));
      return line;
    }
    var hex = data().verifiedHex(p);
    if (hex) {
      line.appendChild(chip(hex));
      line.appendChild(el("span", "", "공식 색상 " + hex.toUpperCase()));
      return line;
    }
    line.classList.add("is-muted");
    line.appendChild(el("span", "", p.color_note ? "색감: " + p.color_note + " · 색상 검수 전" : "색상 검수 전 · 임의 색을 적용하지 않았어요"));
    return line;
  }

  function areaText(simColors) {
    var labels = [];
    simColors.forEach(function (c) {
      var label = AREA_LABEL[c.area] || c.area;
      if (labels.indexOf(label) < 0) labels.push(label);
    });
    return labels.length ? "적용 영역: " + labels.join(" · ") : "";
  }

  // 팔레트 구성: 개별 칸 색이 확인된 경우 칸 이름·역할·측정 참고색을 보여 줍니다. 승인 전 값은 시뮬레이션에 적용하지 않습니다.
  function paletteBlock(p, palette) {
    var pans = palette.filter(function (c) { return c.product_id === p.product_id; }).slice();
    if (!pans.length) return null;
    pans.sort(function (a, b) { return (Number(a.pan_index) || 0) - (Number(b.pan_index) || 0); });
    var approved = pans.filter(function (c) { return c.status === "approved"; });
    var hexCount = pans.filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c.pan_hex); }).length;
    var box = el("div", "result-palette");
    box.appendChild(el("p", "result-palette__title", "팔레트 구성 " + pans.length + "칸 · " + (approved.length
      ? "승인된 칸 색 " + approved.length + "개"
      : (hexCount ? "측정 참고색 (승인 전)" : "칸 이름만 확인"))));
    var listNode = el("ul", "result-palette__list");
    pans.forEach(function (pan) {
      var item = el("li", "result-palette__item");
      if (/^#[0-9a-f]{6}$/i.test(pan.pan_hex)) item.appendChild(chip(pan.pan_hex));
      item.appendChild(el("span", "result-palette__name", pan.pan_name || ("칸 " + pan.pan_index)));
      if (pan.tone_role) item.appendChild(el("span", "result-palette__role", pan.tone_role));
      listNode.appendChild(item);
    });
    box.appendChild(listNode);
    box.appendChild(el("p", "result-palette__note", approved.length
      ? "승인된 칸 색은 역할(베이스·메인·음영·딥·하이라이트)에 따라 눈두덩·쌍꺼풀 라인·눈꼬리·눈 앞머리에 나눠 적용했어요."
      : (hexCount
        ? "공식 발색 이미지에서 측정한 참고값이에요. 아직 승인 전이라 시뮬레이션에는 승인된 메인 색만 적용했어요."
        : "공식 조사 자료에서 칸 이름만 확인했어요. 색상값이 없어 시뮬레이션에 적용하지 않았어요.")));
    return box;
  }

  function data() {
    return window.MoodieProducts;
  }

  function pickCard(w, p, ctx) {
    var li = el("li", "result-pick" + (p ? "" : " is-empty"));
    li.setAttribute("data-category", w.category);
    li.setAttribute("data-product-id", p ? p.product_id : "");
    var media = el("div", "result-pick__media");
    var photo = p ? data().verifiedImage(p, "product_image") : null;
    if (photo) {
      var img = el("img");
      img.src = photo.src;
      img.alt = data().productLabel(p) + (photo.isAi ? " AI 생성 이미지 (실제 제품 사진 아님)" : "");
      img.loading = "lazy";
      media.appendChild(img);
    }
    li.appendChild(media);
    var body = el("div", "result-pick__body");
    body.appendChild(el("span", "result-pick__cat", w.label));
    if (!w.id) {
      body.appendChild(el("p", "result-pick__name", "선택 안 함"));
    } else if (!p) {
      body.appendChild(el("p", "result-pick__name", "제품 정보를 찾을 수 없어요"));
      body.appendChild(el("p", "result-pick__id", "product_id " + w.id));
    } else {
      body.appendChild(el("p", "result-pick__name", p.brand + " " + p.product_name));
      body.appendChild(el("p", "result-pick__shade", data().shadeLabel(p) || "셰이드 정보 없음"));
      body.appendChild(el("p", "result-pick__id", "product_id " + p.product_id));
      var simColors = ctx.simColors.filter(function (c) { return c.product_id === p.product_id; });
      body.appendChild(colorLine(p, simColors));
      var areas = areaText(simColors);
      if (areas) body.appendChild(el("p", "result-pick__sim", areas));
      var note = pcNote(p);
      if (note) body.appendChild(el("p", "result-pc-note", note));
      var palettes = paletteBlock(p, ctx.palette);
      if (palettes) body.appendChild(palettes);
      // 고객용 문구: 색감 설명과 미리보기 반영 여부 (색값·근거는 표시하지 않음)
      if (p.color_note) body.appendChild(el("p", "result-pick__mood-note", p.color_note));
      body.appendChild(el("p", "result-pick__preview" + (hasPreview(p, ctx) ? "" : " is-off"),
        hasPreview(p, ctx) ? "메이크업 미리보기에 반영했어요" : "이 제품은 미리보기에 색이 표시되지 않아요"));
    }
    li.appendChild(body);
    if (p) {
      var b = badgeText(w.category, p);
      var badge = el("span", "result-pick__badge");
      badge.appendChild(el("span", "", b[0]));
      badge.appendChild(el("span", "", b[1]));
      li.appendChild(badge);
    }
    return li;
  }

  // 추천에서 고른 제품: 저장된 product_id를 CSV에서 찾아 카드로 보여 주고, 같은 셰이드로 시뮬레이션합니다.
  function renderPicks() {
    var picks = document.getElementById("result-picks");
    var status = document.getElementById("result-picks-status");
    var products = window.MoodieProducts;
    var selection = window.MoodieSelection;
    if (!picks || !status || !products || !selection) return;

    var sel = selection.load(mood);
    var simBox = document.getElementById("result-sim");
    status.hidden = false;
    status.textContent = "고른 제품 정보를 불러오는 중이에요…";
    picks.textContent = "";

    Promise.all([products.load(), products.loadSimulationColors(), products.loadPalette()])
      .then(function (results) {
        var rows = results[0];
        var simColors = results[1];
        var palette = results[2];
        var byId = {};
        var byGroup = {};
        rows.forEach(function (r) {
          byId[r.product_id] = r;
          if (r.product_group_id && !byGroup[r.product_group_id]) byGroup[r.product_group_id] = r;
        });

        // 베이스는 셰이드(product_id)와 제품(product_group_id)을 함께 저장합니다.
        // 예전 저장값에 셰이드가 비어 있어도 제품이 있으면 같은 제품의 첫 셰이드를 씁니다.
        var baseId = sel.baseShade;
        if (!baseId && sel.baseGroup && byGroup[sel.baseGroup]) baseId = byGroup[sel.baseGroup].product_id;
        if (baseId && !byId[baseId] && sel.baseGroup && byGroup[sel.baseGroup]) baseId = byGroup[sel.baseGroup].product_id;

        var wanted = [
          { label: "립", id: sel.lip, category: "lip" },
          { label: "치크", id: sel.cheek, category: "cheek" },
          { label: "아이섀도우", id: sel.eye, category: "eye" },
          { label: "베이스", id: baseId, category: "base" }
        ];
        if (!wanted.some(function (w) { return w.id; })) {
          var realEmpty = window.MoodieDataMode && !window.MoodieDataMode.isDemo && !rows.some(function (r) { return r.review_status === "approved" && r.is_available === "true"; });
          status.textContent = realEmpty
            ? "검수 완료된 상품이 아직 없습니다. 실제 데이터에서는 추천 제품을 고를 수 없어요."
            : "아직 고른 제품이 없어요. 추천 페이지에서 카테고리마다 1개씩 고를 수 있어요.";
          if (simBox) simBox.hidden = true;
          return;
        }

        var ctx = { simColors: simColors, palette: palette };
        wanted.forEach(function (w) {
          picks.appendChild(pickCard(w, w.id ? byId[w.id] || null : null, ctx));
        });
        status.hidden = true;

        // 고른 셰이드로 메이크업 시뮬레이션. 고른 제품이 바뀌면 다시 계산됩니다.
        if (simBox && window.MoodieSimulation) {
          var job = window.MoodieSimulation.render(simBox, wanted.map(function (w) {
            return { category: w.category, productId: w.id, row: w.id ? byId[w.id] || null : null };
          }));
          if (job && job.catch) {
            job.catch(function () { status.hidden = false; status.textContent = "시뮬레이션 일부를 표시하지 못했어요. 제품 정보는 위 카드와 같아요."; });
          }
        }
      })
      .catch(function () {
        status.hidden = false;
        status.textContent = "고른 제품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
      });
  }

  // 추천 페이지에서 돌아오거나 다른 탭에서 선택이 바뀌면 다시 그립니다 (뒤로 가기 캐시 포함).
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) renderPicks();
  });
  window.addEventListener("storage", function (event) {
    if (!event.key || event.key === "moodie.selection") renderPicks();
  });
})();
