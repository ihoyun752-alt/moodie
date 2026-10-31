// moodie. 공통: 무드와 뷰티 프로필 항목 목록, 프로필 저장·불러오기·삭제 (localStorage)
// 로그인 없이 이 브라우저에만 저장합니다. 화면 이름은 모두 이 파일의 목록에서 가져옵니다.
(function () {
  "use strict";

  var STORAGE_KEY = "moodie.profile";
  var VERSION = 1;

  var MOODS = {
    pure: { en: "PURE", ko: "청순" },
    nude: { en: "NUDE", ko: "누드" },
    modern: { en: "MODERN", ko: "모던" },
    lovely: { en: "LOVELY", ko: "러블리" },
    chic: { en: "CHIC", ko: "시크" },
    glam: { en: "GLAM", ko: "글램" },
    hip: { en: "HIP", ko: "힙" }
  };
  var MOOD_ORDER = ["pure", "nude", "modern", "lovely", "chic", "glam", "hip"];

  var SKIN = { dry: "건성", normal: "중성", oily: "지성", combination: "복합성", sensitive: "민감성" };
  var CONCERN = {
    dryness: "건조함", oil: "유분", pores: "모공", trouble: "트러블",
    redness: "홍조", dullness: "칙칙함", wrinkles: "잔주름"
  };
  var FINISH = { matte: "매트", "semi-matte": "세미매트", glow: "글로우" };

  // 퍼스널 컬러: 계절 4개 × 세부 유형 2개. 무디는 진단하지 않고, 사용자가 알고 있는 유형만 기록합니다.
  var SEASONS = {
    spring: { label: "봄 웜", subtypes: { "spring-light": "봄 웜 라이트", "spring-bright": "봄 웜 브라이트" } },
    summer: { label: "여름 쿨", subtypes: { "summer-light": "여름 쿨 라이트", "summer-mute": "여름 쿨 뮤트" } },
    autumn: { label: "가을 웜", subtypes: { "autumn-mute": "가을 웜 뮤트", "autumn-deep": "가을 웜 딥" } },
    winter: { label: "겨울 쿨", subtypes: { "winter-bright": "겨울 쿨 브라이트", "winter-deep": "겨울 쿨 딥" } }
  };
  var PERSONAL_COLOR_UNKNOWN = "unknown";

  var MAX_CONCERNS = 3;
  var MAX_STYLES = 3;

  function has(map, key) {
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key);
  }

  function moodLabel(id) {
    return has(MOODS, id) ? MOODS[id].en + " · " + MOODS[id].ko : "";
  }

  // "spring-light" → "spring", "spring" → "spring", 그 밖에는 ""
  function seasonOf(value) {
    if (has(SEASONS, value)) return value;
    var season = typeof value === "string" ? value.split("-")[0] : "";
    return has(SEASONS, season) && has(SEASONS[season].subtypes, value) ? season : "";
  }

  function personalColorLabel(value) {
    if (value === PERSONAL_COLOR_UNKNOWN) return "아직 모르겠어요";
    var season = seasonOf(value);
    if (!season) return "";
    return value === season ? SEASONS[season].label + " (세부 유형 모름)" : SEASONS[season].subtypes[value];
  }

  function validPersonalColor(value) {
    return value === PERSONAL_COLOR_UNKNOWN || Boolean(seasonOf(value));
  }

  function pick(list, map, max) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (value, i) {
      return has(map, value) && list.indexOf(value) === i;
    }).slice(0, max);
  }

  // 목록에 있는 값만 남깁니다. 피부 타입(필수)이 없으면 프로필이 없는 것으로 봅니다.
  function normalize(raw) {
    if (!raw || !has(SKIN, raw.skin)) return null;
    return {
      version: VERSION,
      skin: raw.skin,
      concerns: pick(raw.concerns, CONCERN, MAX_CONCERNS),
      personalColor: validPersonalColor(raw.personalColor) ? raw.personalColor : "",
      styles: pick(raw.styles, MOODS, MAX_STYLES),
      finish: has(FINISH, raw.finish) ? raw.finish : "",
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ""
    };
  }

  function load() {
    try {
      return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      return null;
    }
  }

  // 저장에 성공하면 저장한 프로필을, 실패하면(저장소를 쓸 수 없는 브라우저 등) null을 돌려줍니다.
  function save(raw) {
    var profile = normalize(raw);
    if (!profile) return null;
    profile.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      return profile;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  // 요약 화면용: 항목 이름과 표시할 글자 목록
  function describe(profile) {
    var none = "선택 안 함";
    var list = function (values, map, label) {
      return values.length ? values.map(label || function (v) { return map[v]; }).join(", ") : none;
    };
    return [
      { label: "피부 타입", value: SKIN[profile.skin] },
      { label: "피부 고민", value: list(profile.concerns, CONCERN) },
      { label: "퍼스널 컬러", value: personalColorLabel(profile.personalColor) || none },
      { label: "선호 메이크업 스타일", value: list(profile.styles, MOODS, moodLabel) },
      { label: "선호 마무리감", value: FINISH[profile.finish] || none }
    ];
  }

  // 상세 요약 표(<dl>)를 채웁니다.
  function renderSummary(dl, profile) {
    dl.textContent = "";
    describe(profile).forEach(function (item) {
      var row = document.createElement("div");
      var dt = document.createElement("dt");
      var dd = document.createElement("dd");
      row.className = "summary__row";
      dt.textContent = item.label;
      dd.textContent = item.value;
      row.appendChild(dt);
      row.appendChild(dd);
      dl.appendChild(row);
    });
  }

  window.MoodieProfile = {
    MOODS: MOODS,
    MOOD_ORDER: MOOD_ORDER,
    SKIN: SKIN,
    CONCERN: CONCERN,
    FINISH: FINISH,
    SEASONS: SEASONS,
    PERSONAL_COLOR_UNKNOWN: PERSONAL_COLOR_UNKNOWN,
    MAX_CONCERNS: MAX_CONCERNS,
    MAX_STYLES: MAX_STYLES,
    isMood: function (id) { return has(MOODS, id); },
    moodLabel: moodLabel,
    seasonOf: seasonOf,
    personalColorLabel: personalColorLabel,
    load: load,
    save: save,
    clear: clear,
    describe: describe,
    renderSummary: renderSummary
  };
})();
