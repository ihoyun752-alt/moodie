// 추천 계산 (window.MoodieRecommend) v7: 제품(셰이드)의 대표·보조 무드 태그와 퍼스널 컬러, 피부 정보로 추천합니다.
// 규칙 출처: docs/recommendation-engine-plan.md 8~9절 (2026-11-02 v7 보완).
// - 립·치크·아이: 고른 무드가 승인된 대표·보조 무드 태그에 있는 셰이드만 점수 후보. 무드 40 + 퍼스널 컬러 30 (피부 미적용)
// - 대표 무드 적합도 1.0, 보조 0.5 (모든 제품 공통). 대표 무드 제품이 항상 보조 무드 제품보다 위
// - MODERN 립: 대표·보조 단계 안에서 색 온도 쿨 → 뉴트럴·혼합 → 웜 → 미확인 순
// - 베이스: 무드 미적용. 퍼스널 컬러 30 + 피부 30. 피부 정보가 없으면 점수 없이 미확인 목록
// - 뉴트럴 제품: 퍼스널 컬러 점수 없이 별도 보완 그룹(N1). 퍼스널 컬러 적합도 0.7 이상 제품이 3개 미만일 때만 표시
// - v7 색감 근거 보완 후보: 무드 태그는 다른 무드로 승인됐지만 공식 color_note에 고른 무드의 색 단어가 확인된 제품.
//   무드 태그를 새로 승인하지 않고, 점수·순위 없이 별도 그룹으로만 노출합니다.
// - v7 검수 후보: 승인·판매 중이지만 무드 태그가 없어 추천할 수 없는 제품. 목록에만 표시합니다(자동 추천 금지).
// - 퍼스널 컬러는 후보를 제외하지 않습니다. 비교 근거가 없으면 점수만 빼고 후보로 남깁니다.
// - 인기도는 후보 선정·점수·정렬에 쓰지 않습니다.
(function () {
  "use strict";

  var WEIGHT = { mood: 40, personalColor: 30, skin: 30 };
  var MOOD_FIT = { primary: 1, secondary: 0.5 };
  var CATEGORY_ITEMS = {
    lip: ["mood", "personalColor"],
    cheek: ["mood", "personalColor"],
    eye: ["mood", "personalColor"],
    base: ["personalColor", "skin"]
  };
  var CATEGORIES = ["lip", "cheek", "eye", "base"];
  var NEUTRAL_SUPPLEMENT_MIN = 3; // 퍼스널 컬러 적합도 0.7 이상 제품이 이 수보다 적으면 뉴트럴 보완 그룹 표시
  var PC_GOOD = 0.7;
  var PC_SCORE = { exact: 1, sameSeason: 0.7, productSeasonOnly: 0.7, universal: 0.7, otherSeason: 0, neutral: 1 };
  var SKIN_SPLIT = { type: 0.5, concern: 0.5 };
  var SKIN_TYPE_SCORE = { tag: 1, caution: 0, neither: 0.5 };
  // MODERN 립 색 온도 순서
  var MODERN_TEMPERATURE_RANK = { cool: 0, neutral: 1, mixed: 1, warm: 2, unknown: 3 };
  // v8: 공식 색상 설명(color_note)에서 확인하는 무드별 색 단어. 이 목록은 '무드 태그'가 아니라 '색감 참고'입니다.
  // strong(강한 근거): 그 무드에 고유한 색 단어. 1개만 확인돼도 색감 근거로 봅니다.
  // weak(약한 근거): 여러 무드에 걸쳐 쓰이는 색 단어. 서로 다른 약한 근거가 2개 이상 있을 때만 근거로 봅니다.
  // 단어는 줄 머리(공백·문장부호 뒤)에서만 맞춥니다. 예: "로지 모브"의 '로지'는 맞지만 다른 단어 중간의 조각은 맞추지 않습니다.
  var COLOR_EVIDENCE = {
    pure: { strong: ["청순", "맑은", "맑고", "라이트 핑크", "페일 핑크", "여린 핑크"], weak: [] },
    nude: { strong: ["누드", "누디", "베이지", "애프리콧", "샌드", "차분한"], weak: [] },
    modern: { strong: ["라벤더", "페일", "뮤트", "그레이", "청초", "정돈"], weak: [] },
    lovely: { strong: ["러블리", "사랑스", "화사"], weak: ["핑크", "로지"] },
    chic: { strong: ["시크", "차갑", "모브"], weak: ["딥", "쿨"] },
    glam: { strong: ["글램", "선명", "실버", "빛나"], weak: ["골드", "레드"] },
    hip: { strong: ["개성", "그래픽", "바이올렛", "힙"], weak: [] }
  };
  var WEAK_MIN_DISTINCT = 2;

  var SEASONS = ["spring", "summer", "autumn", "winter"];
  var SUBTYPES = [
    "spring-light", "spring-bright", "summer-light", "summer-mute",
    "autumn-mute", "autumn-deep", "winter-bright", "winter-deep",
    "summer-soft", "autumn-soft" // 제품 전용(원문 "소프트"). 사용자 값과 일치로 보지 않음
  ];
  var TEMPERATURE_CODES = ["cool", "warm"];
  var SEASON_TEMPERATURE = { spring: "warm", autumn: "warm", summer: "cool", winter: "cool" };
  var TONE_TEMPERATURES = ["warm", "cool", "neutral"];
  var USER_NEUTRAL = "neutral";
  var SKIN_TYPES = ["dry", "normal", "oily", "combination", "sensitive"];
  var CONCERNS = ["dryness", "oil", "pores", "trouble", "redness", "dullness", "wrinkles"];
  var MOODS = ["pure", "nude", "modern", "lovely", "chic", "glam", "hip"];

  var REASON = {
    notApproved: "not-approved",
    availability: "availability-unknown",
    unavailable: "unavailable",
    moodNotMatched: "mood-not-matched",     // 승인 태그는 있으나 고른 무드가 대표·보조에 없음 (다른 무드 제품)
    moodTagMissing: "mood-tag-missing",     // 승인된 무드 태그가 없음
    dataInvalid: "data-invalid",
    skinUnknown: "skin-unknown"             // 베이스: 피부 타입 정보 미확인 → 점수 없이 미확인 목록
  };

  var PC_GROUP = {
    scored: "pc-scored",              // 퍼스널 컬러 점수 반영
    neutral: "pc-neutral",            // 뉴트럴 보완 그룹 (N1, 점수 없음)
    insufficient: "pc-insufficient",  // 쿨·웜만 / 미확인 / (뉴트럴 사용자에게) 계절 제품 → 점수 없음
    userUnknown: "pc-user-unknown"    // 사용자가 퍼스널 컬러를 모름 (R3)
  };
  var PC_GROUP_ORDER = [PC_GROUP.scored, PC_GROUP.neutral, PC_GROUP.insufficient, PC_GROUP.userUnknown];
  var SKIN_GROUP = { full: "skin-a", typeOnly: "skin-b" };

  function list(value) {
    return value ? value.split("|").map(function (v) { return v.trim(); }).filter(Boolean) : [];
  }

  function seasonOf(code) {
    if (SEASONS.indexOf(code) >= 0) return code;
    return SUBTYPES.indexOf(code) >= 0 ? code.split("-")[0] : "";
  }

  function fail(reason, field, note) {
    return { ok: false, reason: reason, field: field, note: note || "" };
  }

  // ---------- 무드 태그 ----------
  function moodTags(row) {
    var approved = row.mood_tag_status === "approved";
    return {
      approved: approved,
      primary: approved ? list(row.mood_primary) : [],
      secondary: approved ? list(row.mood_secondary) : []
    };
  }

  function moodPart(row, mood) {
    var tags = moodTags(row);
    if (!tags.approved) return fail(REASON.moodTagMissing, "mood", "승인된 무드 태그 없음");
    var bad = tags.primary.concat(tags.secondary).filter(function (m) { return MOODS.indexOf(m) < 0; });
    if (bad.length) return fail(REASON.dataInvalid, "mood", "허용되지 않은 무드: " + bad.join(", "));
    if (!tags.primary.length) return fail(REASON.dataInvalid, "mood", "대표 무드 없음");
    if (tags.primary.indexOf(mood) >= 0) return { ok: true, kind: "primary", tier: 0, value: MOOD_FIT.primary, tags: tags };
    if (tags.secondary.indexOf(mood) >= 0) return { ok: true, kind: "secondary", tier: 1, value: MOOD_FIT.secondary, tags: tags };
    return fail(REASON.moodNotMatched, "mood", "다른 무드 제품");
  }

  // 단어가 줄 머리(시작 또는 공백·문장부호 뒤)에서 나오는지 확인합니다. 'indexOf'만 쓰면 다른 단어 속 조각도 맞아 오분류가 생깁니다.
  function hasWord(note, word) {
    var at = note.indexOf(word);
    while (at >= 0) {
      var before = at === 0 ? "" : note.charAt(at - 1);
      if (!/[가-힣A-Za-z0-9]/.test(before)) return true;
      at = note.indexOf(word, at + 1);
    }
    return false;
  }

  // v8: 고른 무드의 색감 근거. 강한 근거 1개 이상, 또는 서로 다른 약한 근거 2개 이상일 때만 근거가 있습니다. 없으면 빈 배열입니다.
  // 색감 근거는 공식 무드 태그를 대신하지 않으며, 점수에도 들어가지 않습니다.
  function colorEvidence(row, mood) {
    var note = row.color_note || "";
    var words = COLOR_EVIDENCE[mood];
    if (!note || !words) return [];
    var strong = words.strong.filter(function (w) { return hasWord(note, w); });
    var weak = words.weak.filter(function (w) { return hasWord(note, w); });
    if (strong.length || weak.length >= WEAK_MIN_DISTINCT) return strong.concat(weak);
    return [];
  }

  // ---------- 퍼스널 컬러 ----------
  function validatePersonalColor(row) {
    var codes = list(row.personal_color);
    var temp = row.tone_temperature || "";
    var bad = codes.filter(function (c) {
      return c !== "universal" && TEMPERATURE_CODES.indexOf(c) < 0 && !seasonOf(c);
    });
    if (bad.length) return "허용값이 아님: " + bad.join(", ");
    if (temp && TONE_TEMPERATURES.indexOf(temp) < 0) return "tone_temperature 허용값이 아님: " + temp;
    if (codes.indexOf("universal") >= 0 && codes.length > 1) return "universal은 다른 값과 함께 쓸 수 없음";
    if (temp === "neutral" && codes.length) return "neutral과 퍼스널 컬러 태그를 함께 쓸 수 없음";
    if (temp === "warm" || temp === "cool") {
      var clash = codes.filter(function (c) {
        if (c === "universal") return true;
        if (TEMPERATURE_CODES.indexOf(c) >= 0) return c !== temp;
        return SEASON_TEMPERATURE[seasonOf(c)] !== temp;
      });
      if (clash.length) return "tone_temperature(" + temp + ")와 맞지 않는 값: " + clash.join(", ");
    }
    return "";
  }

  // 제품 상태: subtype / season / temperature / neutral / universal / unknown
  function productPcState(row) {
    var codes = list(row.personal_color);
    if (!codes.length) return row.tone_temperature === "neutral" ? "neutral" : "unknown";
    if (codes[0] === "universal") return "universal";
    if (codes.every(function (c) { return TEMPERATURE_CODES.indexOf(c) >= 0; })) return "temperature";
    return codes.some(function (c) { return SUBTYPES.indexOf(c) >= 0; }) ? "subtype" : "season";
  }

  // 제품 색 온도 (MODERN 립 정렬용): cool / warm / neutral / mixed / unknown. 근거 없는 추론은 하지 않음.
  function productTemperature(row) {
    if (TONE_TEMPERATURES.indexOf(row.tone_temperature) >= 0) return row.tone_temperature;
    var temps = {};
    list(row.personal_color).forEach(function (c) {
      if (TEMPERATURE_CODES.indexOf(c) >= 0) temps[c] = true;
      else if (seasonOf(c)) temps[SEASON_TEMPERATURE[seasonOf(c)]] = true;
    });
    var keys = Object.keys(temps);
    if (!keys.length) return "unknown";
    return keys.length === 1 ? keys[0] : "mixed";
  }

  function personalColorPart(row, userPc) {
    var invalid = validatePersonalColor(row);
    if (invalid) return fail(REASON.dataInvalid, "personal_color", invalid);
    var state = productPcState(row);
    if (!userPc || userPc === "unknown") return { ok: true, applied: false, group: PC_GROUP.userUnknown, state: state };

    // 뉴트럴 사용자: 뉴트럴 제품은 일치 1.0, universal 0.7, 그 밖(계절·쿨·웜·미확인)은 비교하지 않음
    if (userPc === USER_NEUTRAL) {
      if (state === "neutral") return { ok: true, applied: true, value: PC_SCORE.neutral, match: "neutral", group: PC_GROUP.scored, state: state };
      if (state === "universal") return { ok: true, applied: true, value: PC_SCORE.universal, match: "universal", group: PC_GROUP.scored, state: state };
      return { ok: true, applied: false, group: PC_GROUP.insufficient, state: state, note: state === "unknown" ? "" : "neutral-user" };
    }

    if (state === "neutral") return { ok: true, applied: false, group: PC_GROUP.neutral, state: state };
    if (state === "unknown" || state === "temperature") return { ok: true, applied: false, group: PC_GROUP.insufficient, state: state };

    // 쿨·웜 값은 점수 규칙이 미확정이라 빼고, 계절·세부 유형·universal만 계산합니다.
    var codes = list(row.personal_color).filter(function (c) { return TEMPERATURE_CODES.indexOf(c) < 0; });
    var userSeason = seasonOf(userPc);
    var userIsSeasonOnly = userSeason === userPc;
    var best = -1;
    var bestMatch = "";
    codes.forEach(function (code) {
      var score;
      var match;
      if (code === "universal") {
        score = PC_SCORE.universal;
        match = "universal";
      } else if (seasonOf(code) !== userSeason) {
        score = PC_SCORE.otherSeason;
        match = "other-season";
      } else if (userIsSeasonOnly) {
        score = PC_SCORE.exact;
        match = "season";
      } else if (code === userPc) {
        score = PC_SCORE.exact;
        match = "exact";
      } else if (code === userSeason) {
        score = PC_SCORE.productSeasonOnly;
        match = "product-season-only";
      } else {
        score = PC_SCORE.sameSeason;
        match = "same-season";
      }
      if (score > best) {
        best = score;
        bestMatch = match;
      }
    });
    return { ok: true, applied: true, value: best, match: bestMatch, group: PC_GROUP.scored, state: state };
  }

  // ---------- 피부 (베이스만) ----------
  function skinTypePart(row, userSkin) {
    var tagsRaw = row.skin_type_tags;
    if (tagsRaw === "na") return { status: "unknown" };
    var tags = list(tagsRaw);
    var caution = list(row.skin_type_caution);
    var bad = tags.concat(caution).filter(function (t) { return SKIN_TYPES.indexOf(t) < 0; });
    if (bad.length) return { status: "invalid", note: "허용값이 아님: " + bad.join(", ") };
    var both = tags.filter(function (t) { return caution.indexOf(t) >= 0; });
    if (both.length) return { status: "invalid", note: "추천·주의 피부 타입 충돌: " + both.join(", ") };
    if (caution.indexOf(userSkin) >= 0) return { status: "scored", value: SKIN_TYPE_SCORE.caution, basis: "caution" };
    if (!tags.length) return { status: "unknown" };
    if (tags.indexOf(userSkin) >= 0) return { status: "scored", value: SKIN_TYPE_SCORE.tag, basis: "tag" };
    return { status: "scored", value: SKIN_TYPE_SCORE.neither, basis: "neither" };
  }

  function skinPart(row, user) {
    var type = skinTypePart(row, user.skin);
    if (type.status === "invalid") return fail(REASON.dataInvalid, "skin", type.note);
    if (type.status === "unknown") return fail(REASON.skinUnknown, "skin", "피부 타입 정보가 확인되지 않음");
    var productConcerns = row.skin_concern_tags === "na" ? [] : list(row.skin_concern_tags);
    var badConcern = productConcerns.filter(function (t) { return CONCERNS.indexOf(t) < 0; });
    if (badConcern.length) return fail(REASON.dataInvalid, "skin", "허용값이 아님: " + badConcern.join(", "));
    var group = productConcerns.length ? SKIN_GROUP.full : SKIN_GROUP.typeOnly;
    var userConcerns = user.concerns || [];
    var concern = null;
    var value = type.value;
    if (group === SKIN_GROUP.full && userConcerns.length) {
      var matched = userConcerns.filter(function (c) { return productConcerns.indexOf(c) >= 0; }).length;
      concern = { matched: matched, total: userConcerns.length, value: matched / userConcerns.length };
      value = type.value * SKIN_SPLIT.type + concern.value * SKIN_SPLIT.concern;
    }
    return { ok: true, applied: true, value: value, type: type, concern: concern, group: group };
  }

  // ---------- 판정 + 점수 ----------
  // user = { mood, skin, concerns: [], personalColor }
  function evaluate(row, user, category) {
    category = category || row.category;
    var items = CATEGORY_ITEMS[category] || CATEGORY_ITEMS.lip;
    if (row.review_status !== "approved") return fail(REASON.notApproved, "review_status", "검수 미완료");
    if (row.is_available === "false") return fail(REASON.unavailable, "is_available", "판매 중지");
    if (row.is_available !== "true") return fail(REASON.availability, "is_available", "판매 여부 미확인");

    var skin = null;
    if (items.indexOf("skin") >= 0) {
      skin = skinPart(row, user);
      if (!skin.ok) return skin;
    }
    var mood = null;
    if (items.indexOf("mood") >= 0) {
      mood = moodPart(row, user.mood);
      if (!mood.ok) return mood;
    }
    var pc = personalColorPart(row, user.personalColor);
    if (!pc.ok) return pc;

    var raw = 0;
    var basis = 0;
    if (mood) {
      raw += mood.value * WEIGHT.mood;
      basis += WEIGHT.mood;
    }
    if (pc.applied) {
      raw += pc.value * WEIGHT.personalColor;
      basis += WEIGHT.personalColor;
    }
    if (skin) {
      raw += skin.value * WEIGHT.skin;
      basis += WEIGHT.skin;
    }
    var temperature = productTemperature(row);
    var modernLip = category === "lip" && user.mood === "modern";
    return {
      ok: true,
      points: basis ? Math.round(raw / basis * 1000) / 10 : 0,
      raw: Math.round(raw * 100) / 100,
      basis: basis,
      tier: mood ? mood.tier : 0,
      temperature: temperature,
      temperatureRank: modernLip ? MODERN_TEMPERATURE_RANK[temperature] : 0,
      modernLip: modernLip,
      pcGroup: pc.group,
      pcStatus: !pc.applied
        ? (pc.group === PC_GROUP.userUnknown ? "user-unknown" : "insufficient")
        : (pc.value > 0 ? "match" : "mismatch"),
      skinGroup: skin ? skin.group : "",
      groupKey: pc.group + (skin ? "|" + skin.group : ""),
      parts: { mood: mood || { notApplicable: true }, personalColor: pc, skin: skin || { notApplicable: true } }
    };
  }

  // 정렬: 대표 → 보조, (MODERN 립) 색 온도, 퍼스널 컬러 적합도, 점수, 입력 순서
  function compareCore(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.temperatureRank !== b.temperatureRank) return a.temperatureRank - b.temperatureRank;
    var pa = a.parts.personalColor.applied ? a.parts.personalColor.value : -1;
    var pb = b.parts.personalColor.applied ? b.parts.personalColor.value : -1;
    if (pa !== pb) return pb - pa;
    return b.points - a.points;
  }

  function compare(a, b) {
    return compareCore(a, b) || a.index - b.index;
  }

  // 순위: 나보다 앞서는(정렬 기준이 더 좋은) 항목 수 + 1. 기준이 모두 같으면 공동 순위.
  function rankItems(items) {
    items.forEach(function (item) {
      item.rank = items.filter(function (o) { return compareCore(o, item) < 0; }).length + 1;
      item.tied = items.some(function (o) { return o !== item && compareCore(o, item) === 0; });
    });
  }

  function groupOrder(key) {
    var parts = key.split("|");
    return PC_GROUP_ORDER.indexOf(parts[0]) * 2 + (parts[1] === SKIN_GROUP.typeOnly ? 1 : 0);
  }

  function recommend(rows, user, category) {
    var eligible = [];
    var excluded = [];
    var otherMood = [];
    var unknownList = [];
    var colorSupplements = [];
    var reviewCandidates = [];
    var diagnostics = { category: category, total: 0, approvedAvailable: 0, moodTagged: 0, moodMatched: 0, supplement: 0, reviewCandidate: 0 };
    var total = 0;
    rows.forEach(function (row, index) {
      if (row.category !== category) return;
      if (row.review_status === "rejected") return;
      total++;
      var approvedAvailable = row.review_status === "approved" && row.is_available === "true";
      if (approvedAvailable) diagnostics.approvedAvailable++;
      if (approvedAvailable && row.mood_tag_status === "approved") diagnostics.moodTagged++;
      var result = evaluate(row, user, category);
      if (result.ok) {
        result.row = row;
        result.index = index;
        eligible.push(result);
        if (row.mood_tag_status === "approved") diagnostics.moodMatched++;
      } else if (result.reason === REASON.skinUnknown) {
        unknownList.push({ row: row, reason: result.reason, note: result.note });
      } else if (result.reason === REASON.moodNotMatched) {
        // v7: 무드 태그는 다른 무드지만 공식 색상 설명이 고른 무드의 색과 맞는 경우 별도 보완 후보로 모읍니다.
        var evidence = approvedAvailable ? colorEvidence(row, user.mood) : [];
        var supplementPc = evidence.length ? personalColorPart(row, user.personalColor) : null;
        if (evidence.length && supplementPc && supplementPc.ok) {
          colorSupplements.push({
            row: row,
            index: index,
            keywords: evidence,
            note: row.color_note,
            pc: supplementPc,
            temperature: productTemperature(row),
            groupKey: supplementPc.group
          });
          diagnostics.supplement++;
        } else {
          otherMood.push({ row: row, reason: result.reason, note: result.note });
        }
      } else if (result.reason === REASON.moodTagMissing) {
        // v7: 승인·판매 중인데 무드 태그가 없는 제품은 자동 추천하지 않고 검수 후보로만 알립니다.
        if (approvedAvailable) {
          reviewCandidates.push({ row: row, index: index, hasColorNote: Boolean(row.color_note) });
          diagnostics.reviewCandidate++;
        }
        excluded.push({ row: row, reason: result.reason, field: result.field, note: result.note });
      } else {
        excluded.push({ row: row, reason: result.reason, field: result.field, note: result.note });
      }
    });

    // v8: 무드 태그가 승인돼 점수 추천에 든 제품(셰이드)은 색감 근거 보완 후보로 다시 올리지 않습니다 (중복 방지).
    // 같은 라인의 다른 셰이드는 자기 태그와 색 설명으로 따로 판정합니다.
    var scoredShades = {};
    eligible.forEach(function (item) { scoredShades[item.row.product_id] = true; });
    colorSupplements = colorSupplements.filter(function (s) { return !scoredShades[s.row.product_id]; });

    // 같은 그룹 안에서 같은 제품의 셰이드는 가장 앞서는 셰이드를 대표로 한 번만
    var byKey = {};
    var order = [];
    eligible.forEach(function (item) {
      var key = item.groupKey + "#" + (item.row.product_group_id || item.row.product_id);
      if (!byKey[key]) {
        byKey[key] = [];
        order.push(key);
      }
      byKey[key].push(item);
    });
    var groupsByKey = {};
    order.forEach(function (key) {
      var shades = byKey[key].slice().sort(compare);
      var best = shades[0];
      best.otherShades = shades.length - 1;
      best.shades = byKey[key]; // 입력 순서
      var g = groupsByKey[best.groupKey];
      if (!g) g = groupsByKey[best.groupKey] = { key: best.groupKey, pcGroup: best.pcGroup, skinGroup: best.skinGroup, items: [] };
      g.items.push(best);
    });
    var groups = Object.keys(groupsByKey).map(function (k) { return groupsByKey[k]; });
    groups.sort(function (a, b) { return groupOrder(a.key) - groupOrder(b.key); });
    groups.forEach(function (g) {
      g.items.sort(compare);
      rankItems(g.items);
      g.basis = g.items[0].basis;
    });

    // 뉴트럴 보완 그룹: 퍼스널 컬러 적합도 0.7 이상 제품이 3개 미만일 때만 보여 줌
    var goodPc = 0;
    groups.forEach(function (g) {
      if (g.pcGroup !== PC_GROUP.scored) return;
      g.items.forEach(function (i) { if (i.parts.personalColor.value >= PC_GOOD) goodPc++; });
    });
    var hiddenNeutral = [];
    if (goodPc >= NEUTRAL_SUPPLEMENT_MIN) {
      groups = groups.filter(function (g) {
        if (g.pcGroup !== PC_GROUP.neutral) return true;
        hiddenNeutral = hiddenNeutral.concat(g.items);
        return false;
      });
    }

    var seen = {};
    unknownList = unknownList.filter(function (u) {
      var id = u.row.product_group_id || u.row.product_id;
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });

    var counts = {};
    excluded.forEach(function (e) { counts[e.reason] = (counts[e.reason] || 0) + 1; });
    var items = [];
    groups.forEach(function (g) { items = items.concat(g.items); });

    // 색감 보완 후보: 색 단어가 더 많이 확인된 제품 → 입력 순서. 점수·순위는 매기지 않습니다.
    colorSupplements.sort(function (a, b) {
      return b.keywords.length - a.keywords.length || a.index - b.index;
    });
    // 검수 후보: 같은 제품(product_group_id)은 한 번만.
    var seenReview = {};
    reviewCandidates = reviewCandidates.filter(function (r) {
      var id = r.row.product_group_id || r.row.product_id;
      if (seenReview[id]) return false;
      seenReview[id] = true;
      return true;
    });
    diagnostics.total = total;
    diagnostics.colorNoteCount = colorSupplements.length;
    diagnostics.pcApplied = items.filter(function (i) { return i.parts.personalColor.applied; }).length;
    diagnostics.pcNotApplied = items.length - diagnostics.pcApplied;

    return {
      groups: groups, items: items, excluded: excluded, otherMood: otherMood, unknownList: unknownList,
      colorSupplements: colorSupplements, reviewCandidates: reviewCandidates, diagnostics: diagnostics,
      counts: counts, total: total, goodPcCount: goodPc, hiddenNeutral: hiddenNeutral
    };
  }

  window.MoodieRecommend = {
    WEIGHT: WEIGHT,
    MOOD_FIT: MOOD_FIT,
    CATEGORY_ITEMS: CATEGORY_ITEMS,
    CATEGORIES: CATEGORIES,
    NEUTRAL_SUPPLEMENT_MIN: NEUTRAL_SUPPLEMENT_MIN,
    PC_SCORE: PC_SCORE,
    SKIN_SPLIT: SKIN_SPLIT,
    REASON: REASON,
    PC_GROUP: PC_GROUP,
    SKIN_GROUP: SKIN_GROUP,
    MOODS: MOODS,
    COLOR_EVIDENCE: COLOR_EVIDENCE,
    productPcState: productPcState,
    productTemperature: productTemperature,
    colorEvidence: colorEvidence,
    evaluate: evaluate,
    recommend: recommend
  };
})();
