# moodie.

> 오늘의 나는, 이런 무드.

**moodie.(무디)** 는 나의 피부와 취향, 그리고 오늘 원하는 분위기에 맞는 뷰티를 발견하도록 돕는 개인화 화장품 추천 웹 서비스입니다.

사용자는 사진을 보고 7가지 메이크업 무드(PURE · NUDE · MODERN · LOVELY · CHIC · GLAM · HIP) 중 오늘의 무드를 고르고, 이후 단계에서 뷰티 프로필과 무드에 맞는 맞춤 화장품 TOP 3를 추천받게 됩니다.

## 현재 상태

| 구분 | 상태 |
|---|---|
| 메인 페이지 (`index.html`): 브랜드 소개, "나의 무드 찾기 →" | ✅ 구현 |
| MOOD 페이지 (`mood.html`): 7가지 무드 중 하나 선택 | ✅ 구현 |
| 공통 헤더·푸터, 전체 메뉴(≡), 반응형 레이아웃, 키보드 조작 | ✅ 구현 |
| NEW · BEST · ALL 페이지 | 🔜 "준비 중" 안내만 있음 |
| 검색, 장바구니 아이콘 | 🔜 누르면 "준비 중" 안내 |
| "이 무드로 추천받기" 결과 화면 | 🔜 누르면 "준비 중" 안내 |
| 히어로 손글씨 글꼴 | 🔜 3가지 후보 비교 중 (`dev/font-compare.html`, 임시 기본값: Allura) |
| 뷰티 프로필, 추천 결과(TOP 3), 추천 알고리즘 | ⏳ 이후 단계 |
| 실제 화장품 데이터, 인기 랭킹 | ⏳ 이후 단계 (확인된 데이터만 사용 예정) |

실제 제품 데이터가 준비되기 전까지 이 사이트는 **가짜 제품이나 임의의 인기도·추천 점수를 실제 정보처럼 표시하지 않습니다.**

## 페이지 구조

```
index.html   메인: 브랜드 소개, "나의 무드 찾기 →"
mood.html    MOOD: 오늘의 무드 7가지 중 하나 선택 → 추천받기 (결과 화면은 준비 중)
new.html     NEW: 신제품 탐색 (준비 중)
best.html    BEST: 확인된 랭킹 데이터 기반 인기 제품 (준비 중)
all.html     ALL: 카테고리별 전체 제품 (준비 중)
```

## 기술

- HTML, CSS, JavaScript만 사용합니다. 빌드 도구나 별도 설치가 필요 없습니다.
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

## 폴더 구조

```
index.html  mood.html  new.html  best.html  all.html
css/
  tokens.css     색, 글꼴, 크기 등 디자인 값 (시안에서 측정한 색)
  base.css       공통: 헤더, 전체 메뉴, 푸터, 버튼, 안내 메시지
  hero-art.css   히어로 장식: 흐림 베일 + HTML 손글씨
  pages.css      페이지별: 히어로, 메인, MOOD 카드, 준비 중 페이지, 반응형
js/
  nav.js         공통: 전체 메뉴 열기/닫기, 준비 중 안내, 손글씨 글꼴 미리보기
  mood-page.js   MOOD: 카드 선택, 추천받기 버튼
assets/
  moods/         무드 카드 얼굴 이미지 7장 (pure, nude, modern, lovely, chic, glam, hip)
  hero/          히어로 장식 이미지 (powder.png)
dev/
  font-compare.html  손글씨 글꼴 비교 (개발용, 글꼴 결정 후 삭제 예정)
docs/
  design.md         디자인 기준
  image-credits.md  이미지 출처와 제작 정보
  ideas.md          추후 확장 아이디어
```

## 이미지에 대하여

`assets/`의 이미지는 **ChatGPT(OpenAI)로 생성한 AI 이미지**입니다. 실제 인물을 촬영한 사진이 아닙니다. 제작 과정과 라이선스 확인 상태는 [`docs/image-credits.md`](docs/image-credits.md)에 기록되어 있습니다.

## 만든 사람

- [@ihoyun752-alt](https://github.com/ihoyun752-alt)
- 수업 Project 1 과제로 진행하며, 개발 과정에서 AI 코딩 도우미(Claude Code)의 도움을 받았습니다.
