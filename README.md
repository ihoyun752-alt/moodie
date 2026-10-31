# moodie.

> 오늘의 나는, 이런 무드.

**moodie.(무디)** 는 나의 피부와 취향, 그리고 오늘 원하는 분위기에 맞는 뷰티를 발견하도록 돕는 개인 맞춤형 뷰티·메이크업 추천 웹 서비스입니다. AI 기반 맞춤 추천을 목표로 하고 있습니다.

사용자는 사진을 보고 7가지 메이크업 무드(PURE · NUDE · MODERN · LOVELY · CHIC · GLAM · HIP) 중 오늘의 무드를 고르고, 피부 타입과 취향을 담은 뷰티 프로필을 설정합니다. 지금은 **추천 서비스의 화면과 사용자 흐름을 구현한 초기 단계**이며, 무드와 프로필에 맞는 화장품 TOP 3 추천은 이후 단계에서 개발합니다.

## 현재 상태

### 구현된 기능

| 기능 | 설명 |
|---|---|
| 메인 페이지 (`index.html`) | 브랜드 소개, "나의 무드 찾기 →", 무디 픽 캐러셀(이번 주 신제품 · 무드별 인기 제품 · 출석 체크 이벤트 카드) |
| 무드 선택 (`mood.html`) | 7가지 메이크업 무드 중 하나 선택. 저장된 프로필이 있으면 결과 요약으로, 없으면 프로필 설정으로 이동 |
| 뷰티 프로필 (`profile.html`) | 피부 타입(필수), 피부 고민(3개까지), 퍼스널 컬러(사용자가 알고 있는 유형), 선호 스타일(3개까지), 선호 마무리감 입력. 브라우저 localStorage에 저장 |
| 마이페이지 (`mypage.html`) | 저장한 프로필 요약, 수정, 삭제 |
| 결과 요약 (`result.html`) | 선택한 무드의 이미지와 이름, 저장한 뷰티 프로필 요약 |
| 무드 이미지 | PURE · NUDE · MODERN · LOVELY · CHIC는 렌즈 색과 아이라인을 다듬은 수정 이미지, GLAM · HIP는 원본 이미지 사용 |
| 공통 | 헤더·푸터, 전체 메뉴(≡), 마이페이지 아이콘, 반응형 레이아웃, 키보드 조작 |

### 아직 구현되지 않은 기능

| 기능 | 현재 화면 |
|---|---|
| 실제 화장품 TOP 3 추천 알고리즘 | 결과 요약 화면은 무드와 프로필만 보여 주고, 제품·점수·순위는 표시하지 않음 |
| 제품별 추천 점수, 인기 순위 계산 | 표시하지 않음 (캐러셀의 인기 제품 카드는 "순위 미공개") |
| 실제 화장품 데이터 연동 | NEW · BEST · ALL 페이지는 "준비 중" 안내만 있음. 캐러셀의 신제품 카드는 카테고리 샘플 그림만 있음 |
| AI 셀카 메이크업 합성 | 없음 |
| 출석 체크, 검색, 장바구니 | "준비 중" 안내 (출석 기록은 저장하지 않음) |
| 히어로 손글씨 글꼴 확정 | 3가지 후보 비교 중 (`dev/font-compare.html`, 임시 기본값: Allura) |

실제 제품 데이터가 준비되기 전까지 이 사이트는 **가짜 제품이나 임의의 인기도·추천 점수를 실제 정보처럼 표시하지 않습니다.**

## 페이지 구조

```
index.html     메인: 브랜드 소개, "나의 무드 찾기 →", 무디 픽 캐러셀
mood.html      MOOD: 오늘의 무드 7가지 중 하나 선택 → 다음: 결과 보기
profile.html   뷰티 프로필 설정 (저장하면 다음 단계 버튼이 나타남: 무드를 고르고 왔으면 그 무드의 결과 요약, 아니면 무드 선택)
result.html    결과 요약: 선택한 무드 + 저장된 뷰티 프로필
mypage.html    마이페이지: 프로필 요약, 수정, 삭제
new.html       NEW: 신제품 탐색 (준비 중)
best.html      BEST: 확인된 랭킹 데이터 기반 인기 제품 (준비 중)
all.html       ALL: 카테고리별 전체 제품 (준비 중)
```

사용 흐름: `mood.html` → (프로필이 없으면) `profile.html` → `result.html` → `mypage.html`에서 언제든 수정·삭제

## 기술

- HTML, CSS, JavaScript만 사용합니다. 빌드 도구나 별도 설치가 필요 없습니다.
- 뷰티 프로필은 **브라우저의 localStorage에만** 저장합니다(키: `moodie.profile`). 로그인이 없고, 프로필을 외부 서버로 보내지 않습니다. 다른 브라우저나 기기와는 공유되지 않으며, 마이페이지에서 삭제할 수 있습니다.
- 글꼴은 웹 글꼴을 불러와 사용합니다: DM Serif Display(로고), Inter(메뉴), Noto Serif KR(한글 제목), Pretendard(본문), 손글씨 후보 3종(Pinyon Script, Allura, Great Vibes).

