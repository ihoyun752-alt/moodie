// 공용: 추천 페이지에서 고른 제품 저장 (localStorage "moodie.selection"). 뷰티 프로필("moodie.profile")과 따로 저장합니다.
// 카테고리마다 1개(product_id)를 저장하고, 베이스는 제품(product_group_id)과 셰이드(product_id)를 따로 저장합니다.
// 선택은 무드에 묶입니다: 저장된 무드와 다른 무드로 들어오면 빈 선택으로 시작합니다.
(function () {
  "use strict";

  var STORAGE_KEY = "moodie.selection";
  var VERSION = 1;
  var CATEGORIES = ["lip", "cheek", "eye"];

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function empty(mood) {
    return { version: VERSION, mood: mood, lip: "", cheek: "", eye: "", baseGroup: "", baseShade: "", updatedAt: "" };
  }

  function normalize(raw) {
    if (!raw || typeof raw.mood !== "string") return null;
    var sel = empty(raw.mood);
    CATEGORIES.forEach(function (c) { sel[c] = text(raw[c]); });
    sel.baseGroup = text(raw.baseGroup);
    sel.baseShade = sel.baseGroup ? text(raw.baseShade) : "";
    sel.updatedAt = text(raw.updatedAt);
    return sel;
  }

  // 이 무드의 저장된 선택. 없거나 다른 무드의 선택이면 빈 선택을 돌려줍니다.
  function load(mood) {
    var sel = null;
    try {
      sel = normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      sel = null;
    }
    return sel && sel.mood === mood ? sel : empty(mood);
  }

  // 저장에 성공하면 저장한 선택을, 실패하면 null을 돌려줍니다.
  function save(sel) {
    var clean = normalize(sel);
    if (!clean) return null;
    clean.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return clean;
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

  window.MoodieSelection = {
    CATEGORIES: CATEGORIES,
    load: load,
    save: save,
    clear: clear
  };
})();
