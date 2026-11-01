// 추천 페이지 (v6): 주소의 무드(?mood=)와 저장된 뷰티 프로필로 카테고리별 추천을 그리고, 고른 제품을 moodie.selection에 저장합니다.
// 점수 계산은 js/recommend-engine.js, 데이터 불러오기는 js/products-data.js가 맡습니다. 이 파일은 화면만 다룹니다.
(function () {
  "use strict";

  var store = window.MoodieProfile;
  var data = window.MoodieProducts;
  var engine = window.MoodieRecommend;
  var selection = window.MoodieSelection;
  var main = document.getElementById("rec-main");
  if (!store || !data || !engine || !selection || !main) return;

  var CATEGORIES = engine.CATEGORIES;
  var CATEGORY_LABEL = { lip: "립", cheek: "치크", eye: "아이섀도우", base: "베이스" };
  var MOOD_NAME = { pure: "PURE", nude: "NUDE", modern: "MODERN", lovely: "LOVELY", chic: "CHIC", glam: "GLAM", hip: "HIP" };
  var REASON_LABEL = {
    "not-approved": "검수 미완료",
    "availability-unknown": "판매 여부 미확인",
    "unavailable": "판매 중지",
    "mood-tag-missing": "승인된 무드 태그 없음",
    "data-invalid": "데이터 오류(형식·충돌)"
  };
  var PC_MATCH_LABEL = {
    exact: "세부 유형 일치",
    season: "같은 계절 (세부 유형은 고르지 않음)",
    "same-season": "같은 계절, 세부 유형 다름",
    "product-season-only": "같은 계절 (제품은 계절만 표기)",
    universal: "Universal 제품",
    "other-season": "다른 계절",
    neutral: "뉴트럴톤 일치"
  };
  var PC_UNKNOWN_NOTICE = "퍼스널 컬러 정보가 확인되지 않은 제품입니다.";
  var TEMPERATURE_LABEL = { cool: "쿨", warm: "웜", neutral: "뉴트럴", mixed: "혼합(웜·쿨 함께 표기)", unknown: "미확인" };
  var PC_GROUP_TEXT = {
    "pc-scored": { title: "추천", note: "" },
    "pc-neutral": { title: "뉴트럴톤 보완 추천", note: "퍼스널 컬러가 맞는 제품이 3개 미만이라, 무드가 일치하는 뉴트럴톤 제품을 보완으로 보여 드려요. 퍼스널 컬러 점수는 계산하지 않았어요." },
    "pc-insufficient": { title: "퍼스널 컬러 정보가 부족한 제품", note: "무드는 맞지만 퍼스널 컬러를 비교할 근거가 부족해 무드로만 순위를 매겼어요." },
    "pc-user-unknown": { title: "추천 (퍼스널 컬러 미반영)", note: "프로필의 퍼스널 컬러가 '아직 모르겠어요' 또는 빈 칸이라 퍼스널 컬러 점수를 빼고 계산했어요." }
  };
  var SKIN_GROUP_TEXT = { "skin-a": "피부 타입·고민 정보 확인 (A그룹)", "skin-b": "피부 타입 정보만 확인 (B그룹)" };
  var AI_NOTICE = "AI 생성 이미지 · 실제 제품 사진 아님";
  // 고객 화면: 점수·계산식·검수 정보는 css/pages.css에서 숨기고(DOM에는 남김), 아래 문구만 고객용으로 바꿉니다. ?view=dev면 기존 문구.
  var CUSTOMER = !window.MoodieDataMode || window.MoodieDataMode.isCustomer;

  var mood = new URLSearchParams(window.location.search).get("mood");
  var profile = store.load();

  if (!store.isMood(mood) || !profile) {
    if (store.isMood(mood)) {
      document.getElementById("rec-missing-text").textContent = "저장된 뷰티 프로필이 없어요. 프로필을 저장하면 이 무드의 추천으로 돌아와요.";
      document.getElementById("rec-missing-label").textContent = "프로필 설정하기";
      document.getElementById("rec-missing-link").href = "profile.html?mood=" + mood;
    } else {
      document.getElementById("rec-missing-text").textContent = "선택한 무드 정보가 없거나 올바르지 않아요. 무드부터 다시 골라 주세요.";
    }
    document.getElementById("rec-missing").hidden = false;
    return;
  }

  var user = { mood: mood, skin: profile.skin, concerns: profile.concerns, personalColor: profile.personalColor };
  var pcKnown = Boolean(profile.personalColor) && profile.personalColor !== store.PERSONAL_COLOR_UNKNOWN;
  var sel = selection.load(mood);
  var status = document.getElementById("rec-status");
  var nextBtn = document.getElementById("rec-next");
  var nextHint = document.getElementById("rec-next-hint");
  var options = {};
  var simApproved = {}; // 시뮬레이션 색이 승인된 product_id (data/simulation-colors.csv, status = approved)
  var extraByCategory = {}; // 부위별 추가 확인 후보: 색감 근거 보완 + 검수 후보 (상단 영역에 모아 보여 줌)

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function num(value) {
    return String(Math.round(value * 10) / 10);
  }

  function moodList(value) {
    return value ? value.split("|").map(function (m) { return MOOD_NAME[m] || m; }).join(", ") : "";
  }

  document.getElementById("rec-context").textContent =
    "오늘의 무드 " + store.moodLabel(mood) + " · " + store.SKIN[profile.skin] +
    (pcKnown ? " · " + store.personalColorLabel(profile.personalColor) : " · 퍼스널 컬러 모름");
  document.getElementById("rec-back").href = "mood.html?mood=" + mood;
  var recNotice = document.getElementById("rec-notice");
  if (recNotice && window.MoodieDataMode) {
    recNotice.textContent = window.MoodieDataMode.isDemo
      ? "시연용 가상 데이터입니다. 추천 흐름 확인을 위한 샘플이며, 실제 제품 검수·판매 여부·피부 및 퍼스널 컬러 적합성을 확인한 결과가 아닙니다. 승인 정보는 시연용 가상 승인입니다."
      : "실제 데이터 모드입니다. 검수·판매 상태, 무드 태그, 색상 정보는 data/products.csv에 적힌 승인 상태를 그대로 따릅니다.";
  }

  var notes = document.getElementById("rec-notes");
  function note(text) {
    notes.appendChild(el("li", "", text));
  }
  note("립·치크·아이: 고른 무드가 제품의 대표 또는 보조 무드에 있는 제품만 점수 추천해요. 대표 무드 제품이 항상 위에 와요. (무드 40 + 퍼스널 컬러 30, 대표 1.0 · 보조 0.5)");
  note("퍼스널 컬러는 후보를 제외하지 않아요. 제품의 퍼스널 컬러 근거가 부족하면 점수만 빼고 후보로 남깁니다.");
  note("색감 근거 보완 후보: 무드 태그는 다른 무드로 승인됐지만 공식 색상 설명(color_note)이 고른 무드의 색과 맞는 제품이에요. 무드 태그를 새로 승인하지 않고 점수·순위 없이 별도로 보여 드려요.");
  note("검수 후보: 승인·판매 중이지만 승인된 무드 태그가 없어 추천할 수 없는 제품이에요. 임의로 추천하지 않고 목록으로만 알려 드려요.");
  note("베이스: 무드와 관계없이 퍼스널 컬러 30 + 피부 30으로 계산해요. 인기도는 쓰지 않고, 적용한 항목의 합을 100점으로 환산해요.");
  if (mood === "modern") note("MODERN 립은 같은 대표·보조 단계 안에서 쿨 → 뉴트럴·혼합 → 웜 → 미확인 순으로 보여 드려요.");

  // ---------- 카드 ----------
  function sampleArt() {
    var sample = el("div", "product-card__sample");
    sample.setAttribute("role", "img");
    sample.setAttribute("aria-label", "샘플 이미지 (실제 제품 사진이 아니에요)");
    sample.appendChild(el("span", "product-card__sample-art"));
    sample.appendChild(el("span", "product-card__sample-tag", "샘플 이미지"));
    return sample;
  }

  function renderMedia(p) {
    var media = el("figure", "product-card__media");
    var photo = data.verifiedImage(p, "product_image");
    if (!photo) {
      media.classList.add("is-sample");
      media.appendChild(sampleArt());
      return media;
    }
    if (photo.isAi) media.classList.add("is-ai");
    var img = el("img", "product-card__photo");
    img.src = photo.src;
    img.alt = data.productLabel(p) + (photo.isAi ? " AI 생성 이미지 (실제 제품 사진 아님)" : " 제품 사진");
    img.loading = "lazy";
    img.decoding = "async";
    var caption = el("figcaption", "product-card__credit", photo.isAi ? AI_NOTICE : photo.credit);
    img.addEventListener("error", function () {
      media.classList.remove("is-ai");
      media.classList.add("is-sample");
      media.replaceChild(sampleArt(), img);
      if (caption.parentNode) caption.parentNode.removeChild(caption);
    });
    media.appendChild(img);
    media.appendChild(caption);
    return media;
  }

  function shadeLine(p) {
    var shade = el("p", "product-card__shade");
    var hex = data.verifiedHex(p);
    if (hex) {
      var chip = el("span", "product-card__chip");
      chip.style.backgroundColor = hex;
      chip.setAttribute("aria-hidden", "true");
      shade.appendChild(chip);
    }
    shade.appendChild(el("span", "product-card__shade-name", data.shadeLabel(p) || "셰이드 정보 없음"));
    return shade;
  }

  // 색상 상태: 공식 HEX가 있으면 칩, 없으면 색상 설명, 둘 다 없으면 '검수 전'. 임의 HEX는 만들지 않습니다.
  function colorLine(p) {
    var hex = data.verifiedHex(p);
    var line = el("p", "rec-color-note");
    if (hex) {
      var chip = el("span", "product-card__chip");
      chip.style.backgroundColor = hex;
      chip.setAttribute("aria-hidden", "true");
      line.appendChild(chip);
      line.appendChild(el("span", "rec-color-status", "공식 색상 " + hex.toUpperCase()));
      return line;
    }
    if (p.color_note) {
      line.appendChild(el("span", "", "색감: " + p.color_note));
      return line;
    }
    line.classList.add("is-off");
    line.appendChild(el("span", "", "색상 정보 없음 · 색상 검수 전"));
    return line;
  }

  function idLine(p) {
    return el("p", "rec-product-id", "product_id " + p.product_id);
  }

  // 후보 상품의 시뮬레이션 색 상태. 승인되지 않은 색은 결과 화면에 적용되지 않습니다.
  function simStatusLine(p) {
    if (simApproved[p.product_id]) return el("p", "rec-sim-status", "시뮬레이션 색상 승인 · 결과 화면에 적용");
    return el("p", "rec-sim-status is-off", "시뮬레이션 색상 미승인 · 결과 화면 적용 안 됨");
  }

  // 공식 상품 페이지 (http(s) 주소만 연결)
  function productLink(p) {
    if (!/^https?:\/\//.test(p.product_url || "")) return null;
    var a = el("a", "rec-product-link", "공식 상품 페이지 보기");
    a.href = p.product_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  var SKIN_TYPE_BASIS = { tag: "추천 피부 타입", caution: "주의 피부 타입", neither: "추천·주의 어디에도 없음" };

  // 퍼스널 컬러 표시: 점수를 적용했는지, 적용하지 않았다면 왜인지. (후보 제외 사유가 아닙니다)
  function pcLine(pc) {
    if (pc.applied) {
      return { off: false, text: "퍼스널 컬러: " + num(pc.value * engine.WEIGHT.personalColor) + " / 30 (" + (PC_MATCH_LABEL[pc.match] || "") + ")" };
    }
    if (pc.group === "pc-user-unknown") return { off: true, text: "퍼스널 컬러: 미반영 (프로필의 퍼스널 컬러 모름)" };
    if (pc.state === "neutral") return { off: true, text: "퍼스널 컬러: 미반영 (뉴트럴톤 제품 · 보완 추천)" };
    if (pc.state === "temperature") return { off: true, text: "퍼스널 컬러: 미반영 (공식 정보에 쿨·웜만 있어 계절과 비교하지 않음)" };
    if (pc.state === "unknown") return { off: true, text: "퍼스널 컬러: 미반영 (" + PC_UNKNOWN_NOTICE + ")" };
    return { off: true, text: "퍼스널 컬러: 미반영 (뉴트럴톤 사용자와 계절 제품은 비교하지 않음)" };
  }

  // 추천 이유: 무드 태그, 퍼스널 컬러, (MODERN 립) 색 온도, (베이스) 피부, 환산 점수
  function whyList(result) {
    var why = el("ul", "rec-why");
    var parts = result.parts;
    var p = result.row;
    if (!parts.mood.notApplicable) {
      var kind = parts.mood.kind === "primary" ? "대표 무드 일치" : "보조 무드 일치";
      why.appendChild(el("li", "", "무드: " + kind + " (" + MOOD_NAME[mood] + ") " + num(parts.mood.value * engine.WEIGHT.mood) + " / 40"));
      why.appendChild(el("li", "rec-why__tags", "무드 태그: 대표 " + moodList(p.mood_primary) + (p.mood_secondary ? " · 보조 " + moodList(p.mood_secondary) : "")));
    } else {
      why.appendChild(el("li", "is-off", "무드: 베이스는 무드를 적용하지 않아요"));
    }

    var pc = parts.personalColor;
    var line = pcLine(pc);
    why.appendChild(el("li", line.off ? "is-off" : "", line.text));

    if (result.modernLip) {
      why.appendChild(el("li", "", "색 온도: " + TEMPERATURE_LABEL[result.temperature] + " (MODERN 립 정렬 기준)"));
    }

    var skin = parts.skin;
    if (!skin.notApplicable) {
      var detail = ["피부 타입 " + num(skin.type.value * 100) + "% (" + SKIN_TYPE_BASIS[skin.type.basis] + ")"];
      if (skin.concern) detail.push("피부 고민 " + skin.concern.matched + "/" + skin.concern.total + " 일치");
      else if (skin.group === "skin-b") detail.push("제품의 피부 고민 정보 없음");
      else detail.push("피부 고민 미선택");
      why.appendChild(el("li", "", "피부: " + num(skin.value * engine.WEIGHT.skin) + " / 30 (" + detail.join(", ") + ")"));
    }
    why.appendChild(el("li", "rec-why__total", "적용 항목 합 " + num(result.raw) + " / " + result.basis + " → 100점 환산 " + num(result.points)));
    return why;
  }

  function groupTitle(group) {
    var used = [];
    if (group.skinGroup === "") used.push("무드 40");
    if (group.pcGroup === "pc-scored") used.push("퍼스널 컬러 30");
    if (group.skinGroup) used.push("피부 30");
    var title = PC_GROUP_TEXT[group.pcGroup].title;
    if (group.skinGroup) title = (group.pcGroup === "pc-scored" ? "추천" : "추천 (퍼스널 컬러 미반영)") + " · " + SKIN_GROUP_TEXT[group.skinGroup];
    return title + " · " + used.join(" + ") + " = " + group.basis + "점 → 100점 환산";
  }

  function pickControl(name, value, checked, label) {
    var wrap = el("label", "choice rec-pick");
    var input = el("input", "visually-hidden");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = checked;
    wrap.appendChild(input);
    wrap.appendChild(el("span", "", label));
    return wrap;
  }

  function productKey(row) {
    return row.product_group_id || row.product_id;
  }

  function selected(category) {
    return category === "base" ? sel.baseShade : sel[category];
  }

  function setSelected(category, productId, groupId) {
    if (category === "base") {
      sel.baseShade = productId;
      sel.baseGroup = groupId;
    } else {
      sel[category] = productId;
    }
  }

  function cardKey(result) {
    return productKey(result.row) + "--" + result.groupKey.replace(/[^a-z0-9-]/gi, "_");
  }

  function shadePicker(category, result, chosen) {
    var box = el("div", "rec-shade-picks");
    var key = cardKey(result);
    var title = el("p", "rec-shade-picks__title", CUSTOMER ? "셰이드 선택" : "셰이드 선택 (셰이드별 점수)");
    title.id = "shades-" + category + "-" + key;
    box.appendChild(title);
    var choices = el("div", "choices");
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-labelledby", title.id);
    result.shades.forEach(function (s) {
      var tag = s.parts.mood.notApplicable ? "" : (s.parts.mood.kind === "primary" ? " · 대표" : " · 보조");
      var label = CUSTOMER
        ? (data.shadeLabel(s.row) || s.row.shade_name) + (s === result ? " · 추천" : "")
        : (data.shadeLabel(s.row) || s.row.product_id) + " · " + num(s.points) + "점" + tag + (s === result ? " · 추천 셰이드" : "");
      choices.appendChild(pickControl("shade-" + category + "-" + key, s.row.product_id, s.row.product_id === chosen, label));
    });
    box.appendChild(choices);
    return box;
  }

  function scoredCard(category, result) {
    var p = result.row;
    var shades = result.shades || [result];
    var shadeIds = shades.map(function (s) { return s.row.product_id; });
    var picked = shadeIds.indexOf(selected(category)) >= 0;
    var chosen = picked ? selected(category) : p.product_id;
    var item = el("li", "product-card rec-card");
    item.appendChild(renderMedia(p));
    var body = el("div", "product-card__body");
    body.appendChild(el("p", "product-card__brand", p.brand));
    body.appendChild(el("h4", "product-card__name", p.product_name));
    body.appendChild(shadeLine(p));
    body.appendChild(idLine(p));
    if (!result.parts.mood.notApplicable) {
      body.appendChild(el("p", "rec-badge " + (result.parts.mood.kind === "primary" ? "is-primary" : "is-secondary"),
        CUSTOMER
          ? (result.parts.mood.kind === "primary" ? MOOD_NAME[mood] + " 무드 추천" : MOOD_NAME[mood] + " 무드와도 잘 어울려요")
          : (result.parts.mood.kind === "primary" ? "대표 무드 " : "보조 무드 ") + MOOD_NAME[mood]));
    }
    body.appendChild(colorLine(p));
    if (result.parts.personalColor.state === "unknown" && result.parts.personalColor.group !== "pc-user-unknown") {
      body.appendChild(el("p", "rec-pc-notice", PC_UNKNOWN_NOTICE));
    }
    if (result.otherShades) {
      body.appendChild(el("p", "rec-shade-note", "추천 셰이드: 같은 제품의 후보 셰이드 " + (result.otherShades + 1) + "개 중 정렬 기준이 가장 앞서는 셰이드"));
    }
    var score = el("p", "rec-score");
    score.appendChild(el("span", "rec-rank", (result.tied ? "공동 " : "") + result.rank + "위"));
    score.appendChild(el("strong", "", num(result.points)));
    score.appendChild(document.createTextNode(" / 100점"));
    body.appendChild(score);
    body.appendChild(whyList(result));
    if (shades.length > 1) body.appendChild(shadePicker(category, result, chosen));
    var pick = pickControl("pick-" + category, cardKey(result), picked, "이 제품 선택");
    pick.querySelector("input").setAttribute("data-default-shade", p.product_id);
    pick.querySelector("input").setAttribute("data-group-id", productKey(p));
    body.appendChild(pick);
    item.appendChild(body);
    return item;
  }

  function chosenShade(category, key, fallback) {
    var checked = main.querySelector('input[name="shade-' + category + "-" + key + '"]:checked');
    return checked ? checked.value : fallback;
  }

  // v7: 색감 근거 보완 후보 카드. 무드 태그·점수·순위는 적용하지 않고, 선택만 가능하게 합니다.
  function supplementCard(category, item) {
    var p = item.row;
    var key = cardKey(item);
    var picked = selected(category) === p.product_id;
    var node = el("li", "product-card rec-card rec-card--evidence");
    node.id = "evidence-" + category + "-" + p.product_id;
    node.appendChild(renderMedia(p));
    var body = el("div", "product-card__body");
    body.appendChild(el("p", "product-card__brand", p.brand));
    body.appendChild(el("h4", "product-card__name", p.product_name));
    body.appendChild(shadeLine(p));
    body.appendChild(idLine(p));
    body.appendChild(el("p", "rec-badge is-evidence", "색감 근거 · 무드 태그 미승인"));
    body.appendChild(simStatusLine(p));
    // 제품 검수 승인과 무드 태그 승인은 다른 항목입니다. 이 카드는 제품은 승인·판매 중이지만 고른 무드 태그는 승인되지 않은 경우입니다.
    body.appendChild(el("p", "rec-status", "제품 검수: 승인 · 판매 중 / 무드 태그: 미승인" +
      (p.mood_primary || p.mood_secondary
        ? " (승인된 태그: " + [p.mood_primary ? "대표 " + moodList(p.mood_primary) : "", p.mood_secondary ? "보조 " + moodList(p.mood_secondary) : ""].filter(Boolean).join(" · ") + ")"
        : " (승인된 태그 없음)")));
    body.appendChild(colorLine(p));
    body.appendChild(el("p", "rec-evidence", "색감 근거: 공식 색상 설명에서 '" + item.keywords.join("', '") + "' 확인"));
    var line = pcLine(item.pc);
    var pcNote = el("ul", "rec-why");
    pcNote.appendChild(el("li", line.off ? "is-off" : "", line.text));
    body.appendChild(pcNote);
    body.appendChild(el("p", "rec-group__note", "무드 태그가 " + MOOD_NAME[mood] + "로 승인되지 않아 점수·순위에는 넣지 않았어요. 고른 무드의 색감과 맞는지만 공식 색상 설명으로 확인한 후보입니다."));
    var link = productLink(p);
    if (link) body.appendChild(link);
    var pick = pickControl("pick-" + category, key, picked, "이 제품 선택");
    pick.querySelector("input").setAttribute("data-default-shade", p.product_id);
    pick.querySelector("input").setAttribute("data-group-id", productKey(p));
    body.appendChild(pick);
    node.appendChild(body);
    return node;
  }

  // v7: 승인·판매 중이지만 무드 태그가 없어 자동 추천할 수 없는 제품. 선택지는 만들지 않습니다.
  function reviewBox(label, result) {
    var box = el("div", "rec-review");
    box.appendChild(el("h3", "rec-group__title", "검수 후보 " + label + " · 무드 태그 미승인 " + result.reviewCandidates.length + "개"));
    box.appendChild(el("p", "rec-group__note", "승인·판매 중이지만 승인된 무드 태그가 없어 추천에 넣지 않았어요. 무드 태그를 임의로 만들지 않고, 색상 설명·무드 조사를 거친 뒤 반영할 수 있어요."));
    var listNode = el("ul", "rec-review__list");
    result.reviewCandidates.forEach(function (r) {
      var p = r.row;
      var parts = [p.brand + " " + p.product_name + " · " + (data.shadeLabel(p) || p.shade_name), "product_id " + p.product_id];
      parts.push("제품 검수: 승인 · 판매 중 / 무드 태그: 미승인");
      parts.push(p.color_note ? "색상 설명: " + p.color_note : "색상 설명 없음");
      listNode.appendChild(el("li", "", parts.join(" — ")));
    });
    box.appendChild(listNode);
    return box;
  }

  // ---------- 제외·안내 ----------
  function reasonText(counts) {
    return Object.keys(REASON_LABEL).filter(function (k) { return counts[k]; }).map(function (k) {
      return REASON_LABEL[k] + " " + counts[k] + "개";
    }).join(", ");
  }

  function emptyMessage(label, result, category) {
    if (!result.total) return "등록된 " + label + " 제품이 아직 없어요.";
    if (category === "base") {
      return "피부 정보가 확인된 베이스 제품이 아직 없어 순위를 매길 수 없어요. (피부 정보 미확인 " + result.unknownList.length + "개 제품)";
    }
    var parts = [];
    if (result.otherMood.length) parts.push("다른 무드 제품 " + result.otherMood.length + "개");
    var r = reasonText(result.counts);
    if (r) parts.push(r);
    return "이 무드(" + MOOD_NAME[mood] + ")에 맞는 검수된 " + label + " 제품이 아직 없어요. (등록 셰이드 " + result.total + "개 중 " + parts.join(", ") + ")";
  }

  function excludedDetails(result) {
    var all = result.excluded.slice();
    if (!all.length && !result.otherMood.length) return null;
    var details = el("details", "rec-excluded");
    details.appendChild(el("summary", "", "이 무드의 추천에 나오지 않은 셰이드 " + (all.length + result.otherMood.length) + "개 · 이유 보기"));
    var listNode = el("ul", "rec-excluded__list");
    result.otherMood.forEach(function (e) {
      listNode.appendChild(el("li", "", data.productLabel(e.row) + " — 다른 무드 제품 (대표 " + moodList(e.row.mood_primary) +
        (e.row.mood_secondary ? " · 보조 " + moodList(e.row.mood_secondary) : "") + ")"));
    });
    all.forEach(function (e) {
      listNode.appendChild(el("li", "", data.productLabel(e.row) + (e.row.shade_code ? " (" + e.row.shade_code + ")" : "") + " — " +
        (REASON_LABEL[e.reason] || e.reason) + (e.note && e.note !== REASON_LABEL[e.reason] ? " · " + e.note : "")));
    });
    details.appendChild(listNode);
    return details;
  }

  function unknownBox(label, unknownList) {
    var box = el("div", "rec-unknown");
    box.appendChild(el("h3", "rec-group__title", "피부 정보 미확인 " + label + " 제품 · 점수·순위 없음"));
    box.appendChild(el("p", "rec-group__note", "피부 적합도를 평가해야 하지만 제품의 피부 정보가 아직 확인되지 않았어요. 부적합 제품이라는 뜻이 아니에요."));
    var listNode = el("ul", "rec-unknown__list");
    unknownList.forEach(function (u) {
      listNode.appendChild(el("li", "", u.row.brand + " " + u.row.product_name));
    });
    box.appendChild(listNode);
    return box;
  }

  // ---------- 섹션 ----------
  function renderCategory(rows, category) {
    var node = main.querySelector('.rec-section[data-category="' + category + '"]');
    node.hidden = false;
    var statusNode = node.querySelector("[data-status]");
    var listNode = node.querySelector("[data-list]");
    var label = CATEGORY_LABEL[category];
    var result = engine.recommend(rows, user, category);

    options[category] = [];
    result.items.forEach(function (r) {
      (r.shades || [r]).forEach(function (s) { options[category].push(s.row.product_id); });
    });
    result.colorSupplements.forEach(function (s) { options[category].push(s.row.product_id); });
    if (options[category].indexOf(selected(category)) < 0) setSelected(category, "", "");

    listNode.textContent = "";
    listNode.hidden = true;
    var holder = node.querySelector("[data-groups]");
    if (!holder) {
      holder = el("div", "rec-groups");
      holder.setAttribute("data-groups", "");
      node.insertBefore(holder, listNode);
    }
    holder.textContent = "";
    result.groups.forEach(function (group) {
      var box = el("div", "rec-group");
      box.setAttribute("data-group", group.key);
      box.appendChild(el("h3", "rec-group__title", groupTitle(group)));
      var groupNote = PC_GROUP_TEXT[group.pcGroup].note;
      // 베이스는 무드를 쓰지 않으므로 퍼스널 컬러 미반영 그룹의 설명을 따로 둡니다.
      if (category === "base" && group.pcGroup !== "pc-scored") {
        groupNote = group.pcGroup === "pc-user-unknown"
          ? "프로필의 퍼스널 컬러가 '아직 모르겠어요' 또는 빈 칸이라 피부 점수로만 순위를 매겼어요."
          : "베이스 제품의 퍼스널 컬러 정보가 아직 없어 피부 점수로만 순위를 매겼어요.";
      }
      if (groupNote) box.appendChild(el("p", "rec-group__note", groupNote));
      if (result.groups.length > 1) box.appendChild(el("p", "rec-group__note", "다른 그룹과는 적용 항목이 달라 점수·순위를 비교하지 않아요."));
      var grid = el("ul", "product-grid rec-grid");
      group.items.forEach(function (r) { grid.appendChild(scoredCard(category, r)); });
      box.appendChild(grid);
      holder.appendChild(box);
    });
    if (result.hiddenNeutral.length) {
      holder.appendChild(el("p", "rec-group__note", "퍼스널 컬러가 맞는 제품이 " + result.goodPcCount + "개라, 뉴트럴톤 보완 제품 " +
        result.hiddenNeutral.length + "개는 보여 드리지 않았어요."));
    }
    // 색감 근거 보완 후보와 검수 후보는 상단 '이 무드의 추가 확인 후보'에 모아 보여 줍니다 (같은 제품을 두 번 그리지 않음).
    extraByCategory[category] = { supplements: result.colorSupplements, reviews: result.reviewCandidates, label: label };
    if (result.colorSupplements.length || result.reviewCandidates.length) {
      var pointer = el("p", "rec-group__note rec-extra-pointer");
      pointer.appendChild(document.createTextNode("추가 확인 후보 " + (result.colorSupplements.length + result.reviewCandidates.length) + "개는 "));
      var anchor = el("a", "", "맨 위 '이 무드의 추가 확인 후보'");
      anchor.href = "#rec-extra";
      pointer.appendChild(anchor);
      pointer.appendChild(document.createTextNode("에서 볼 수 있어요."));
      holder.appendChild(pointer);
    }
    if (result.unknownList.length) holder.appendChild(unknownBox(label, result.unknownList));
    var details = excludedDetails(result);
    if (details) holder.appendChild(details);

    var head = category === "base" ? "베이스는 무드와 관계없이 같은 후보예요. " : "";
    var orderText = category === "base" ? "퍼스널 컬러 → 피부 점수 순" : "대표 무드 → 보조 무드 → 퍼스널 컬러 → 점수 순";
    var extra = [];
    if (result.colorSupplements.length) extra.push("색감 근거 보완 " + result.colorSupplements.length + "개(순위 없음)");
    if (result.reviewCandidates.length) extra.push("검수 후보 " + result.reviewCandidates.length + "개(추천 제외)");
    var logie = result.colorSupplements.filter(function (s) { return s.row.brand === "로지킴"; });
    if (logie.length) extra.push("로지킴 " + logie.map(function (s) { return s.row.shade_name; }).join("·") + " 포함");
    statusNode.textContent = result.items.length
      ? head + "추천 제품 " + result.items.length + "개 · " + orderText + (extra.length ? " · " + extra.join(" · ") : "")
      : head + emptyMessage(label, result, category) + (extra.length ? " · " + extra.join(" · ") : "");
    if (CUSTOMER) {
      statusNode.setAttribute("data-dev-text", statusNode.textContent);
      statusNode.textContent = result.items.length
        ? (category === "base" ? "피부 타입과 고민에 맞춰 골랐어요." : MOOD_NAME[mood] + " 무드에 어울리는 " + label + " 제품이에요.")
        : "이 무드에 추천할 " + label + " 제품이 아직 없어요.";
    }
  }

  // 상단 '이 무드의 추가 확인 후보' 영역: 부위별 색감 근거 보완 카드(선택 가능, 점수 없음) + 검수 후보 목록
  function renderExtra() {
    var box = document.getElementById("rec-extra");
    var body = document.getElementById("rec-extra-body");
    if (!box || !body) return;
    body.textContent = "";
    var any = false;
    CATEGORIES.forEach(function (category) {
      var x = extraByCategory[category];
      if (!x || (!x.supplements.length && !x.reviews.length)) return;
      any = true;
      var group = el("div", "rec-group rec-extra__group");
      group.setAttribute("data-extra-category", category);
      if (x.supplements.length) {
        group.appendChild(el("h3", "rec-group__title", x.label + " · 색감 근거 보완 " + x.supplements.length + "개 · 무드 태그 미승인 (점수·순위 없음)"));
        var grid = el("ul", "product-grid rec-grid");
        x.supplements.forEach(function (s) { grid.appendChild(supplementCard(category, s)); });
        group.appendChild(grid);
      }
      if (x.reviews.length) group.appendChild(reviewBox(x.label, { reviewCandidates: x.reviews }));
      body.appendChild(group);
    });
    box.hidden = !any;
  }

  // ---------- 선택과 다음 단계 ----------
  function missingPicks() {
    return CATEGORIES.filter(function (c) {
      return options[c] && options[c].length && !selected(c);
    }).map(function (c) { return CATEGORY_LABEL[c]; });
  }

  function updateNext() {
    var anyOption = CATEGORIES.some(function (c) { return options[c] && options[c].length; });
    var missing = missingPicks();
    nextBtn.disabled = !anyOption || missing.length > 0;
    nextHint.textContent = !anyOption
      ? "지금은 고를 수 있는 추천 제품이 없어요."
      : missing.length ? "아직 고르지 않은 항목: " + missing.join(", ") : "고를 수 있는 카테고리를 모두 골랐어요.";
  }

  function persist() {
    if (!selection.save(sel)) nextHint.textContent = "이 브라우저에서는 선택을 저장할 수 없어요. 저장소 차단 설정을 확인해 주세요.";
  }

  main.addEventListener("change", function (event) {
    var t = event.target;
    if (t.type !== "radio") return;
    var m = /^pick-(lip|cheek|eye|base)$/.exec(t.name);
    if (m) setSelected(m[1], chosenShade(m[1], t.value, t.getAttribute("data-default-shade")), t.getAttribute("data-group-id"));
    var sm = /^shade-(lip|cheek|eye|base)-(.+)$/.exec(t.name);
    if (sm) {
      var pickInput = null;
      main.querySelectorAll('input[name="pick-' + sm[1] + '"]').forEach(function (input) {
        input.checked = input.value === sm[2];
        if (input.checked) pickInput = input;
      });
      setSelected(sm[1], t.value, pickInput ? pickInput.getAttribute("data-group-id") : "");
    }
    persist();
    updateNext();
  });

  nextBtn.addEventListener("click", function () {
    if (missingPicks().length) return;
    persist();
    window.location.href = "result.html?mood=" + mood;
  });

  main.hidden = false;
  Promise.all([data.load(), data.loadSimulationColors().catch(function () { return []; })])
    .then(function (loaded) {
      var rows = loaded[0];
      loaded[1].forEach(function (c) { simApproved[c.product_id] = true; });
      var approvedRows = rows.filter(function (r) { return r.review_status === "approved" && r.is_available === "true"; });
      if (!approvedRows.length) {
        // 검수 완료 상품이 없으면 (실제 데이터) 추천 대신 빈 상태 화면을 보여 줍니다.
        status.hidden = true;
        notes.hidden = true;
        document.getElementById("rec-empty").hidden = false;
        updateNext();
        return;
      }
      CATEGORIES.forEach(function (c) { renderCategory(rows, c); });
      renderExtra();
      status.textContent = "";
      status.hidden = true;
      persist();
      updateNext();
    })
    .catch(function (error) {
      if (window.console) window.console.error("추천 데이터를 불러오지 못했습니다:", error);
      status.textContent = "제품 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
      status.classList.add("is-error");
    });
})();