## 실행 방법

저장소 폴더에서 아래 명령으로 간단한 로컬 서버를 실행합니다. Python 3이 필요합니다.

```sh
python3 -m http.server 8000
```

그다음 브라우저에서 <http://localhost:8000> 을 엽니다. 서버를 끄려면 터미널에서 `Ctrl + C`를 누릅니다.

- 손글씨 글꼴 비교: <http://localhost:8000/dev/font-compare.html>
- 실제 화면에서 글꼴 바꿔 보기: 주소 끝에 `?script=pinyon`, `?script=allura`, `?script=greatvibes`를 붙입니다 (예: `mood.html?script=pinyon`).
- 글꼴은 인터넷에서 불러오므로(Google Fonts, jsDelivr) 인터넷 연결이 필요합니다.
- 프로필은 접속한 주소(예: `http://localhost:8000`)별로 브라우저에 저장됩니다. 사생활 보호(시크릿) 모드나 저장소 차단 설정에서는 저장되지 않을 수 있습니다.

## 폴더 구조

```
index.html  mood.html  profile.html  result.html  mypage.html  new.html  best.html  all.html
css/
  tokens.css     색, 글꼴, 크기 등 디자인 값 (시안에서 측정한 색)
  base.css       공통: 헤더, 전체 메뉴, 푸터, 버튼, 안내 메시지
  hero-art.css   히어로 장식: 흐림 베일 + HTML 손글씨
  pages.css      페이지별: 히어로, 메인·캐러셀, MOOD 카드, 프로필·결과·마이페이지, 준비 중 페이지, 반응형
js/
  nav.js           공통: 전체 메뉴 열기/닫기, 준비 중 안내, 손글씨 글꼴 미리보기
  profile-store.js 공통: 무드·프로필 항목 목록, 프로필 저장·불러오기·삭제 (localStorage)
  home.js          메인: 캐러셀, 출석 체크 주간 날짜 표시
  mood-page.js     MOOD: 카드 선택, 프로필 유무에 따라 다음 단계로 이동
  profile-page.js  뷰티 프로필 입력·저장
  result-page.js   결과 요약 표시
  mypage.js        마이페이지: 프로필 요약, 삭제
assets/
  moods/         무드 카드 얼굴 원본 이미지 7장 (pure, nude, modern, lovely, chic, glam, hip)
  moods/edit/    최종 수정 이미지 5장 (pure, nude, modern, lovely, chic)
  hero/          히어로 장식 이미지 (powder.png)
dev/
  font-compare.html  손글씨 글꼴 비교 (개발용, 글꼴 결정 후 삭제 예정)
  edit-moods.py      무드 수정 이미지 생성·검증 스크립트 (개발용)
docs/
  design.md         디자인 기준 (무드별 최종 수정 내용은 10절)
  image-credits.md  이미지 출처와 제작 정보
  ideas.md          추후 확장 아이디어
```

## 이미지에 대하여

`assets/`의 이미지는 **ChatGPT(OpenAI)로 생성한 AI 이미지**입니다. 실제 인물을 촬영한 사진이 아닙니다. 제작 과정과 라이선스 확인 상태는 [`docs/image-credits.md`](docs/image-credits.md)에 기록되어 있습니다.

### 원본과 수정 이미지

7장의 얼굴이 같아 무드끼리 구분이 약하므로, 렌즈 색과 아이라인만 무드별로 다르게 다듬은 수정 이미지를 만들었습니다. 무드별 수정 내용은 [`docs/design.md`](docs/design.md) 10절에 있습니다.

- **원본과 분리:** 원본(`assets/moods/*.png`)은 덮어쓰지 않고 보존하며, 수정 이미지는 `assets/moods/edit/`에 같은 파일명으로 따로 저장합니다.
- **적용:** MOOD 카드와 결과 요약 화면은 PURE · NUDE · MODERN · LOVELY · CHIC에 수정 이미지를, GLAM · HIP에 원본을 씁니다.
- **검증:** `dev/edit-moods.py`는 정해진 눈 주변 영역 밖 픽셀이 원본과 같은지 픽셀 단위로 확인하고, 동공·반사광·눈꺼풀 선 같은 보호 좌표가 바뀌지 않았는지 검사합니다. 또 다른 무드의 결과물과 이전 버전 백업이 바뀌지 않았는지 SHA-256 해시로 확인하며, 이미 있는 결과 파일은 덮어쓰지 않습니다.
- **한계:** 이 스크립트의 해시 검사는 Git에서 제외된 `docs/reference/` 폴더(비교 이미지, 이전 버전 백업)를 함께 확인합니다. 그래서 저장소를 새로 받은 곳에서는 검사가 통과하지 않습니다. 실행하려면 Python 3과 Pillow가 필요합니다.

## 만든 사람

- [@ihoyun752-alt](https://github.com/ihoyun752-alt)
- 수업 Project 1 과제로 진행하며, 개발 과정에서 AI 코딩 도우미(Claude Code)의 도움을 받았습니다.
