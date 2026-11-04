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
  // 베이스는 얼굴 전체(이마·얼굴 가장자리·목)를 덮는 skin-full 마스크에 칠합니다(2026-11-03).
  // skin 마스크는 얼굴 안쪽 타원만 덮어 베이스 경계가 드러났습니다. skin은 치크 모양 계산에 그대로 씁니다.
  var CATEGORY_AREAS = { lip: ["lip"], cheek: ["cheek-l", "cheek-r"], eye: ["eyelid-l", "eyelid-r"], base: ["skin-full"] };
  // 한 색상 행이 양쪽 영역에 함께 적용될 때 쓰는 별칭 (예: area=eyelid → 양 눈꺼풀)
  // skin-full은 CSV의 area=skin 색상 행을 그대로 씁니다.
  var AREA_ALIAS = { "eyelid-l": "eyelid", "eyelid-r": "eyelid", "cheek-l": "cheek", "cheek-r": "cheek", "skin-full": "skin" };
  var CATEGORY_LABEL = { lip: "립", cheek: "치크", eye: "아이섀도우", base: "베이스" };
  // 혼합 초기 설정 (docs/simulation-design.md 4절). 실제 발색값이 아니며 미승인 초기값입니다.
  // simulation-colors.csv의 blend_mode·opacity 칸이 채워져 있으면 그 값을 씁니다.
  var ORDER = ["base", "cheek", "eye", "lip"]; // 베이스 → 치크 → 아이 → 립

  // ---------- 무드별 아이 표현 (2026-11-04) ----------
  // LOVELY는 여기 넣지 않습니다 → 기존 눈꺼풀 코드(고정 연핑크)를 그대로 씁니다.
  // 색은 항상 승인된 팔레트 칸 색(palette-colors.csv)이고, 무드 설정은 영역·불투명도만 정합니다.
  // 영역 이름은 eyelid-<l|r>-<lid|crease|outer|inner> 마스크(MK-0007~0014)입니다.
  var EYE_STYLE = {
    pure: { alpha: 0.25, roles: { base: ["lid"] } },
    nude: { alpha: 0.35, roles: { base: ["lid"], mid: ["crease"] } },
    modern: { alpha: 0.35, roles: { base: ["lid"], mid: ["crease"], shade: ["outer"] } },
    chic: { alpha: 0.45, roles: { base: ["lid"], mid: ["crease"], shade: ["outer"] } },
    glam: { alpha: 0.55, roles: { base: ["lid"], mid: ["crease"], shade: ["outer"], point: ["lid", "inner"] } },
    hip: { alpha: 0.5, roles: { mid: ["lid"], shade: ["outer", "crease"], point: ["inner"] } }
  };
  var ROLE_ORDER = ["base", "mid", "shade", "point"];
  var ROLE_WEIGHT = { base: 0.6, mid: 0.8, shade: 1.0, point: 0.7 };
  var ROLE_MODE = { base: "soft-light", mid: "multiply", shade: "multiply", point: "screen" };
  var ROLE_LABEL = { base: "베이스", mid: "중간", shade: "음영", point: "포인트" };
  // 아이라인: 팔레트의 공식 matte 칸 중 밝기 130 미만인 가장 어두운 칸. LOVELY는 넣지 않음(아이라인 없음).
  // from: 라인이 시작하는 위치(0 = 눈 앞머리, 1 = 눈꼬리), emphasis: 눈꼬리 쪽 강조, wing: 꼬리 길이 비율(0~1)
  var LINER_STYLE = {
    pure: { alpha: 0.18, from: 0, emphasis: 0, wing: 0 },
    nude: { alpha: 0.28, from: 0, emphasis: 0, wing: 0 },
    modern: { alpha: 0.38, from: 0, emphasis: 0.6, wing: 0.35 },
    chic: { alpha: 0.5, from: 0.33, emphasis: 0.4, wing: 0.65 },
    glam: { alpha: 0.55, from: 0, emphasis: 0.5, wing: 1 },
    hip: { alpha: 0.5, from: 0.5, emphasis: 0.3, wing: 1 }
  };
  var LINER_MAX_LIGHTNESS = 130;
  // 애교살: 7개 무드 공통. 공식 matte 칸 중 밝기 195 이상인 가장 밝은 칸만 사용, 없으면 칠하지 않음.
  var AEGYO = { areas: ["aegyo-l", "aegyo-r"], mode: "soft-light", alpha: 0.25, minLightness: 195 };
  // shade: 영역의 명암(주름·광택)은 비율로 유지하고, 영역 평균 밝기를 제품 색에 맞추는 픽셀 단위 합성.
  //        캔버스 'color' 혼합은 원래 밝기를 그대로 둬서 진한 립(예: 딥 레드)이 실제보다 밝게 보여 바꿨습니다.
  //        원래 밝은 반사광(광택)은 덮지 않고 살려 색이 평평하게 칠해진 느낌을 줄입니다.
  function defaults(category, row) {
    if (category === "lip") {
      var matte = row && row.subcategory === "lipstick";
      return [{ mode: "shade", alpha: matte ? 0.85 : 0.7 }];
    }
    // 아이: 눈꺼풀 전체에 애교살 부근까지 은은하게, 연한 핑크 느낌으로 고르게
    if (category === "eye") return [{ mode: "multiply", alpha: 0.42, fade: 0.65 }];
    if (category === "cheek") return [{ mode: "soft-light", alpha: 0.18 }];
    return [{ mode: "soft-light", alpha: 0.1 }];
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
  function shade(ctx, mask, hex, alpha) {
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    var o = off.getContext("2d");
    o.filter = "blur(1px)"; // 입술 경계를 살짝 부드럽게 (스티커처럼 끊기는 느낌 완화)
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
        a = (m[mi] / 255) * alpha * (1 - 0.7 * gloss);
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


  function maskAlpha(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return { w: w, h: h, d: c.getContext("2d").getImageData(0, 0, w, h).data };
  }

  function alphaCanvas(w, h, fn) {
    var out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    var o = out.getContext("2d");
    var img = o.createImageData(w, h);
    var d = img.data;
    for (var p = 0, i = 0; p < w * h; p++, i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = fn(p);
    }
    o.putImageData(img, 0, 0);
    return out;
  }

  var cheekCache = {};

  function cheekMask(maskImg, area) {
    if (cheekCache[area] && cheekCache[area].src === maskImg[area]) {
      return cheekCache[area].canvas;
    }

    var m = maskAlpha(maskImg[area]);
    var w = m.w, h = m.h, sx = 0, sy = 0, sw = 0;
    var x0 = w, x1 = 0, y0 = h, y1 = 0;

    for (var p = 0; p < w * h; p++) {
      var a = m.d[p * 4 + 3];
      if (a < 20) continue;
      var x = p % w, y = (p - x) / w;
      sx += x * a;
      sy += y * a;
      sw += a;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }

    if (!sw) return maskImg[area];

    var side = area === "cheek-l" ? -1 : 1;
    var bw = x1 - x0, bh = y1 - y0;
    var cx = sx / sw + side * bw * 0.12;
    var cy = sy / sw - bh * 0.1;
    var rx = bw * 0.95, ry = bh * 0.72;
    var tilt = side * -0.42;
    var cos = Math.cos(tilt), sin = Math.sin(tilt);
    var innerX = side < 0 ? x1 : x0;
    var topY = y0;
    var skin = maskImg.skin ? maskAlpha(maskImg.skin).d : null;
    var ex = ["lip", "eyelid-l", "eyelid-r"]
      .filter(function (k) { return maskImg[k]; })
      .map(function (k) { return maskAlpha(maskImg[k]).d; });

    function smooth(e0, e1, v) {
      var t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    }

    var canvas = alphaCanvas(w, h, function (q) {
      var x = q % w, y = (q - x) / w;
      var dx = x - cx, dy = y - cy;
      var u = (dx * cos + dy * sin) / rx;
      var v = (-dx * sin + dy * cos) / ry;
      var dist = Math.sqrt(u * u + v * v);

      if (dist >= 1) return 0;

      var a = 1 - smooth(0.4, 1, dist);
      a *= smooth(topY - 90, topY + 10, y);
      a *= smooth(0, 100, side < 0 ? innerX + 60 - x : x - (innerX - 60));

      if (skin) a *= skin[q * 4 + 3] / 255;
      for (var j = 0; j < ex.length && a; j++) {
        a *= Math.max(0, 1 - ex[j][q * 4 + 3] / 128);
      }
      return Math.round(255 * a);
    });

    cheekCache[area] = { src: maskImg[area], canvas: canvas };
    return canvas;
  }

  function softenHex(hex, amount) {
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    function channel(v) {
      return Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0");
    }
    return "#" + channel(r) + channel(g) + channel(b);
  }

  function tint(ctx, mask, hex, mode, alpha, fade) {
    if (mode === "shade") return shade(ctx, mask, hex, alpha);
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

  // ---------- 무드별 아이 표현 · 아이라인 · 애교살 (2026-11-04) ----------
  function hexLightness(hex) {
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function productPans(pans, productId) {
    return pans.filter(function (p) { return p.product_id === productId; });
  }

  // tone_role이 기록된 칸만 역할로 씁니다. 0030-01처럼 예전 역할 이름(highlight·deep·accent)도 대응합니다.
  function eyeRoles(list) {
    function pickRole(names, darkest) {
      var c = list.filter(function (p) { return names.indexOf(p.tone_role) >= 0; });
      if (!c.length) return null;
      c.sort(function (a, b) { return hexLightness(b.hex) - hexLightness(a.hex); });
      return darkest ? c[c.length - 1] : c[0];
    }
    return {
      base: pickRole(["base"]) || pickRole(["highlight"]),
      mid: pickRole(["mid"]),
      shade: pickRole(["deep"], true) || pickRole(["shade"], true),
      point: pickRole(["point"]) || pickRole(["accent"])
    };
  }

  function pickLiner(list) {
    var c = list.filter(function (p) { return p.texture === "matte" && hexLightness(p.hex) < LINER_MAX_LIGHTNESS; });
    c.sort(function (a, b) { return hexLightness(a.hex) - hexLightness(b.hex); });
    return c[0] || null;
  }

  function pickAegyo(list) {
    var c = list.filter(function (p) { return p.texture === "matte" && hexLightness(p.hex) >= AEGYO.minLightness; });
    c.sort(function (a, b) { return hexLightness(b.hex) - hexLightness(a.hex); });
    return c[0] || null;
  }

  // 마스크 알파에 x 위치별 가중치를 곱한 캔버스
  function weightedMask(img, fn) {
    var m = maskAlpha(img);
    return alphaCanvas(m.w, m.h, function (p) {
      var a = m.d[p * 4 + 3];
      return a ? Math.round(a * Math.max(0, Math.min(1, fn(p % m.w)))) : 0;
    });
  }

  // 마스크에서 다른 마스크 영역을 뺀 캔버스 (아이라인 자리에 눈꺼풀 색이 겹치지 않게)
  function cutMask(img, cuts, w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var o = c.getContext("2d");
    o.drawImage(img, 0, 0, w, h);
    o.globalCompositeOperation = "destination-out";
    cuts.forEach(function (k) { if (k) o.drawImage(k, 0, 0, w, h); });
    return c;
  }

  function maskBox(img) {
    var m = maskAlpha(img);
    var x0 = m.w, x1 = -1;
    for (var p = 0; p < m.w * m.h; p++) {
      if (m.d[p * 4 + 3] > 20) {
        var x = p % m.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    return { x0: x0, x1: x1 };
  }

  function smoothStep(e0, e1, v) {
    if (e1 === e0) return v >= e1 ? 1 : 0;
    var t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // 무드별 아이라인 마스크 (좌우). 왼쪽 눈은 x가 작은 쪽, 오른쪽 눈은 x가 큰 쪽이 눈꼬리입니다.
  function linerMasks(maskImg, style) {
    var out = [];
    ["l", "r"].forEach(function (s) {
      var line = maskImg["liner-" + s];
      if (!line) return;
      var b = maskBox(line);
      var outerX = s === "l" ? b.x0 : b.x1;
      var innerX = s === "l" ? b.x1 : b.x0;
      var span = Math.max(1, Math.abs(outerX - innerX));
      out.push(weightedMask(line, function (x) {
        var t = Math.abs(x - innerX) / span; // 0 앞머리 → 1 눈꼬리
        var start = style.from > 0 ? smoothStep(style.from - 0.08, style.from + 0.08, t) : 1;
        return start * ((1 - style.emphasis * 0.5) + style.emphasis * 0.5 * smoothStep(0.5, 1, t));
      }));
      var wing = maskImg["liner-wing-" + s];
      if (wing && style.wing > 0) {
        var wb = maskBox(wing);
        var len = Math.max(1, wb.x1 - wb.x0);
        var corner = s === "l" ? wb.x1 : wb.x0;
        out.push(weightedMask(wing, function (x) {
          var d = Math.abs(x - corner) / len;
          return 1 - smoothStep(style.wing - 0.2, style.wing, d);
        }));
      }
    });
    return out;
  }

  function paintEyeByMood(ctx, maskImg, colors, pans, pick, mood, applied, tileInfo) {
    var style = EYE_STYLE[mood];
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var list = productPans(pans, pick.productId);
    var single = null;
    if (!list.length) {
      // 팔레트 칸이 없는 단일 색 제품(예: 0034-01)은 승인 색 1개를 베이스로 봅니다.
      single = colors.filter(function (c) {
        return c.product_id === pick.productId && !c.pan_name && typeof c.area === "string" &&
          (c.area === "eye" || c.area.indexOf("eyelid") === 0);
      })[0] || null;
    }
    var roles = single
      ? { base: { hex: single.sim_hex.toUpperCase(), name: "", blend_mode: single.blend_mode, opacity: single.opacity }, mid: null, shade: null, point: null }
      : eyeRoles(list);
    var linerStyle = LINER_STYLE[mood];
    var linerPan = linerStyle ? pickLiner(list) : null;
    var linerCuts = linerPan ? linerMasks(maskImg, linerStyle) : [];
    var record = { productId: pick.productId, mood: mood, roles: {}, hexes: [], areas: [], layers: 0 };

    ROLE_ORDER.forEach(function (role) {
      var pan = roles[role];
      var areas = style.roles[role];
      if (!pan || !areas) return;
      var mode = pan.blend_mode || ROLE_MODE[role];
      var alpha = Math.min(1, style.alpha * ROLE_WEIGHT[role] * (pan.opacity ? Number(pan.opacity) : 1));
      var painted = [];
      ["l", "r"].forEach(function (s) {
        areas.forEach(function (a) {
          var name = "eyelid-" + s + "-" + a;
          if (!maskImg[name]) return;
          var m = linerCuts.length ? cutMask(maskImg[name], linerCuts, w, h) : maskImg[name];
          tint(ctx, m, pan.hex, mode, alpha, a === "lid" || a === "crease" ? 0.65 : 0);
          painted.push(name);
        });
      });
      if (painted.length) {
        record.roles[role] = { hex: pan.hex, name: pan.name || "", areas: painted, mode: mode, alpha: Math.round(alpha * 1000) / 1000 };
        if (record.hexes.indexOf(pan.hex) < 0) record.hexes.push(pan.hex);
        record.areas = record.areas.concat(painted);
        record.layers += painted.length;
      }
    });

    var notes = [];
    if (linerStyle) {
      if (linerPan) {
        linerCuts.forEach(function (m) { tint(ctx, m, linerPan.hex, "multiply", linerStyle.alpha, 0); });
        record.liner = { hex: linerPan.hex, name: linerPan.name, alpha: linerStyle.alpha, wing: linerStyle.wing };
        notes.push("아이라인 " + linerPan.hex);
      } else {
        record.liner = { skipped: "공식 매트 어두운 칸 없음" };
        notes.push("아이라인 미적용(공식 매트 어두운 칸 없음)");
      }
    }

    if (record.layers) {
      record.hex = record.hexes[0];
      record.pans = ROLE_ORDER.filter(function (r) { return record.roles[r]; }).map(function (r) { return record.roles[r].name; }).filter(Boolean);
      applied.eye = record;
      tileInfo.eye = {
        state: "applied",
        text: ROLE_ORDER.filter(function (r) { return record.roles[r]; }).map(function (r) {
          return ROLE_LABEL[r] + " " + record.roles[r].hex;
        }).join(" · ") + " 적용" + (notes.length ? " · " + notes.join(" · ") : "")
      };
    } else {
      tileInfo.eye = { state: "no-color", text: (list.length ? "역할 미지정 · 적용 안 함" : "색상 검수 전 · 적용 안 함") };
    }
    paintAegyo(ctx, maskImg, pans, pick, applied, tileInfo, true);
  }

  // 애교살: 7개 무드 공통 규칙. showSkip이 false(기존 LOVELY 경로)면 칠하지 못할 때 기록·문구를 바꾸지 않습니다.
  function paintAegyo(ctx, maskImg, pans, pick, applied, tileInfo, showSkip) {
    var pan = pickAegyo(productPans(pans, pick.productId));
    if (!pan) {
      if (showSkip && applied.eye) applied.eye.aegyo = { skipped: "공식 매트 밝은 칸 없음" };
      if (showSkip && tileInfo.eye && tileInfo.eye.state === "applied") tileInfo.eye.text += " · 애교살 미적용(공식 매트 밝은 칸 없음)";
      return;
    }
    var painted = [];
    AEGYO.areas.forEach(function (a) {
      if (!maskImg[a]) return;
      tint(ctx, maskImg[a], pan.hex, AEGYO.mode, AEGYO.alpha, 0);
      painted.push(a);
    });
    if (!painted.length) return;
    var info = { hex: pan.hex, name: pan.name, alpha: AEGYO.alpha, areas: painted };
    if (applied.eye) applied.eye.aegyo = info;
    else applied.eye = { productId: pick.productId, aegyo: info, hexes: [], areas: [], layers: 0 };
    if (tileInfo.eye && tileInfo.eye.state === "applied") tileInfo.eye.text += " · 애교살 " + pan.hex;
    else tileInfo.eye = { state: "applied", text: "애교살 " + pan.hex + " 적용" };
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
  // opts.mood: 결과 페이지의 무드. 없으면 기존 방식(LOVELY와 같은 경로)으로 그립니다.
  function render(container, picks, opts) {
    var mood = opts && typeof opts.mood === "string" ? opts.mood : "";
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
              layer: c.pan_index, blend_mode: c.blend_mode, opacity: c.opacity, pan_name: c.pan_name
            });
          });
        });
      }
      // 무드별 아이 표현용: 승인된 팔레트 칸(칸당 1개, 역할·질감 포함). 위의 colors 목록과 별도로 보관합니다.
      var pans = texts[2] ? records(texts[2]).filter(function (c) {
        return c.status === "approved" && /^#[0-9a-f]{6}$/i.test(c.pan_hex);
      }).map(function (c) {
        return {
          product_id: c.product_id, hex: c.pan_hex.toUpperCase(), name: c.pan_name || "",
          tone_role: c.tone_role || "", texture: c.texture || "unknown"
        };
      }) : [];
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
          return draw(container, status, imgs[0], maskImg, colors, picks, actual === expected, mood, pans);
        });
      });
    }).catch(function (error) {
      if (window.console) window.console.error("시뮬레이션 오류:", error);
      status.textContent = "시뮬레이션을 표시하지 못했어요. 원본 사진은 바뀌지 않았어요. (" + error.message + ")";
      status.classList.add("is-error");
    });
  }

  function draw(container, status, base, maskImg, colors, picks, hashChecked, mood, pans) {
    pans = pans || [];
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
      // PURE~HIP: 무드별 역할·영역으로 칠하는 새 경로 (LOVELY는 EYE_STYLE에 없어 아래 기존 코드 사용)
      if (category === "eye" && EYE_STYLE[mood]) {
        paintEyeByMood(ctx, maskImg, colors, pans, pick, mood, applied, tileInfo);
        return;
      }
      var done = [];
      CATEGORY_AREAS[category].forEach(function (area) {
        // 같은 영역에 승인 색이 여러 개면 layer 순서대로 겹칩니다(팔레트 조합 지원).
        // layer·blend_mode·opacity가 없는 기존 행은 기본 혼합 1회로 처리합니다.
        var rows = colors.filter(function (c) {
          if (c.product_id !== pick.productId) return false;
          if (c.area === area || c.area === AREA_ALIAS[area]) return true;
          if (category === "eye" && (c.area === "eye" || (typeof c.area === "string" && c.area.indexOf("eyelid") === 0))) return true;
          return false;
        }).map(function (c, i) { return { color: c, index: i }; });
        if ((!rows || !rows.length) && category === "eye") {
          rows = colors.filter(function (c) {
            return c.product_id === pick.productId && (c.area === "eye" || (typeof c.area === "string" && c.area.indexOf("eyelid") === 0));
          }).map(function (c, i) { return { color: c, index: i }; });
        }
        rows.sort(function (a, b) {
          return (Number(a.color.layer) || 0) - (Number(b.color.layer) || 0) || a.index - b.index;
        });
        rows.forEach(function (entry) {
          var color = entry.color;
          // skin-full 마스크가 없으면(예전 마스크 목록) 기존 skin 마스크로 칠합니다.
          var areaMask = maskImg[area] || (area === "skin-full" ? maskImg.skin : null);
          if (!areaMask) return;
          var steps = color.blend_mode && color.opacity
            ? [{ mode: color.blend_mode, alpha: Number(color.opacity) }]
            : defaults(category, pick.row);
          var maskSrc = category === "cheek" ? cheekMask(maskImg, area) : category === "eye" ? (function(){ var c2=document.createElement('canvas'); c2.width=ctx.canvas.width; c2.height=ctx.canvas.height; var o2=c2.getContext('2d'); o2.drawImage(maskImg[area],0,0); var m2=o2.getImageData(0,0,c2.width,c2.height); var d2=m2.data; for(var ii=3;ii<d2.length;ii+=4){ if(d2[ii]>0){ var na=Math.min(255, d2[ii]*1.12); d2[ii]=na; }} o2.putImageData(m2,0,0); return c2; })() : areaMask;
          steps.forEach(function (s) { tint(ctx, maskSrc, category === "eye" ? "#F4DCE4" : category === "cheek" ? softenHex(color.sim_hex, 0.25) : color.sim_hex, s.mode, (category === "eye" ? Math.min(0.10, s.alpha * 0.20) : s.alpha), s.fade); });
          done.push({ area: area, hex: color.sim_hex.toUpperCase(), layer: Number(color.layer) || 0, pan: color.pan_name || "" });
        });
      });
      if (done.length) {
        var hexes = [];
        done.forEach(function (d) { if (hexes.indexOf(d.hex) < 0) hexes.push(d.hex); });
        applied[category] = {
          productId: pick.productId, hex: hexes[0], hexes: hexes,
          areas: done.map(function (d) { return d.area; }), layers: done.length,
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
      // 기존 경로(LOVELY 등)에도 공통 애교살을 더합니다. 공식 matte 칸이 없으면 아무것도 바꾸지 않습니다.
      if (category === "eye") paintAegyo(ctx, maskImg, pans, pick, applied, tileInfo, false);
    });
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
      zooms.appendChild(zoomTile(result, category, tileInfo[category].text, tileInfo[category].state));
    });
    container.appendChild(zooms);
    container.appendChild(el("p", "sim__disclaimer",
      "AI로 만든 가상 인물의 얼굴 이미지 위에, 고른 셰이드의 표시용 색을 브라우저에서 합성한 시뮬레이션이에요. AI가 새로 그린 메이크업 사진이 아니며, " +
      "얼굴 영역은 이 사진 한 장에 맞춰 미리 정해 두었어요. 실제 발색·질감·광택과 다를 수 있어요." +
      (hashChecked ? "" : " (이 브라우저에서는 기준 이미지 확인을 건너뛰었어요)")));
    status.hidden = true;
    return { applied: applied, tileInfo: tileInfo, hashChecked: hashChecked };
  }

  window.MoodieSimulation = { render: render };
})();
