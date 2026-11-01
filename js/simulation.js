// 메이크업 시뮬레이션 (window.MoodieSimulation): 기준 얼굴 이미지 위에 고른 셰이드의 승인된 색을 브라우저 캔버스에서 합성합니다.
// - AI가 새로 그린 이미지가 아니라, 정해진 얼굴 영역 마스크에 색을 섞는 방식입니다(docs/simulation-design.md).
// - data/simulation-colors.csv에서 status = approved인 product_id의 색만 씁니다. 색이 없으면 그 부위는 칠하지 않습니다(임의 색 금지).
// - data/simulation-masks.csv의 기준 이미지 해시가 실제 이미지와 다르면 적용하지 않습니다.
// - 원본 이미지 파일은 바꾸지 않습니다. 화면의 캔버스에만 그립니다.
(function () {
  "use strict";

  var data = window.MoodieProducts;
  var COLORS_URL = "data/simulation-colors.csv";
  var MASKS_URL = "data/simulation-masks.csv";
  var PALETTE_URL = "data/palette-colors.csv";
  var CATEGORY_AREAS = { lip: ["lip"], cheek: ["cheek-l", "cheek-r"], eye: ["eyelid-l", "eyelid-r"], base: ["skin"] };
  // 한 색상 행이 양쪽 영역에 함께 적용될 때 쓰는 별칭 (예: area=eyelid → 양 눈꺼풀)
  var AREA_ALIAS = { "eyelid-l": "eyelid", "eyelid-r": "eyelid", "cheek-l": "cheek", "cheek-r": "cheek" };
  var CATEGORY_LABEL = { lip: "립", cheek: "치크", eye: "아이섀도우", base: "베이스" };
  // 팔레트 칸 역할(palette-colors.csv tone_role) → 눈두덩 영역 마스크 (eyelid-l-lid 등). 빈 값 = 눈두덩 전체.
  var ROLE_ZONE = { base: "", mid: "lid", accent: "lid", shade: "crease", deep: "outer", highlight: "inner" };
  // 칠하는 순서: 넓은 베이스 → 중간 → 음영 → 진한 음영 → 포인트 → 하이라이트
  var ROLE_ORDER = { base: 0, mid: 1, shade: 2, deep: 3, accent: 4, highlight: 5 };
  // 팔레트 칸 혼합 초기 설정 (미승인 초기값). palette-colors.csv에 blend_mode·opacity가 있으면 그 값을 씁니다.
  var ROLE_STEP = {
    base: { mode: "multiply", alpha: 0.35, fade: 0.6 },
    mid: { mode: "multiply", alpha: 0.5, fade: 0.6 },
    accent: { mode: "multiply", alpha: 0.5, fade: 0.6 },
    shade: { mode: "multiply", alpha: 0.55 },
    deep: { mode: "multiply", alpha: 0.6 },
    highlight: { mode: "soft-light", alpha: 0.6 }
  };
  // 혼합 초기 설정 (docs/simulation-design.md 4절). 실제 발색값이 아니며 미승인 초기값입니다.
  // simulation-colors.csv의 blend_mode·opacity 칸이 채워져 있으면 그 값을 씁니다.
  var ORDER = ["base", "cheek", "eye", "lip"]; // 베이스 → 치크 → 아이 → 립
  // shade: 영역의 명암(주름·광택)은 비율로 유지하고, 영역 평균 밝기를 제품 색에 맞추는 픽셀 단위 합성.
  //        캔버스 'color' 혼합은 원래 밝기를 그대로 둬서 진한 립(예: 딥 레드)이 실제보다 밝게 보여 바꿨습니다.
  //        원래 밝은 반사광(광택)은 덮지 않고 살려 색이 평평하게 칠해진 느낌을 줄입니다.
  // 립 제형별 광택 보존 정도 (0 = 반사광도 제품 색으로 덮음, 1 = 반사광을 거의 그대로 둠). 초기 설정, 미승인.
  // 매트 립스틱은 원래 입술의 반사광을 줄이고, 틴트·밤·글로스는 반사광을 살립니다.
  var LIP_GLOSS = { lipstick: 0.3, tint: 0.75, "lip-balm": 0.85, gloss: 0.95 };
  function lipGloss(row) {
    var sub = row ? row.subcategory : "";
    return Object.prototype.hasOwnProperty.call(LIP_GLOSS, sub) ? LIP_GLOSS[sub] : 0.7;
  }

  function defaults(category, row) {
    if (category === "lip") {
      var matte = row && row.subcategory === "lipstick";
      return [{ mode: "shade", alpha: matte ? 0.85 : 0.7, gloss: lipGloss(row) }];
    }
    // 아이: 눈꺼풀 영역은 속눈썹 그림자가 섞여 평균 밝기가 낮아 shade가 오히려 밝게 만들므로 multiply(덧입힘)를 씁니다.
    // fade: 속눈썹 쪽(아래)을 진하게, 눈썹 쪽(위)을 옅게 (설계 문서 4절 lash-to-brow)
    if (category === "eye") return [{ mode: "multiply", alpha: 0.85, fade: 0.4 }];
    if (category === "cheek") return [{ mode: "soft-light", alpha: 0.3 }];
    // 베이스: 립과 같은 픽셀 비율 합성(shade). 픽셀마다 명암 비율(모공·결·그림자)은 그대로 두고 피부 평균색만 제품 색 쪽으로 옮깁니다.
    // 흐림·평활화는 하지 않아 피부 질감이 유지됩니다. skin 마스크는 눈·눈썹·입술·콧구멍을 제외합니다.
    if (category === "base") return [{ mode: "shade", alpha: BASE_ALPHA, gloss: baseGloss(row) }];
    return [{ mode: "soft-light", alpha: 0.1 }];
  }

  // 베이스 강도와 마무리감별 광택 보존 정도 (초기 설정, 미승인). 매트일수록 원래 피부 광(반사광)을 조금 더 눌러 줍니다.
  var BASE_ALPHA = 0.4;
  var BASE_GLOSS = { matte: 0.55, "semi-matte": 0.7 };
  function baseGloss(row) {
    var fin = row ? row.finish : "";
    return Object.prototype.hasOwnProperty.call(BASE_GLOSS, fin) ? BASE_GLOSS[fin] : 0.85;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function records(text) {
    var rows = data.parseCsv(text);
    var head = rows[0] || [];
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (k, i) { o[k] = (r[i] || "").trim(); });
      return o;
    });
  }

  function fetchText(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " HTTP " + r.status);
      return r.text();
    });
  }

  // 선택 파일: 없으면 빈 문자열 (팔레트 구성은 아직 검토 중일 수 있음)
  function optionalText(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { return r.ok ? r.text() : ""; });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("이미지를 불러오지 못함: " + src)); };
      img.src = src;
    });
  }

  function sha256Hex(buffer) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve("");
    return window.crypto.subtle.digest("SHA-256", buffer).then(function (hash) {
      return Array.prototype.map.call(new Uint8Array(hash), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // 픽셀 단위 합성: 결과 = 제품 색 × (픽셀 밝기 ÷ 영역 평균 밝기), 마스크 알파 × 강도만큼 섞음.
  function shade(ctx, mask, hex, alpha, glossKeep) {
    if (glossKeep === undefined || isNaN(glossKeep)) glossKeep = 0.7;
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    var o = off.getContext("2d");
    // 입술 경계를 살짝 부드럽게 (스티커처럼 끊기는 느낌 완화). 이미 경계를 다듬은 베이스 마스크(data-soft)는 흐리지 않습니다.
    o.filter = mask.getAttribute && mask.getAttribute("data-soft") ? "none" : "blur(1px)";
    o.drawImage(mask, 0, 0, w, h);
    o.filter = "none";
    var m = o.getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var i = 3; i < m.length; i += 4) {
      if (m[i]) {
        var p = (i - 3) / 4;
        var x = p % w;
        var y = (p - x) / w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return;
    var bw = x1 - x0 + 1;
    var bh = y1 - y0 + 1;
    var img = ctx.getImageData(x0, y0, bw, bh);
    var d = img.data;
    var sumL = 0;
    var sumW = 0;
    var yy, xx, k, mi, a;
    for (yy = 0; yy < bh; yy++) {
      for (xx = 0; xx < bw; xx++) {
        mi = ((y0 + yy) * w + (x0 + xx)) * 4 + 3;
        if (!m[mi]) continue;
        k = (yy * bw + xx) * 4;
        sumL += luminance(d[k], d[k + 1], d[k + 2]) * m[mi];
        sumW += m[mi];
      }
    }
    var meanL = sumW ? sumL / sumW : 1;
    var meanC = [0, 0, 0];
    if (sumW) {
      for (yy = 0; yy < bh; yy++) {
        for (xx = 0; xx < bw; xx++) {
          mi = ((y0 + yy) * w + (x0 + xx)) * 4 + 3;
          if (!m[mi]) continue;
          k = (yy * bw + xx) * 4;
          for (var j = 0; j < 3; j++) meanC[j] += d[k + j] * m[mi];
        }
      }
      for (j = 0; j < 3; j++) meanC[j] = Math.max(1, meanC[j] / sumW);
    }
    var t = [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
    // 제품 색을 원래 입술 평균색에 대한 비율로 적용합니다. 입술 고유의 혈색과 명암이 함께 남아 덧칠한 느낌이 줄어듭니다.
    var scale = [t[0] / meanC[0], t[1] / meanC[1], t[2] / meanC[2]];
    for (yy = 0; yy < bh; yy++) {
      for (xx = 0; xx < bw; xx++) {
        mi = ((y0 + yy) * w + (x0 + xx)) * 4 + 3;
        if (!m[mi]) continue;
        k = (yy * bw + xx) * 4;
        var ratio = luminance(d[k], d[k + 1], d[k + 2]) / meanL;
        var mx = Math.max(d[k], d[k + 1], d[k + 2]);
        var mn = Math.min(d[k], d[k + 1], d[k + 2]);
        // 밝고 채도가 낮은 반사광(광택)은 제품 색을 덜 입혀 원래 빛 표현을 살립니다.
        var gloss = ratio > 1.15 && mx && (mx - mn) / mx < 0.3 ? Math.min(1, (ratio - 1.15) / 0.35) : 0;
        a = (m[mi] / 255) * alpha * (1 - glossKeep * gloss);
        for (var c = 0; c < 3; c++) {
          var target = Math.min(255, d[k + c] * scale[c]);
          d[k + c] = Math.round(d[k + c] * (1 - a) + target * a);
        }
      }
    }
    ctx.putImageData(img, x0, y0);
  }

  // 마스크(흰색 + 알파) 모양대로 색을 칠한 층을 만들어 지정한 혼합 방식으로 겹칩니다.
  // fade: 마스크 세로 방향 농도. 위쪽(눈썹 쪽)은 fade 값, 아래쪽(속눈썹 쪽)은 1로 점점 진해집니다.
  function fadeMask(o, w, h, fade) {
    var img = o.getImageData(0, 0, w, h);
    var d = img.data;
    var top = h;
    var bottom = -1;
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3]) {
          if (y < top) top = y;
          bottom = y;
          break;
        }
      }
    }
    if (bottom <= top) return;
    for (y = top; y <= bottom; y++) {
      var f = fade + (1 - fade) * (y - top) / (bottom - top);
      for (x = 0; x < w; x++) {
        i = (y * w + x) * 4 + 3;
        d[i] = Math.round(d[i] * f);
      }
    }
    o.putImageData(img, 0, 0);
  }

  // 베이스 전용 마스크 (브라우저 안에서만 만들고 원본 마스크 파일은 바꾸지 않음):
  // 1) skin 마스크 안쪽으로만 경계를 넓게 흐려(바깥으로는 번지지 않음) 이마 위·턱선·목에 경계선이 생기지 않게 합니다.
  // 2) 입술·눈꺼풀 마스크가 절반 이상인 곳은 0으로 빼서 그 부위 색이 바뀌지 않게 합니다.
  // 3) skin 마스크가 턱 아래에서 얼굴 윤곽 밖 배경까지 조금 덮고 있어(약 2.9만 픽셀), 원본 사진에서 채도(최대−최소)가
  //    낮은 배경색 픽셀은 뺍니다. 배경 채도 ≈ 11, 피부 채도 하위 1% ≈ 30 (2026-11-02 측정). 14 이하는 0, 24 이상은 그대로.
  var BASE_EDGE_BLUR = 40;
  var BASE_EXCLUDE = ["lip", "eyelid-l", "eyelid-r"];
  var BASE_BG_CHROMA = [14, 24];
  var baseMaskCache = null;
  function baseMask(maskImg, photo) {
    if (baseMaskCache && baseMaskCache.skin === maskImg.skin && baseMaskCache.photo === photo) return baseMaskCache.canvas;
    var skin = maskImg.skin;
    var w = skin.naturalWidth || skin.width;
    var h = skin.naturalHeight || skin.height;
    function alphaOf(img, blur) {
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      var x = c.getContext("2d");
      if (blur) x.filter = "blur(" + blur + "px)";
      x.drawImage(img, 0, 0, w, h);
      return x.getImageData(0, 0, w, h).data;
    }
    var sharp = alphaOf(skin, 0);
    var soft = alphaOf(skin, BASE_EDGE_BLUR);
    var ex = BASE_EXCLUDE.filter(function (k) { return maskImg[k]; }).map(function (k) { return alphaOf(maskImg[k], 0); });
    var src = alphaOf(photo, 0);
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    var o = out.getContext("2d");
    var img = o.createImageData(w, h);
    var d = img.data;
    for (var i = 3; i < d.length; i += 4) {
      // 흐린 마스크가 절반(경계)인 곳에서 0, 안쪽으로 갈수록 1: 경계에서 계단이 생기지 않게 안쪽으로만 서서히 진해집니다.
      var a = sharp[i] * Math.min(1, Math.max(0, (soft[i] / 255 - 0.5) * 2));
      for (var j = 0; j < ex.length && a; j++) a *= Math.max(0, 1 - ex[j][i] / 128);
      if (a) {
        var chroma = Math.max(src[i - 3], src[i - 2], src[i - 1]) - Math.min(src[i - 3], src[i - 2], src[i - 1]);
        a *= Math.min(1, Math.max(0, (chroma - BASE_BG_CHROMA[0]) / (BASE_BG_CHROMA[1] - BASE_BG_CHROMA[0])));
      }
      d[i - 3] = 255;
      d[i - 2] = 255;
      d[i - 1] = 255;
      d[i] = Math.round(a);
    }
    o.putImageData(img, 0, 0);
    out.setAttribute("data-soft", "1");
    baseMaskCache ={ skin: maskImg.skin, photo: photo, canvas: out };
    return out;
  }

  function tint(ctx, mask, hex, mode, alpha, fade, gloss) {
    if (mode === "shade") return shade(ctx, mask, hex, alpha, gloss);
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    var o = off.getContext("2d");
    o.drawImage(mask, 0, 0, w, h);
    if (fade) fadeMask(o, w, h, fade);
    o.globalCompositeOperation = "source-in";
    o.fillStyle = hex;
    o.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  // 사진 위에 붙는 라벨 ("메이크업 전" / "추천 제품으로 완성한 메이크업")
  function figure(title, canvas, accent) {
    var fig = el("figure", "sim__figure");
    fig.appendChild(canvas);
    fig.appendChild(el("figcaption", "sim__caption" + (accent ? " is-accent" : ""), title));
    return fig;
  }

  // 부위별 확대 칸: 결과 캔버스에서 해당 부위를 잘라 보여 줍니다 (기준 이미지 1040×1337 좌표).
  var ZOOM = {
    base: { x: 380, y: 120, w: 280, h: 175 },
    eye: { x: 90, y: 365, w: 380, h: 238 },
    cheek: { x: 60, y: 650, w: 300, h: 188 },
    lip: { x: 320, y: 885, w: 400, h: 250 }
  };
  var ZOOM_ORDER = ["base", "eye", "cheek", "lip"];

  function zoomTile(result, category, text, state) {
    var z = ZOOM[category];
    var c = el("canvas", "sim__zoom-canvas");
    c.width = 320;
    c.height = 200;
    c.getContext("2d").drawImage(result, z.x, z.y, z.w, z.h, 0, 0, c.width, c.height);
    c.setAttribute("aria-hidden", "true");
    var tile = el("li", "sim__zoom" + (state === "applied" ? "" : " is-off"));
    tile.setAttribute("data-category", category);
    tile.setAttribute("data-state", state);
    tile.appendChild(c);
    tile.appendChild(el("span", "sim__zoom-title", CATEGORY_LABEL[category]));
    tile.appendChild(el("span", "sim__zoom-text", text));
    return tile;
  }

  // picks: [{ category, productId, row }] (row = products 행, 없으면 null)
  function render(container, picks) {
    container.textContent = "";
    container.hidden = false;
    var status = el("p", "sim__status", "시뮬레이션을 준비하는 중이에요…");
    container.appendChild(status);

    return Promise.all([fetchText(COLORS_URL), fetchText(MASKS_URL), optionalText(PALETTE_URL)]).then(function (texts) {
      var colors = records(texts[0]).filter(function (c) { return c.status === "approved" && /^#[0-9a-f]{6}$/i.test(c.sim_hex); });
      // 승인된 팔레트 칸 색은 양쪽 눈꺼풀에 layer 순서로 더합니다. 검토 중(reference)인 칸은 적용하지 않습니다.
      if (texts[2]) {
        records(texts[2]).filter(function (c) {
          return c.status === "approved" && /^#[0-9a-f]{6}$/i.test(c.pan_hex);
        }).forEach(function (c) {
          CATEGORY_AREAS.eye.forEach(function (area) {
            colors.push({
              product_id: c.product_id, area: area, sim_hex: c.pan_hex,
              layer: c.pan_index, blend_mode: c.blend_mode, opacity: c.opacity, pan_name: c.pan_name,
              role: c.tone_role || "", zone: Object.prototype.hasOwnProperty.call(ROLE_ZONE, c.tone_role) ? ROLE_ZONE[c.tone_role] : ""
            });
          });
        });
      }
      var masks = records(texts[1]);
      if (!masks.length) throw new Error("등록된 얼굴 마스크가 없음");
      var baseSrc = masks[0].base_image;
      var expected = masks[0].base_image_sha256;
      return fetch(baseSrc, { cache: "no-cache" }).then(function (r) { return r.arrayBuffer(); }).then(sha256Hex).then(function (actual) {
        if (actual && expected && actual !== expected) throw new Error("기준 이미지 해시가 마스크 등록 정보와 다름");
        var maskByArea = {};
        masks.forEach(function (m) { maskByArea[m.area] = m.mask_path; });
        var areas = Object.keys(maskByArea);
        return Promise.all([loadImage(baseSrc)].concat(areas.map(function (a) { return loadImage(maskByArea[a]); }))).then(function (imgs) {
          var maskImg = {};
          areas.forEach(function (a, i) { maskImg[a] = imgs[i + 1]; });
          return draw(container, status, imgs[0], maskImg, colors, picks, actual === expected);
        });
      });
    }).catch(function (error) {
      if (window.console) window.console.error("시뮬레이션 오류:", error);
      status.textContent = "시뮬레이션을 표시하지 못했어요. 원본 사진은 바뀌지 않았어요. (" + error.message + ")";
      status.classList.add("is-error");
    });
  }

  function draw(container, status, base, maskImg, colors, picks, hashChecked) {
    var w = base.naturalWidth;
    var h = base.naturalHeight;
    var original = el("canvas", "sim__canvas");
    var result = el("canvas", "sim__canvas");
    original.id = "sim-original";
    result.id = "sim-result";
    [original, result].forEach(function (c) {
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(base, 0, 0);
    });
    original.setAttribute("role", "img");
    original.setAttribute("aria-label", "원본 얼굴 이미지 (AI 생성, 화장 전)");
    result.setAttribute("role", "img");

    var ctx = result.getContext("2d");
    var applied = {};
    var tileInfo = {};
    ORDER.forEach(function (category) {
      var pick = picks.filter(function (p) { return p.category === category; })[0];
      if (!pick || !pick.productId) {
        tileInfo[category] = { state: "none", text: "선택 안 함 · 적용 안 함" };
        return;
      }
      var done = [];
      CATEGORY_AREAS[category].forEach(function (area) {
        // 같은 영역에 승인 색이 여러 개면 layer 순서대로 겹칩니다(팔레트 조합 지원).
        // layer·blend_mode·opacity가 없는 기존 행은 기본 혼합 1회로 처리합니다.
        var rows = colors.filter(function (c) {
          return c.product_id === pick.productId && (c.area === area || c.area === AREA_ALIAS[area]);
        }).map(function (c, i) { return { color: c, index: i }; });
        // 팔레트 칸은 역할 순서(베이스 → … → 하이라이트), 그 밖에는 layer 순서
        function order(c) { return c.role && ROLE_ORDER[c.role] !== undefined ? ROLE_ORDER[c.role] : 0; }
        rows.sort(function (a, b) {
          return order(a.color) - order(b.color) || (Number(a.color.layer) || 0) - (Number(b.color.layer) || 0) || a.index - b.index;
        });
        rows.forEach(function (entry) {
          var color = entry.color;
          // 팔레트 칸은 역할에 맞는 영역 마스크에, 영역 마스크가 없으면 눈두덩 전체에 칠합니다.
          var maskKey = color.zone && maskImg[area + "-" + color.zone] ? area + "-" + color.zone : area;
          if (!maskImg[maskKey]) return;
          var maskSrc = category === "base" && maskKey === "skin" ? baseMask(maskImg, base) : maskImg[maskKey];
          var steps = color.blend_mode && color.opacity
            ? [{ mode: color.blend_mode, alpha: Number(color.opacity) }]
            : color.role && ROLE_STEP[color.role] ? [ROLE_STEP[color.role]] : defaults(category, pick.row);
          // simulation-colors.csv의 gloss 칸이 채워져 있으면 그 값을, 없으면 제형별 초기 설정을 씁니다(립).
          var glossKeep = color.gloss !== undefined && color.gloss !== "" ? Number(color.gloss)
            : (category === "lip" ? lipGloss(pick.row) : (category === "base" ? baseGloss(pick.row) : undefined));
          steps.forEach(function (s) { tint(ctx, maskSrc, color.sim_hex, s.mode, s.alpha, s.fade, s.gloss !== undefined ? glossKeep : undefined); });
          done.push({ area: maskKey, hex: color.sim_hex.toUpperCase(), layer: Number(color.layer) || 0, pan: color.pan_name || "", gloss: category === "lip" || category === "base" ? glossKeep : undefined });
        });
      });
      if (done.length) {
        var hexes = [];
        done.forEach(function (d) { if (hexes.indexOf(d.hex) < 0) hexes.push(d.hex); });
        applied[category] = {
          productId: pick.productId, hex: hexes[0], hexes: hexes,
          areas: done.map(function (d) { return d.area; }), layers: done.length, gloss: done[0].gloss,
          pans: done.map(function (d) { return d.pan; }).filter(Boolean)
        };
        tileInfo[category] = {
          state: "applied",
          text: hexes.length > 1
            ? "표시용 색 " + hexes.join(" · ") + " 조합 적용"
            : "표시용 색 " + hexes[0] + " 적용"
        };
      } else {
        tileInfo[category] = { state: "no-color", text: "색상 검수 전 · 적용 안 함" };
      }
    });
    // 고객 화면: 색값(HEX)·검수 상태 대신 적용 여부만 보여 줍니다. 원래 문구는 data-dev-text에 남깁니다(?view=dev면 원래 문구).
    var customer = window.MoodieDataMode ? window.MoodieDataMode.isCustomer : true;
    var CUSTOMER_TILE = { applied: "메이크업 적용", "no-color": "미리보기 준비 안 됨", none: "선택 안 함" };
    if (customer) {
      Object.keys(tileInfo).forEach(function (c) {
        tileInfo[c].devText = tileInfo[c].text;
        tileInfo[c].text = CUSTOMER_TILE[tileInfo[c].state] || tileInfo[c].text;
      });
    }
    var appliedNames = Object.keys(applied).map(function (c) { return CATEGORY_LABEL[c]; });
    result.setAttribute("aria-label", "메이크업 색 합성 결과" + (appliedNames.length ? " (" + appliedNames.join(", ") + " 적용)" : " (적용된 색 없음)"));
    container.setAttribute("data-applied", JSON.stringify(applied));

    container.textContent = "";
    var pair = el("div", "sim__pair");
    pair.appendChild(figure("메이크업 전", original, false));
    var arrow = el("span", "sim__arrow");
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8l8 8-8 8"/></svg>';
    pair.appendChild(arrow);
    pair.appendChild(figure("추천 제품으로 완성한 메이크업", result, true));
    container.appendChild(pair);
    var zooms = el("ul", "sim__zooms");
    zooms.setAttribute("aria-label", "부위별 확대");
    ZOOM_ORDER.forEach(function (category) {
      var tile = zoomTile(result, category, tileInfo[category].text, tileInfo[category].state);
      if (tileInfo[category].devText) tile.setAttribute("data-dev-text", tileInfo[category].devText);
      zooms.appendChild(tile);
    });
    container.appendChild(zooms);
    container.appendChild(el("p", "sim__disclaimer", customer
      ? "AI로 만든 가상 얼굴에 고른 제품의 색을 입혀 본 메이크업 미리보기예요. 실제 발색·질감·광택은 피부와 조명에 따라 다를 수 있어요."
      : "AI로 만든 가상 인물의 얼굴 이미지 위에, 고른 셰이드의 표시용 색을 브라우저에서 합성한 시뮬레이션이에요. AI가 새로 그린 메이크업 사진이 아니며, " +
        "얼굴 영역은 이 사진 한 장에 맞춰 미리 정해 두었어요. 실제 발색·질감·광택과 다를 수 있어요." +
        (hashChecked ? "" : " (이 브라우저에서는 기준 이미지 확인을 건너뛰었어요)")));
    status.hidden = true;
    return { applied: applied, tileInfo: tileInfo, hashChecked: hashChecked };
  }

  window.MoodieSimulation = { render: render };
})();
