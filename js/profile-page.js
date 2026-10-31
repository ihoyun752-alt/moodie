// 뷰티 프로필 페이지: 저장된 프로필 불러오기, 퍼스널 컬러 세부 유형, 고민·스타일 3개 제한, 필수 항목 확인, localStorage 저장
// 주소에 ?mood= 가 있으면(무드를 먼저 고르고 온 경우) 저장 후 그 무드의 결과 화면으로 이어 줍니다.
(function () {
  "use strict";

  var form = document.getElementById("profile-form");
  var store = window.MoodieProfile;
  if (!form || !store) return;

  var mood = new URLSearchParams(window.location.search).get("mood");
  var skinField = document.getElementById("field-skin");
  var skinError = document.getElementById("skin-error");
  var saved = document.getElementById("profile-saved");
  var savedText = document.getElementById("profile-saved-text");
  var next = document.getElementById("profile-next");
  var status = document.getElementById("profile-status");

  // 피부 고민과 선호 스타일은 3개까지: 다 고르면 나머지는 잠시 선택할 수 없게 합니다.
  var limits = {
    concern: { max: store.MAX_CONCERNS, count: document.getElementById("concern-count"), what: "고민" },
    style: { max: store.MAX_STYLES, count: document.getElementById("style-count"), what: "스타일" }
  };

  if (store.isMood(mood)) {
    status.textContent = "선택한 무드: " + store.moodLabel(mood) + " · 프로필을 저장하면 결과 요약으로 이어져요. (이 브라우저에만 저장돼요)";
    next.href = "result.html?mood=" + mood;
    next.firstChild.textContent = "선택한 무드로 결과 보기 ";
  }

  function inputs(name) {
    return Array.prototype.slice.call(form.querySelectorAll('input[name="' + name + '"]'));
  }

  function value(name) {
    var input = form.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : "";
  }

  function values(name) {
    return inputs(name).filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
  }

  function check(name, v) {
    inputs(name).forEach(function (input) {
      if (input.value === v) input.checked = true;
    });
  }

  // 퍼스널 컬러: 고른 계절의 세부 유형만 보여 주고, 계절이 바뀌면 "세부 유형 모름"으로 맞춥니다.
  function showSeason(season) {
    form.querySelectorAll(".subchoices").forEach(function (group) {
      var active = group.getAttribute("data-season") === season;
      group.hidden = !active;
      if (active && !group.querySelector("input:checked")) {
        group.querySelector('input[value="' + season + '"]').checked = true;
      }
    });
  }

  function personalColor() {
    var season = value("pcSeason");
    if (!season || season === store.PERSONAL_COLOR_UNKNOWN) return season;
    var detail = value("pcDetail");
    return store.seasonOf(detail) === season ? detail : season;
  }

  function updateLimits() {
    Object.keys(limits).forEach(function (name) {
      var limit = limits[name];
      var count = values(name).length;
      inputs(name).forEach(function (input) {
        input.disabled = !input.checked && count >= limit.max;
      });
      limit.count.textContent = count >= limit.max
        ? count + " / " + limit.max + "개 선택 · 다른 " + limit.what + "을 고르려면 하나를 해제해 주세요"
        : count + " / " + limit.max + "개 선택";
    });
  }

  function setSkinError(message) {
    skinError.textContent = message;
    skinField.classList.toggle("is-invalid", Boolean(message));
  }

  function restore(profile) {
    check("skin", profile.skin);
    profile.concerns.forEach(function (v) { check("concern", v); });
    profile.styles.forEach(function (v) { check("style", v); });
    if (profile.finish) check("finish", profile.finish);
    var pc = profile.personalColor;
    if (pc === store.PERSONAL_COLOR_UNKNOWN) {
      check("pcSeason", pc);
    } else if (pc) {
      check("pcSeason", store.seasonOf(pc));
      check("pcDetail", pc);
    }
  }

  form.addEventListener("change", function (event) {
    var name = event.target.name;
    if (name === "skin") setSkinError("");
    if (name === "pcSeason") {
      // 계절을 바꾸면 이전 계절의 세부 유형 선택을 지웁니다.
      inputs("pcDetail").forEach(function (input) { input.checked = false; });
      showSeason(event.target.value);
    }
    updateLimits();
    saved.hidden = true;
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!value("skin")) {
      setSkinError("피부 타입을 하나 선택해 주세요.");
      form.querySelector('input[name="skin"]').focus();
      return;
    }
    var result = store.save({
      skin: value("skin"),
      concerns: values("concern"),
      personalColor: personalColor(),
      styles: values("style"),
      finish: value("finish")
    });
    if (!result) {
      savedText.textContent = "이 브라우저에서는 프로필을 저장할 수 없어요. 사생활 보호(시크릿) 모드나 저장소 차단 설정을 확인해 주세요.";
      next.hidden = true;
    } else {
      savedText.textContent = "프로필을 저장했어요. 마이페이지에서 언제든 다시 수정할 수 있어요.";
      next.hidden = false;
    }
    saved.hidden = false;
    saved.focus();
  });

  var profile = store.load();
  if (profile) restore(profile);
  showSeason(value("pcSeason"));
  updateLimits();
})();
