"""무드 카드 얼굴 이미지의 렌즈 색과 아이라인을 고친 시범 수정본을 만듭니다.

기준: docs/design.md 10절 "무드별 눈 화장 기준"

- 원본(assets/moods/*.png)은 읽기만 합니다. 수정본은 assets/moods/edit/에 저장합니다.
- 마스크(수정을 허용한 영역) 밖 픽셀이 원본과 하나라도 다르면 저장하지 않고 멈춥니다.
- 확대 비교 이미지와 차이 이미지는 docs/reference/preview/에 저장합니다 (Git 제외 폴더).

실행: .venv/bin/python dev/edit-moods.py
한 무드만: .venv/bin/python dev/edit-moods.py nude (이름 없이 실행하면 EDITS의 모든 무드를 처리합니다)
이미 수정본이나 비교 이미지가 있는 무드가 하나라도 있으면 아무것도 저장하지 않고 멈춥니다 (덮어쓰기 방지).
"""

import hashlib
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets" / "moods"
OUT_DIR = SRC_DIR / "edit"
PREVIEW_DIR = ROOT / "docs" / "reference" / "preview"
SIZE = (201, 257)
SCALE = 4  # 마스크와 선을 4배로 그린 뒤 줄여 가장자리를 부드럽게 합니다

# 좌표는 원본 이미지 기준 (x, y) 픽셀입니다. 2026-10-26에 원본을 측정해 정했습니다.

# PURE: 지울 꼬리 영역 (왼쪽, 위, 오른쪽, 아래). 눈꼬리 바깥만 포함합니다.
PURE_TAILS = [(5, 86, 11, 91), (186, 85, 192, 91)]

# CHIC: 렌즈
CHIC_IRISES = [(49, 96), (148, 96)]  # 홍채 중심 (반사광 바로 아래)
IRIS_RADIUS = 12
IRIS_BOTTOM = 105  # 아래 속눈썹을 피하려고 이 줄 아래는 바꾸지 않습니다
PUPIL_MAX_Y = 24  # 이 밝기 이하(동공, 윗라인)는 바꾸지 않습니다
HIGHLIGHT_MIN_Y = 125  # 이 밝기 이상(반사광, 흰자)은 바꾸지 않습니다
# 열(x)마다 윗눈꺼풀 선의 맨 아래 줄(y). 이 줄까지는 바꾸지 않습니다.
# 홍채 원 위쪽에서 처음 나오는 어두운 띠(밝기 30 이하)의 끝 줄을 원본에서 측정했습니다.
# 눈꺼풀 선이 비스듬해 한 줄로 자를 수 없고, 두 눈의 모양도 좌우 반대라 따로 둡니다.
# 표에 없는 열(오른쪽 눈 x 136~137: 어두운 띠가 없음)은 통째로 바꾸지 않습니다.
LID_BOTTOM_LEFT = {
    37: 87, 38: 91, 39: 90, 40: 90, 41: 89, 42: 89, 43: 89, 44: 90, 45: 91, 46: 92, 47: 96, 48: 96, 49: 89,
    50: 89, 51: 89, 52: 90, 53: 96, 54: 91, 55: 91, 56: 92, 57: 93, 58: 94, 59: 95, 60: 96, 61: 96,
}
LID_BOTTOM_RIGHT = {
    138: 96, 139: 96, 140: 94, 141: 93, 142: 92, 143: 91, 144: 90, 145: 90, 146: 89, 147: 91, 148: 89, 149: 89,
    150: 89, 151: 90, 152: 90, 153: 90, 154: 90, 155: 90, 156: 90, 157: 90, 158: 90, 159: 90, 160: 91,
}
LID_BOTTOM = {**LID_BOTTOM_LEFT, **LID_BOTTOM_RIGHT}
LENS_GRAY = (0x86, 0x81, 0x7E)  # 따뜻한 회색 #86817E: 따뜻한 피부 옆에서도 푸르게 보이지 않고 중립 회색으로 읽히게 합니다

# CHIC: 꼬리 연장 (기존 꼬리 끝, 뻗는 방향, 늘릴 길이 px)
CHIC_WINGS = [((3.0, 77.0), (-0.6, -0.8), 2.5), ((195.0, 78.0), (0.707, -0.707), 3.0)]
LINER = (0x1A, 0x16, 0x16)

# NUDE: 2026-10-29에 원본(nude.png)을 따로 측정해 정했습니다. CHIC 값과 다릅니다.
# 렌즈: 홍채 아래쪽 행(y 98~106)의 좌우 끝 가운데가 x 48.0 / 148.5~149.0이고, 행별 폭을 원에 맞추면 중심 y 약 96, 반지름 약 11.5입니다.
# 반지름과 아래 경계(IRIS_BOTTOM)는 CHIC와 같은 값을 씁니다 (홍채는 y 106까지 보이고 y 107부터 아래 눈꺼풀 피부).
NUDE_IRISES = [(48, 96), (149, 96)]
# NUDE 렌즈 마스크는 픽셀 중심이 이 반지름 안인 픽셀만 넣습니다 (부드러운 가장자리 없음).
# 2026-10-29 측정은 정확히 이 픽셀들(y 106까지)의 색을 모두 확인했으므로, 측정하지 않은 테두리 픽셀이 마스크에 들어가지 않습니다.
NUDE_IRIS_RADIUS = 12
# 열(x)마다 윗눈꺼풀 선의 맨 아래 줄(y). NUDE의 눈꺼풀 선은 밝기 31~35인 픽셀이 섞여 있어(예: x 44의 #2E1913)
# CHIC 기준(밝기 30 이하)으로는 홍채 한가운데 열(x 44, 142~144)이 빠지므로, 밝기 36 이하인 첫 어두운 띠의 끝 줄로 측정했습니다.
# 띠가 동공과 이어진 열(x 45~47, 51~52, 145~146)은 동공 아래 끝까지 바꾸지 않습니다.
NUDE_LID_BOTTOM_LEFT = {
    36: 86, 37: 91, 38: 90, 39: 89, 40: 89, 41: 89, 42: 88, 43: 88, 44: 89, 45: 97, 46: 98, 47: 98, 48: 89,
    49: 89, 50: 89, 51: 97, 52: 97, 53: 95, 54: 94, 55: 94, 56: 94, 57: 95, 58: 96, 59: 97, 60: 96,
}
NUDE_LID_BOTTOM_RIGHT = {
    137: 96, 138: 96, 139: 95, 140: 93, 141: 92, 142: 91, 143: 90, 144: 90, 145: 97, 146: 97, 147: 90, 148: 89,
    149: 89, 150: 90, 151: 89, 152: 88, 153: 89, 154: 89, 155: 89, 156: 90, 157: 90, 158: 89, 159: 90, 160: 90, 161: 87,
}
NUDE_LID_BOTTOM = {**NUDE_LID_BOTTOM_LEFT, **NUDE_LID_BOTTOM_RIGHT}
# 채도(색 진하기 ÷ 밝기) 기준. 홍채는 대부분 0.25~0.45이고, 반사광 둘레·작은 반사광 가운데·그늘진 흰자는 0.05~0.15입니다.
# 0.16 미만은 바꾸지 않고, 0.16~0.26은 비율만큼 덜 바꿉니다 (동공·홍채 경계 픽셀).
NUDE_SAT = (0.16, 0.26)
NUDE_LENS = (0xA0, 0x70, 0x3F)  # 카멜 브라운 #A0703F (design.md 10절 시작값)
NUDE_LENS_GAIN = 1.15  # 홍채 밝기를 최대 15% 올립니다. 1.0이면 CHIC처럼 밝기를 그대로 둡니다

# NUDE: 렌즈에서 절대 바꾸지 않는 픽셀 목록 (x, y). 2026-10-29 원본 RGB 측정값이 근거이고, 편집 뒤 원본과 RGB가 같은지 따로 검사합니다.
# 오른쪽 동공: 밝기 약 25~33으로 PUPIL_MAX_Y(24)보다 밝아 밝기 조건으로는 보호되지 않습니다. 이어진 어두운 영역만 넣었습니다.
#   예: (148,93) #201718, (149,94) #241B18, (148,96) #261917, (151,97) #2C1B16. (152,95) #2E1D19(밝기 34)부터는 홍채 쪽이라 뺐습니다.
NUDE_PUPIL_RIGHT = (
    [(146, 92)]
    + [(x, 93) for x in range(145, 151)]
    + [(x, 94) for x in range(145, 153)]
    + [(x, y) for y in (95, 96) for x in range(145, 152)]
    + [(x, 97) for x in range(146, 152)]
)
# 왼쪽 동공 중 눈꺼풀 표로 보호되지 않는 열(x 48~50, 반사광 바로 아래). 가운데는 밝기 19~24, 아래 끝은 25~29입니다.
#   예: (48,94) #1A120F, (50,97) #231611, (48,98) #251712, (50,98) #2B1812. 그 아래 (48,99) #382119(밝기 약 39)부터 홍채입니다.
NUDE_PUPIL_LEFT = [(x, y) for y in range(93, 99) for x in range(48, 51)]
# 큰 반사광과 둘레. 왼쪽 x 48~50, y 90~92 (가운데 (49,91) #F9F6F6). (50,90) #372724는 반사광 (49,90) #5D514F와
#   눈꺼풀 쪽 (51,90) #271411 사이에서 양쪽보다 밝은 회색(채도 0.21)이라 반사광 둘레로 봅니다.
# 오른쪽 x 147~150, y 90~92 (가운데 (149,91) #F3F3F5). (147,90) #2C1B14, (150,90) #2D1B17은 눈꺼풀 표로 이미 보호됩니다.
NUDE_HIGHLIGHTS = (
    [(x, y) for y in (90, 91, 92) for x in (48, 49, 50)]
    + [(148, 90), (149, 90)] + [(x, y) for y in (91, 92) for x in (147, 148, 149, 150)]
)
# 왼쪽 눈 작은 회색 반사광: x 43, y 93~96 (#564038, #6A5650, #65534C, #4D3832, 밝기 62~91).
#   위 (43,92) #452C23, 아래 (43,97) #452C27, 왼쪽 x 42, 오른쪽 x 44보다 모두 밝은 세로 1픽셀 줄입니다. 양 끝 (43,93), (43,96)은 채도 0.20~0.21이라 채도 조건만으로는 일부 바뀝니다.
NUDE_SMALL_REFLECTION = [(43, 93), (43, 94), (43, 95), (43, 96)]
# 원 테두리의 회색 경계 픽셀: 원 안에서 채도 0.19~0.26으로 측정된 픽셀 중 중심에서 약 10.5 이상 떨어진 것 (그늘진 흰자·아래 눈꺼풀과 섞인 픽셀).
#   예: (161,96) #583F3A, (160,100) #58423B, (42,106) #7A574C.
NUDE_RIM = [(38, 102), (59, 100), (58, 102), (57, 103), (42, 106), (54, 106),
            (161, 96), (160, 99), (160, 100), (139, 102), (159, 102), (155, 106)]
NUDE_LENS_KEEP = frozenset(NUDE_PUPIL_RIGHT + NUDE_PUPIL_LEFT + NUDE_HIGHLIGHTS + NUDE_SMALL_REFLECTION + NUDE_RIM)
# 윗눈꺼풀 선과 그 위 (원 맨 위 줄부터 표의 줄까지). 렌즈와 꼬리 처리 뒤 원본과 RGB가 같은지 검사합니다.
NUDE_LID_PIXELS = frozenset((x, y) for x, lid in NUDE_LID_BOTTOM.items()
                            for y in range(NUDE_IRISES[0][1] - NUDE_IRIS_RADIUS, lid + 1))

# NUDE: 아이라인 꼬리. 눈꼬리(흰자 끝)는 왼쪽 x 23, 오른쪽 x 173 부근이고, 원래 꼬리는 비스듬히 위로 뻗어 x 7 / x 191, y 85에서 끝납니다.
# 상자(왼쪽, 위, 오른쪽, 아래)는 눈꼬리에서 떨어진 꼬리 바깥쪽만 담습니다. 아래 줄(y 92~)의 아래 눈매 선과 눈꼬리 쪽 라인(x 16~22 / 174~180)은 넣지 않습니다.
# recolor: 이 x에서 0 → 이 x에서 1까지 웜 브라운으로 바뀌는 비율. 상자 안쪽 끝에서 원래 라인과 자연스럽게 이어지게 합니다.
# keep: 이 x에서 0(지움) → 이 x에서 1(유지). 바깥쪽 끝을 지우고 서서히 흐려지게 해 꼬리를 짧고 부드럽게 만듭니다 (꼬리 길이 조정값).
# skin_above_only: 아래 피부 줄(y 92)이 아래 눈매 선이 시작되는 곳이라 어두운 열. 위 줄(y 84)만 피부로 씁니다.
#   y 92 밝기: 왼쪽 x 13 → 15가 104, 89, 72 / 오른쪽 x 183 → 181이 103, 89, 73 (위 줄 y 84는 87~98).
NUDE_TAILS = [
    {"box": (4, 85, 15, 91), "recolor": (16, 13), "keep": (10, 14), "skin_above_only": (14, 15)},
    {"box": (181, 85, 192, 91), "recolor": (180, 183), "keep": (186, 182), "skin_above_only": (181, 182)},
]
NUDE_LINER = (0x6B, 0x4A, 0x35)  # 웜 브라운 #6B4A35 (design.md 10절 시작값). 색 방향(색상)으로 쓰고, 밝기는 아래 비율만큼만 따라갑니다
# 라인 밝기를 목표색 밝기(약 81) 쪽으로 옮기는 비율. 1이면 목표색 그대로(주변 피부 72~110과 거의 같아 선이 사라짐),
# 0이면 원래 밝기 그대로. 0.5면 가장 진한 부분(약 30)이 약 55가 되어 피부와 구분됩니다 (손계산, 실행 확인 전)
NUDE_LINER_LIFT = 0.5
LINER_CORE_Y = 28  # 원래 라인 가장 진한 부분의 밝기 (예: #2F1712, #2A1611). 이만큼 어두우면 라인이 100% 덮은 픽셀로 봅니다
TAIL_MIN_DARK = 6  # 피부 추정값보다 이만큼 이상 어두운 픽셀만 라인으로 봅니다 (피부 결은 그대로 둠)

# MODERN: 2026-10-31에 원본(modern.png)을 따로 측정해 정했습니다. CHIC·NUDE 값과 다릅니다.
# 렌즈: 홍채 y 97~106 행의 좌우 끝 가운데가 x 48.5~49.0 / 149.5~150.0이고, 행별 폭을 원에 맞추면 중심 y 약 96, 반지름 약 12.1~12.3입니다.
MODERN_IRISES = [(49, 96), (150, 96)]
MODERN_IRIS_RADIUS = 12
# y 106까지는 홍채(밝기 66~98, 채도 0.26~0.31). y 107은 홍채(x 45~51, 146~154)와 아래 눈꺼풀이 섞인 줄, y 108부터 피부입니다.
MODERN_IRIS_BOTTOM = 106
MODERN_MIXED_ROW_MAX_Y = 100  # 섞인 줄(y 107)은 밝기가 이 값 미만인 픽셀만 50% 바꿉니다
# 열(x)마다 윗눈꺼풀 선의 맨 아래 줄(y). 밝기 36 이하인 첫 어두운 띠의 끝 줄로 측정했습니다.
# x 145는 가장 어두운 값이 37이라 띠가 없어, 가장 어두운 줄(y 90~91)로 정했습니다.
# 띠가 동공과 이어진 열(x 47~48, 53, 147, 152~154)은 동공 아래 끝까지 바꾸지 않습니다.
# 표에 없는 홍채 테두리 열(x 37, 137~138, 162)은 통째로 바꾸지 않습니다.
MODERN_LID_BOTTOM_LEFT = {
    38: 92, 39: 92, 40: 92, 41: 91, 42: 90, 43: 90, 44: 90, 45: 89, 46: 89, 47: 97, 48: 98, 49: 90,
    50: 89, 51: 89, 52: 90, 53: 98, 54: 96, 55: 94, 56: 91, 57: 92, 58: 94, 59: 96, 60: 98, 61: 97,
}
MODERN_LID_BOTTOM_RIGHT = {
    139: 94, 140: 93, 141: 93, 142: 92, 143: 92, 144: 91, 145: 91, 146: 90, 147: 98, 148: 90, 149: 89, 150: 89,
    151: 90, 152: 97, 153: 97, 154: 97, 155: 96, 156: 92, 157: 92, 158: 92, 159: 93, 160: 93, 161: 93,
}
MODERN_LID_BOTTOM = {**MODERN_LID_BOTTOM_LEFT, **MODERN_LID_BOTTOM_RIGHT}
MODERN_SAT = (0.16, 0.22)  # 홍채 채도는 0.23~0.33(5~95%). 0.16 미만은 바꾸지 않고 0.16~0.22는 비율만큼 덜 바꿉니다
MODERN_LENS = (0x7D, 0x71, 0x6A)  # 애시 그레이 브라운 #7D716A (design.md 10절 시작값). 밝기는 그대로 둡니다
# 색 성분을 목표색 쪽으로 옮기는 최대 비율. 1.0이면 채도가 약 0.07로 회색에 가까워(2026-10-31 버전 1) CHIC와 구분이 약했습니다.
# 0.75면 원래 홍채 색이 25% 남아 채도 약 0.12의 차분한 애시 브라운이 됩니다 (손계산, 실행 확인 전)
MODERN_LENS_STRENGTH = 0.75
# 동공: 가운데는 밝기 17~24, 아래 끝은 25~37이라 밝기 조건(PUPIL_MAX_Y)만으로는 다 보호되지 않습니다.
#   예: (50,94) #18100E, (49,98) #211512, (50,99) #2A1A15. 오른쪽 (149,94) #16100C, (148,98) #291C16.
MODERN_PUPIL_LEFT = [(x, y) for y in range(93, 100) for x in range(49, 53)]
MODERN_PUPIL_RIGHT = [(x, y) for y in range(93, 99) for x in range(148, 152)]
# 큰 반사광과 둘레. 왼쪽 가운데 (51,92) #E9E5E4, 오른쪽 가운데 (149,91) #CECBC9. 둘레(밝기 40~80)까지 4×4로 둡니다.
MODERN_HIGHLIGHTS = ([(x, y) for y in range(90, 94) for x in range(49, 53)]
                     + [(x, y) for y in range(90, 94) for x in range(148, 152)])
# 왼쪽 눈 작은 반사광: 밝기 66~82로 양옆(x 42: 53~64, x 45: 39~42)보다 15 이상 밝습니다. 예: (43,95) #624A3E, (44,95) #624D42.
# 오른쪽 (156~157, 97~99)은 채도가 홍채와 같고(0.22~0.24) 아래로 갈수록 밝아지는 결이라 넣지 않았습니다.
MODERN_SMALL_REFLECTION = [(43, 94), (43, 95), (44, 95), (43, 96), (44, 96)]
MODERN_LENS_KEEP = frozenset(MODERN_PUPIL_LEFT + MODERN_PUPIL_RIGHT + MODERN_HIGHLIGHTS + MODERN_SMALL_REFLECTION)
# 윗눈꺼풀 선과 그 위 (원 맨 위 줄부터 표의 줄까지). 렌즈와 꼬리 처리 뒤 원본과 RGB가 같은지 검사합니다.
MODERN_LID_PIXELS = frozenset((x, y) for x, lid in MODERN_LID_BOTTOM.items()
                              for y in range(MODERN_IRISES[0][1] - MODERN_IRIS_RADIUS, lid + 1))

# MODERN: 아이라인 꼬리. 원래 꼬리는 수평 부분 끝(왼쪽 x 12~13, 오른쪽 x 187)에서 약 45° 위로 꺾여 (6,84) / (192~193,84)에서 끝납니다.
# 1) 지우기: 상자(왼쪽, 위, 오른쪽, 아래) 안에서 새 꼬리 선 중심보다 MODERN_ERASE_MARGIN 이상 위이고,
#    피부 추정값보다 TAIL_MIN_DARK 이상 어두운 픽셀만 피부 추정값으로 채웁니다.
#    피부 추정값은 위 줄(y 82)과 아래 줄(y 90, 91 중 밝은 쪽)을 세로로 섞습니다. 아래 줄 하나만 쓰면 x 11~12 / 186~187에서 라인 색이 섞입니다.
MODERN_TAIL_BOXES = [(5, 83, 12, 88), (188, 83, 194, 88)]
MODERN_SKIN_ABOVE_Y = 82
MODERN_SKIN_BELOW_YS = (90, 91)
# 1.5px: 선 위쪽 끝(중심 - 반폭 0.8)에서 픽셀 반 칸을 더 띄운 값. 결과적으로 y 87 이하만 지우고, 수평 라인의 윗줄(y 88)은 남깁니다.
MODERN_ERASE_MARGIN = 1.5
# 수평 부분 열은 지우지 않습니다. 라인 띠가 아래 줄(y 90)까지 내려와 피부 추정값보다 이만큼 이상 어두우면 수평 부분으로 봅니다.
# 원본 측정 (밝기, y 87/88/89/90): x 13은 66/49/42/52, x 12는 68/57/45/86로 띠가 y 87~90, 가장 어두운 줄 y 89로 같습니다.
# x 11은 65/54/63/127로 y 90이 피부(127)이고 가장 어두운 줄이 y 88로 올라갑니다. 꼬리는 x 11부터 올라갑니다.
# 그래서 (12,88) #45342F(밝기 57)는 위아래 (12,87) 68, (12,89) 45와 이어진 수평 부분의 가운데 줄이며, 지우면 x 12 열에 구멍이 생깁니다.
# 이 기준으로 수평 부분이 되는 열은 왼쪽 x 12(y 90 차이 39)뿐입니다. 오른쪽 x 188은 y 90 차이 12라 꼬리로 봅니다.
MODERN_BASE_MIN_DARK = 30
# 지우지 않는 주름 그늘 픽셀 (원본 측정값 근거). 왼쪽 (10~12, 84~85), (11~12, 86) — (11,86) #85665D(밝기 110),
#   (12,86) #8C6B63(밝기 116)은 x 13~15의 y 86 그늘 104~109와 같은 줄입니다.
#   오른쪽 (188~189, 84~86), (190,84). 피부보다 6~27 어둡지만 상자 밖 주름 그늘(y 84~87)과 이어진 줄입니다.
MODERN_TAIL_KEEP = frozenset(
    [(x, y) for x in (10, 11, 12) for y in (84, 85)] + [(11, 86), (12, 86)]
    + [(x, y) for x in (188, 189) for y in (84, 85, 86)] + [(190, 84)]
)
# 2) 색 바꾸기: 수평 라인(y 88~90)만. y 87 이하(주름 그늘)와 y 91 이상(아래 눈매 선이 만나는 줄)은 넣지 않습니다.
#    ramp: 이 x에서 0 → 이 x에서 1. 눈꼬리(흰자 끝 왼쪽 x 22~23, 오른쪽 x 178~180) 쪽은 원래 색을 둡니다.
MODERN_RECOLOR = [{"box": (5, 88, 24, 90), "ramp": (24, 18)}, {"box": (176, 88, 194, 90), "ramp": (176, 182)}]
MODERN_LINER = (0x3A, 0x3A, 0x3C)  # 차콜 #3A3A3C (design.md 10절 시작값)
MODERN_LINER_LIFT = 0.2  # 밝기를 차콜 밝기(약 58) 쪽으로 옮기는 비율. 가장 진한 부분(약 30)이 약 36이 됩니다 (손계산, 실행 확인 전)
# 3) 덧그리기: extend_wings로 수평 부분 끝에서 약 7° 위(거의 수평)로 5px. 반폭은 extend_wings 안의 값(0.8 → 0.15)을 씁니다.
#    설계값 0.9 → 0.2와 차이는 한쪽 0.05~0.1px입니다. 0.9면 시작 부분 아래 끝(약 y 90.57)이 아래 눈매 선 줄(y 91)에 닿을 수 있어 0.8을 씁니다.
MODERN_WINGS = [((13.0, 89.5), (-0.99, -0.12), 5.0), ((187.0, 89.5), (0.99, -0.12), 5.0)]
MODERN_WING_MAX_Y = 90  # 덧그린 선이 이 줄 아래(아래 눈매 선)를 건드리면 그 픽셀은 덧그리기 전 값으로 되돌립니다
# 검사 기준
MODERN_LOWER_LASH = frozenset((x, y) for y in range(91, SIZE[1]) for x in [*range(12, 27), *range(172, 189)])
MODERN_CREASE_AREA = [(x, y) for y in range(84, 88) for x in [*range(5, 31), *range(165, 197)]]
MODERN_FLAT_COLUMNS = [range(8, 14), range(187, 193)]  # 열마다 가장 어두운 줄(y 86~90)의 위아래 차이가 1px 이하여야 합니다
MODERN_LINE_MIN_DARK = 10  # 위 피부(y 82)보다 이만큼 이상 어두운 열만 라인이 있는 열로 셉니다
MODERN_LEFTOVER_COLUMNS = [range(5, 12), range(188, 195)]
MODERN_LEFTOVER_DARK = 20  # y 87 미만에서 피부 추정값보다 이만큼 이상 어두운 픽셀이 남으면 실패입니다
# 다른 무드의 승인된 수정본·비교 이미지. 2026-10-31에 sha256sum으로 기록했습니다. MODERN 편집 전(edit_modern 시작)과
# 실행 뒤(check_other_moods를 따로 호출)에 이 값과 같은지 확인합니다. 승인을 받아 이 파일들을 다시 만들면 값도 바꿔야 합니다.
MODERN_OTHER_OUTPUTS_SHA256 = {
    "assets/moods/edit/pure.png": "66eb44311dd15da0357b5232e8b2e6a1487e079ef6575c82aa72a6519788dbc1",
    "assets/moods/edit/chic.png": "1bc88c2ab6da2a8edc867697b134bc2e6d80c23d2920f11eca1e0813e68529ca",  # CHIC v3 (2026-10-31)
    "assets/moods/edit/nude.png": "811550b0c415e894057c4e99470a1ad55a81787a8f26e0182168460b8ce2f103",  # NUDE v2 (2026-10-31)
    "docs/reference/preview/pure-compare.png": "b5a9336835c8d6a4da267da94fc95ebe8ddedbc957a6cb984e68563e6275988f",
    "docs/reference/preview/pure-diff.png": "06d1c99b063f93ab135b00ce4ed1335c5a7d683c3c8dcfe9f2734564e8e87ac5",
    "docs/reference/preview/chic-compare.png": "debadaf4f688c59f901b04db652b19db5c1528c75ab186b88f03357ee0d43b52",
    "docs/reference/preview/chic-diff.png": "01ffbd477ed5fd40b3c773f01fa1628c492b84a325feef8525e487fb7ac712ae",
    "docs/reference/preview/nude-compare.png": "dc4fa71c6bd6e50921ebab8da4e486cf93cf68833fce6b5165a337eb72cfa398",
    "docs/reference/preview/nude-diff.png": "97b088a5a6ca0c6bdd1b9f91064219fc26f9bd07c85175feaa896db0c493abf0",
    # LOVELY (2026-10-31 실행 결과)
    "assets/moods/edit/lovely.png": "4ee857ef45e6910ae78a142659221bcfad3887e8eb7cb5e330bde24fefe91401",  # LOVELY 최종(글로이 A)
    "docs/reference/preview/lovely-compare.png": "5e3fd680461be087aec8d9593fca75313b457606b8cd17626563f841d5093cde",
    "docs/reference/preview/lovely-diff.png": "bb8115253897eac73d269d1041e5b4636f21e6aede04325f23a4f7b851488960",
}

# CHIC v2: 버전 1(2026-10-27, edit_chic 결과)에서 늘린 꼬리 끝만 약 1px 짧게 합니다. 렌즈·라인 색·두께는 버전 1 그대로입니다.
# 버전 1은 edit_chic(원본)으로 메모리에서 다시 만들고, 백업 파일과 픽셀이 같은지 확인한 뒤에 씁니다.
CHIC_V1_BACKUP = PREVIEW_DIR / "versions" / "chic-v1.png"
CHIC_V1_SHA256 = "40e42556f6b0a770d913393b0201f2f808cca6ba15be5e716d09c31192b42893"
# 2026-10-31 측정: 버전 1이 원본과 다른 픽셀 618개 = 렌즈 595개(원 안 579 + 부드러운 테두리 16) + 늘린 꼬리 23개.
CHIC_V1_CHANGED_COUNT = 618
CHIC_V1_WING_PIXELS = frozenset([
    (1, 75), (2, 75), (2, 76), (2, 77), (3, 76), (3, 77), (3, 78), (3, 79), (4, 77), (4, 78), (5, 78),
    (193, 78), (194, 78), (194, 79), (195, 77), (195, 78), (195, 79), (195, 80), (196, 76), (196, 77), (196, 78),
    (197, 76), (197, 77),
])
# 꼬리 픽셀이 원래 꼬리 끝(CHIC_WINGS의 끝점)에서 꼬리 방향으로 나간 거리(px)가 이 구간이면 원본 RGB 쪽으로 되돌립니다.
# 1.0 이하는 버전 1 그대로, 2.0 이상은 원본 그대로. 예상 변경 7개: 왼쪽 (1,75), (2,75), (2,76)
# 오른쪽 (197,76), (196,76), (197,77), (196,77) (손계산, 실행 확인 전)
CHIC_V2_TRIM = (1.0, 2.0)
CHIC_LENGTH_MIN_DARK = 20  # 원본보다 이만큼 이상 어두운 꼬리 픽셀까지를 꼬리 길이로 봅니다

# LOVELY: 2026-10-31에 원본(lovely.png)을 측정해 정했습니다. 다른 무드 값과 다릅니다.
# 렌즈: 홍채 y 97~107 행의 좌우 끝 가운데가 x 47.0~48.0 / 148.0~148.5이고, 행별 폭을 원에 맞추면 중심 y 95.8 / 96.4, 반지름 12.2입니다.
# 왼쪽 가운데가 픽셀 사이(47.5)라 소수 중심을 씁니다. 픽셀 중심이 원 안인 픽셀만 넣습니다.
LOVELY_IRISES = [(47.5, 96.0), (148.5, 96.0)]
LOVELY_IRIS_RADIUS = 12
LOVELY_IRIS_BOTTOM = 107  # y 107까지 홍채(밝기 58~114), y 108부터 아래 눈꺼풀 피부
# 열(x)마다 윗눈꺼풀 선의 맨 아래 줄(y). 밝기 36 이하인 첫 어두운 띠의 끝 줄로 측정했습니다.
# 띠가 동공·안쪽 눈꼬리와 이어진 열(44~48, 52~53, 57~59, 144~146, 150)은 사실상 통째로 바꾸지 않습니다.
# 표에 없는 홍채 테두리 열(x 36, 160)은 통째로 바꾸지 않습니다.
LOVELY_LID_BOTTOM_LEFT = {
    37: 92, 38: 92, 39: 92, 40: 92, 41: 92, 42: 92, 43: 92, 44: 96, 45: 97, 46: 98, 47: 98, 48: 99, 49: 90,
    50: 90, 51: 91, 52: 98, 53: 98, 54: 96, 55: 95, 56: 96, 57: 97, 58: 100, 59: 99,
}
LOVELY_LID_BOTTOM_RIGHT = {
    137: 97, 138: 97, 139: 96, 140: 95, 141: 94, 142: 93, 143: 93, 144: 98, 145: 99, 146: 99, 147: 90, 148: 90,
    149: 90, 150: 98, 151: 91, 152: 90, 153: 90, 154: 91, 155: 91, 156: 91, 157: 91, 158: 90, 159: 90,
}
LOVELY_LID_BOTTOM = {**LOVELY_LID_BOTTOM_LEFT, **LOVELY_LID_BOTTOM_RIGHT}
LOVELY_SAT = (0.16, 0.22)  # 홍채 채도 0.24~0.35(5~95%). 0.16 미만은 바꾸지 않고 0.16~0.22는 비율만큼 덜 바꿉니다
LOVELY_LENS = (0x7B, 0x4A, 0x3A)  # 장밋빛 웜 브라운 #7B4A3A (시작값). 밝기는 그대로 둡니다
LOVELY_LENS_STRENGTH = 0.4  # 원래 홍채의 따뜻한 색을 60% 남기고 붉은 기만 더합니다 (손계산, 실행 확인 전)
# 동공: 밝기 36 이하로 이어진 영역의 행별 x 범위. 가장 어두운 곳 (49,94) 밝기 13, (148,94) 19입니다.
LOVELY_PUPIL_ROWS = {
    92: (43, 55), 93: (44, 55), 94: (44, 55), 95: (44, 55), 96: (44, 54), 97: (45, 53), 98: (46, 53), 99: (48, 51),
}
LOVELY_PUPIL_ROWS_RIGHT = {
    93: (142, 151), 94: (144, 151), 95: (144, 152), 96: (144, 152), 97: (144, 150), 98: (144, 150), 99: (145, 148),
}
LOVELY_PUPILS = ([(x, y) for y, (a, b) in LOVELY_PUPIL_ROWS.items() for x in range(a, b + 1)]
                 + [(x, y) for y, (a, b) in LOVELY_PUPIL_ROWS_RIGHT.items() for x in range(a, b + 1)])
# 큰 반사광과 회색 둘레. 왼쪽 (49,92) #DCD8D9, (50,92) #EDE7E4, 둘레 (49~50, 91/93) 밝기 86~110·채도 0.02~0.07.
# 오른쪽 (147,92) #C8C6C8, (148,92) #FBF9F7, 둘레 (147~148, 91/93), (149, 91~92). 작은 반사광은 없습니다(밝은 곳은 채도가 홍채와 같음).
LOVELY_HIGHLIGHTS = ([(x, y) for y in (91, 92, 93) for x in (49, 50)]
                     + [(x, y) for y in (91, 92, 93) for x in (147, 148)] + [(149, 91), (149, 92)])
LOVELY_LENS_KEEP = frozenset(LOVELY_PUPILS + LOVELY_HIGHLIGHTS)
LOVELY_LID_PIXELS = frozenset((x, y) for x, lid in LOVELY_LID_BOTTOM.items() for y in range(84, lid + 1))

# LOVELY: 아이라인. 원래 꼬리는 눈꼬리(흰자 끝 왼쪽 x 26, 오른쪽 x 170)에서 약 12° 아래로 내려가
# (10,92) #513330 / (187,92) #462D28에서 끝나고, 맨 끝 (8~9, 91) / (188~189, 91~92)에 1px 올라가는 삐침이 있습니다.
# 1) 색 바꾸기: 상자 안의 밝기 70 이하(라인) 픽셀만 #5A4033 쪽으로. 위쪽 섀도(밝기 72~130)는 그대로 둡니다.
#    dark: 밝기가 이 값에서 0 → 이 값에서 1. ramp: 이 x에서 0 → 이 x에서 1 (홍채 원·윗눈꺼풀 선 표 밖에서 시작).
#    y 94 이상은 아래 눈매 선과 붙어 있어 넣지 않습니다.
LOVELY_RECOLOR = [{"box": (10, 87, 35, 93), "ramp": (35, 29)}, {"box": (161, 87, 187, 93), "ramp": (161, 167)}]
LOVELY_LINER_DARK = (70, 45)
LOVELY_LINER = (0x5A, 0x40, 0x33)  # 브라운 #5A4033 (design.md 10절 시작값)
LOVELY_LINER_LIFT = 0.3  # 가장 진한 부분(약 30)이 약 42가 됩니다 (손계산, 실행 확인 전)
# 2) 짧고 둥글게: keep이 이 x에서 0(지움) → 이 x에서 1(유지). 끝이 왼쪽 약 x 12~13, 오른쪽 약 x 184~185로 2~3px 짧아집니다.
#    피부 추정값은 위 y 89와 아래 y 94를 세로로 섞습니다. 두 줄 모두 라인이 지나지 않습니다.
#    (왼쪽 x 8~12: y 89 밝기 140~109, y 94 144~110 / 오른쪽 x 185~190: y 89 108~146, y 94 102~155)
#    x 13 / 184는 y 94가 아래 눈매 선 가장자리(86 / 75)라 피부 추정값이 낮게 나와 덜 지워집니다 (keep도 0.67).
LOVELY_TRIMS = [
    {"box": (8, 90, 13, 93), "keep": (11, 14), "skin_rows": (89, 94)},
    {"box": (184, 90, 190, 93), "keep": (186, 183), "skin_rows": (89, 94)},
]
# 검사 기준
LOVELY_LOWER_LASH = frozenset((x, y) for y in range(94, SIZE[1]) for x in [*range(8, 26), *range(172, 191)])
LOVELY_SHADOW_AREA = [(x, y) for y in range(81, 94) for x in [*range(8, 36), *range(161, 191)]]
LOVELY_SHADOW_MIN_Y = 70  # 원본 밝기가 이 값보다 밝은 섀도·피부 픽셀은 꼬리 지우기 상자 밖에서 원본과 같아야 합니다
# 흰자(밝기 95 이상, 채도 0.17 미만으로 이어진 영역)의 행별 x 범위
LOVELY_WHITES_ROWS = {
    92: [(30, 35), (162, 164)], 93: [(28, 35), (162, 165)], 94: [(27, 35), (162, 167)], 95: [(27, 35), (162, 169)],
    96: [(26, 35), (162, 170)], 97: [(27, 35), (162, 170)], 98: [(27, 35), (161, 169)], 99: [(28, 35), (161, 169)],
    100: [(28, 35), (161, 168)], 101: [(29, 35), (161, 167)], 102: [(30, 35), (161, 166)], 103: [(31, 35), (161, 165)],
    104: [(32, 35), (161, 164)], 105: [(33, 35), (161, 163)], 106: [(35, 35), (161, 161)],
}
LOVELY_WHITES = frozenset((x, y) for y, spans in LOVELY_WHITES_ROWS.items() for a, b in spans for x in range(a, b + 1))
LOVELY_TRIMMED_COLUMNS = [range(8, 12), range(186, 191)]  # keep이 0인 열: 피부보다 20 이상 어두운 픽셀이 남으면 실패
LOVELY_TAIL_END_COLUMNS = (13, 184)  # 남은 꼬리 끝 열: 피부보다 30 이상 어두운 픽셀이 있어야 합니다 (너무 많이 지우지 않았는지)
# 방향: (안쪽 열 범위, 바깥쪽 열 범위)의 열별 가장 어두운 줄(y 87~95) 평균. 바깥쪽이 1~4줄 아래여야 합니다 (살짝 아래로).
# 원본: 왼쪽 안쪽 x 21~25 평균 91.4, 바깥쪽 x 13~17 93.0 / 오른쪽 안쪽 x 165~169 90.0, 바깥쪽 x 179~183 93.2
LOVELY_DIRECTION = [((21, 26), (13, 18)), ((165, 170), (179, 184))]

# LOVELY·CHIC 작업 중 바뀌면 안 되는 결과물과 백업. 2026-10-31에 sha256sum으로 기록했습니다.
# edit_chic_v2·edit_lovely 시작 시와, 실행 뒤 check_recorded_outputs를 따로 호출해 확인합니다.
SESSION_PROTECTED_SHA256 = {
    "assets/moods/edit/pure.png": "66eb44311dd15da0357b5232e8b2e6a1487e079ef6575c82aa72a6519788dbc1",
    "assets/moods/edit/nude.png": "811550b0c415e894057c4e99470a1ad55a81787a8f26e0182168460b8ce2f103",  # NUDE v2 (2026-10-31)
    "assets/moods/edit/modern.png": "29c272baed00baf88c22eccca29dbbe270e3cbf72cd7d875e6d5d78482acf632",
    "docs/reference/preview/pure-compare.png": "b5a9336835c8d6a4da267da94fc95ebe8ddedbc957a6cb984e68563e6275988f",
    "docs/reference/preview/pure-diff.png": "06d1c99b063f93ab135b00ce4ed1335c5a7d683c3c8dcfe9f2734564e8e87ac5",
    "docs/reference/preview/nude-compare.png": "dc4fa71c6bd6e50921ebab8da4e486cf93cf68833fce6b5165a337eb72cfa398",
    "docs/reference/preview/nude-diff.png": "97b088a5a6ca0c6bdd1b9f91064219fc26f9bd07c85175feaa896db0c493abf0",
    "docs/reference/preview/modern-compare.png": "337ec3929eda03cd853ed5773c0e7131a01d6317d75395b7b2eb3d17424c4b5b",
    "docs/reference/preview/modern-diff.png": "6ad76c90a01b029242bb3dc42f686e933500101cf44daee61836d44d474cb128",
    "docs/reference/preview/versions/modern-v1.png": "b3e81ad2639b5994230e59bd3b92794c5153bb8ddacd7b72c5718142de151fe1",
    "docs/reference/preview/versions/modern-v1-compare.png": "4229bcc4fd7228710007620306909d38b402e8acb66779b1e2a83f5ffce1d828",
    "docs/reference/preview/versions/modern-v1-diff.png": "dc3e4f08a824ddc4e05f2b2ab4f2e4c23a8738f00f6ea6527d80b1b97bef7d25",
    "docs/reference/preview/versions/chic-v1.png": "40e42556f6b0a770d913393b0201f2f808cca6ba15be5e716d09c31192b42893",
    "docs/reference/preview/versions/chic-v1-compare.png": "ae60824b428ff41f886ca247ee2b57d58d50667e631f0fcec3030a7d834780c4",
    "docs/reference/preview/versions/chic-v1-diff.png": "8413a0035363e1d3f2b09d72d5b8059a07d52ed82abcdbf645819d8b83f0c373",
    # CHIC 결과물 (2026-10-31 v3 실행 결과)
    "assets/moods/edit/chic.png": "1bc88c2ab6da2a8edc867697b134bc2e6d80c23d2920f11eca1e0813e68529ca",  # CHIC v3
    "docs/reference/preview/chic-compare.png": "debadaf4f688c59f901b04db652b19db5c1528c75ab186b88f03357ee0d43b52",
    "docs/reference/preview/chic-diff.png": "01ffbd477ed5fd40b3c773f01fa1628c492b84a325feef8525e487fb7ac712ae",
    # LOVELY 결과물 (2026-10-31 실행 결과)
    "assets/moods/edit/lovely.png": "4ee857ef45e6910ae78a142659221bcfad3887e8eb7cb5e330bde24fefe91401",  # LOVELY 최종(글로이 A)
    "docs/reference/preview/lovely-compare.png": "5e3fd680461be087aec8d9593fca75313b457606b8cd17626563f841d5093cde",
    "docs/reference/preview/lovely-diff.png": "bb8115253897eac73d269d1041e5b4636f21e6aede04325f23a4f7b851488960",
    # NUDE v1 백업 (2026-10-31)
    "docs/reference/preview/versions/nude-v1.png": "b0cdd363c4b98d7ae6f4556352d7c4ecb72c3383d0ed05c7e5e3104219015471",
    "docs/reference/preview/versions/nude-v1-compare.png": "3e666eede5dec60f9894b3723ca67213c1e6dbe0ffa19d6b7b4f65bcf4ab7cd5",
    "docs/reference/preview/versions/nude-v1-diff.png": "72b41b72a708e003ada6fa51e8c1866279504ec6ec3cc2b6603a3983b5abec0e",
    # CHIC v2 백업과 v2→v3 비교 이미지 (2026-10-31)
    "docs/reference/preview/versions/chic-v2.png": "cbcb5a2bd3de4b443ca09efa6090881237832a20198d70c10d4f0b285775ef2f",
    "docs/reference/preview/versions/chic-v2-compare.png": "2bbc420fdf938514f967ad72858e28fb4a99842799b1b9aba1cfca45667c2f6a",
    "docs/reference/preview/versions/chic-v2-diff.png": "79b0ae1f850f04fccdbccd6d8a61a9eaeb78f4900a44ea6d74a0888b57ceaffd",
    "docs/reference/preview/chic-v3-vs-v2-compare.png": "2fceb0fde21ef25f92f668154f62b8b6b2d082f3f2028922d8648772e7ebcdc5",
    "docs/reference/preview/chic-v3-vs-v2-diff.png": "778f4e55ba4dc75c08081bd63755d95ec95d256c470212edcac27cb57202de6d",
    # LOVELY 버전 1(0.4) 백업, 0.6 후보, 글로이 A·B 후보와 비교 이미지 (2026-10-31)
    "docs/reference/preview/versions/lovely-v1.png": "95315109d434d02750fb9c2a2db164895e9ba3cfa61d09a0ec2a187d97296958",
    "docs/reference/preview/versions/lovely-v1-compare.png": "dcde6d59711a005df8c90a6e5e2d87a5aad3091477e8883937b84f7f60d6868b",
    "docs/reference/preview/versions/lovely-v1-diff.png": "e1bee06529b0209157d5b2bd3e0ad0211c11cd95e6f98454bbdb28c357d43a9b",
    "docs/reference/preview/lovely-lens06.png": "b18f41fdf371b0a03b700def3229eecdee6bd518a21abe8ab456559d2a9e7576",
    "docs/reference/preview/lovely-lens06-vs-04-compare.png": "52699177f17baaa84994bd5b07547e1abf75e6d2a7690848a6f26c2eb3d99aff",
    "docs/reference/preview/lovely-lens06-vs-04-diff.png": "d2e40730dfd1976206aca3095a6cc76fdbaf3200949a43ca63462c83cce1b5bf",
    "docs/reference/preview/lovely-glowyA.png": "4ee857ef45e6910ae78a142659221bcfad3887e8eb7cb5e330bde24fefe91401",
    "docs/reference/preview/lovely-glowyB.png": "b31a3c4ae625a81ae670bee36468819ff056f4eecb09e3dca22dcecf7f360e22",
    "docs/reference/preview/lovely-glowyAB-compare.png": "77796cede667a753a1751d8cb2cead20573b9bd126bf6ad3934d5130dd49dd48",
    "docs/reference/preview/lovely-glowyAB-diff.png": "9f3c9098ae227b1a4864fb26e668071571c93384f8c6a956b312547d2d716425",
}

# NUDE v2: 버전 1(2026-10-29, edit_nude 결과)에서 짧게 줄였던 꼬리 끝만 원본 길이로 되돌립니다.
# 렌즈와 웜 브라운 라인 색은 버전 1 그대로입니다. 버전 1은 edit_nude(원본)으로 메모리에서 다시 만들고 백업과 픽셀이 같은지 확인합니다.
NUDE_V1_BACKUP = PREVIEW_DIR / "versions" / "nude-v1.png"
NUDE_V1_SHA256 = "b0cdd363c4b98d7ae6f4556352d7c4ecb72c3383d0ed05c7e5e3104219015471"
# 2026-10-31 측정: 버전 1이 원본과 다른 픽셀 606개 = 렌즈 511개(x 36~160, y 89~106) + 꼬리 95개.
# 꼬리 95개 중 72개가 keep < 1(꼬리를 줄이려고 피부 쪽으로 채운 칸)이고, 23개는 색만 바뀐 칸(x 14~15 / 181~182)입니다.
NUDE_V1_CHANGED_COUNT = 606
_NUDE_TRIMMED_ROWS = {
    85: [7, 8, 11, 12, 13, 183, 184, 186, 187, 188, 191, 192],
    86: [7, 8, 9, 10, 11, 12, 13, 183, 184, 185, 186, 187, 189, 190, 191],
    87: [8, 9, 10, 11, 12, 13, 183, 184, 185, 186, 187, 188, 189, 190],
    88: [9, 10, 11, 12, 13, 183, 184, 185, 186, 187, 188, 189],
    89: [10, 11, 12, 13, 183, 184, 185, 186, 187, 188],
    90: [12, 13, 183, 184, 185, 186],
    91: [13, 183, 184],
}
NUDE_V1_TRIMMED_PIXELS = frozenset((x, y) for y, xs in _NUDE_TRIMMED_ROWS.items() for x in xs)  # 72개. v2에서 바뀔 수 있는 유일한 영역
# 꼬리를 줄이지 않은 restyle_tails 설정: keep만 상자 안 모든 열에서 1이 되게 바꿉니다 (왼쪽 x 4~15, 오른쪽 x 181~192).
# 색 바꾸기(recolor, 색·밝기 비율)는 NUDE_TAILS 그대로라, 되돌린 칸은 버전 1의 웜 브라운 처리 결과와 같은 방식으로 칠해집니다.
NUDE_TAILS_FULL = [{**tail, "keep": keep} for tail, keep in zip(NUDE_TAILS, [(3, 4), (193, 192)])]
NUDE_LENGTH_MIN_DARK = 20  # 피부 추정값보다 이만큼 이상 어두운 칸까지를 꼬리 길이로 봅니다
# 형태 검사: 72개 중 원본에서 라인(피부보다 NUDE_LENGTH_MIN_DARK 이상 어두움)인 칸은 45개이고, v2에서도 모두 라인이어야 합니다.
# 원본에서 라인이 아니던 칸이 v2에서 라인이 되는 것은 아래 4칸만 허용합니다 (2026-10-31 v2 실행 결과 확인 후 승인).
# 사유: 승인된 웜 브라운 처리(NUDE_LINER_LIFT)는 목표색 밝기(약 81)보다 밝은 주름 그늘 칸을 조금 어둡게 하므로,
#   기준선 바로 아래(원본 어두움 18.5~20.0)이던 칸이 20을 살짝 넘었습니다. 바뀐 폭은 밝기 2.7 이하, 채널값 5 이하입니다.
#   (8,85) 18.7→20.2, (183,87) 20.0(반올림 전 20 미만)→20.1, (186,87) 19.3→20.8, (188,89) 18.5→21.2
NUDE_SHAPE_LINE_COUNT = 45
NUDE_SHAPE_NEW_LINE_ALLOWED = frozenset([(8, 85), (183, 87), (186, 87), (188, 89)])
NUDE_SHAPE_BORDER_MIN_DARK = 18  # 허용 4칸도 원본에서 피부보다 이만큼 이상 어두웠던 경계 칸이어야 합니다
# NUDE 실행 중 바뀌면 안 되는 파일: 보호 목록에서 nude 결과물 3개(이번에 다시 만듦)를 빼고 NUDE v1 백업 3개를 더한 21개.
NUDE_RUN_PROTECTED_SHA256 = {
    **{rel: h for rel, h in SESSION_PROTECTED_SHA256.items() if not rel.startswith(("assets/moods/edit/nude", "docs/reference/preview/nude-"))},
    "docs/reference/preview/versions/nude-v1.png": "b0cdd363c4b98d7ae6f4556352d7c4ecb72c3383d0ed05c7e5e3104219015471",
    "docs/reference/preview/versions/nude-v1-compare.png": "3e666eede5dec60f9894b3723ca67213c1e6dbe0ffa19d6b7b4f65bcf4ab7cd5",
    "docs/reference/preview/versions/nude-v1-diff.png": "72b41b72a708e003ada6fa51e8c1866279504ec6ec3cc2b6603a3983b5abec0e",
}

# CHIC v3: v2보다 꼬리를 약 0.5~1px 더 짧게 합니다. 계산식은 v2와 같고(버전 1의 늘린 꼬리 23개를 원본 쪽으로 되돌림) 구간만 당깁니다.
# 렌즈·라인 색·두께·방향과 가장 진한 꼬리 끝((3,77), (195,78))은 그대로입니다.
CHIC_V2_BACKUP = PREVIEW_DIR / "versions" / "chic-v2.png"
CHIC_V2_SHA256 = "cbcb5a2bd3de4b443ca09efa6090881237832a20198d70c10d4f0b285775ef2f"
CHIC_V3_TRIM = (0.5, 1.5)
# 2026-10-31 계산(v2 재현 확인 후): v2 대비 바뀌는 픽셀 6개. 밝기 v2→v3 (원본 쪽 비율)
#   (2,77) 128→130 (0.10), (3,76) 90→106 (0.30), (2,76) 94→143 (0.90),
#   (195,77) 137→144 (0.21), (196,78) 125→135 (0.21), (196,77) 102→163 (0.91)
# 꼬리 길이(원래 끝 기준, 원본보다 20 이상 어두운 가장 먼 픽셀): 왼쪽 1.40→0.80, 오른쪽 1.41→0.71
CHIC_V3_CHANGED_PIXELS = frozenset([(2, 77), (3, 76), (2, 76), (195, 77), (196, 78), (196, 77)])
CHIC_V3_SHORTEN = (0.5, 1.0)  # 양쪽 모두 v2보다 이 범위(px)만큼 짧아져야 합니다
# CHIC v3 실행 중 바뀌면 안 되는 파일: 보호 목록에서 chic 결과물 3개(이번에 다시 만듦)를 빼고 CHIC v2 백업 3개를 더한 24개.
_CHIC_OUTPUTS = ("assets/moods/edit/chic.png", "docs/reference/preview/chic-compare.png", "docs/reference/preview/chic-diff.png")
CHIC_V3_RUN_PROTECTED_SHA256 = {
    **{rel: h for rel, h in SESSION_PROTECTED_SHA256.items() if rel not in _CHIC_OUTPUTS},
    "docs/reference/preview/versions/chic-v2.png": "cbcb5a2bd3de4b443ca09efa6090881237832a20198d70c10d4f0b285775ef2f",
    "docs/reference/preview/versions/chic-v2-compare.png": "2bbc420fdf938514f967ad72858e28fb4a99842799b1b9aba1cfca45667c2f6a",
    "docs/reference/preview/versions/chic-v2-diff.png": "79b0ae1f850f04fccdbccd6d8a61a9eaeb78f4900a44ea6d74a0888b57ceaffd",
}
# v2→v3 확대 비교 이미지 (실행 뒤 make_chic_v3_vs_v2_previews로 따로 만듭니다. 이미 있으면 만들지 않음)
CHIC_V3_PAIR_PREVIEWS = (PREVIEW_DIR / "chic-v3-vs-v2-compare.png", PREVIEW_DIR / "chic-v3-vs-v2-diff.png")

# LOVELY 렌즈 강도 비교 (2026-10-31): 현재 결과물(LOVELY_LENS_STRENGTH 0.4)은 그대로 두고, 0.6을 적용한 후보를 별도 파일로 만듭니다.
# 후보는 assets/moods/edit/에 두지 않습니다 (사이트에 섞이지 않게). 최종 교체는 승인 후 따로 합니다.
LOVELY_CANDIDATE_STRENGTH = 0.6
LOVELY_CURRENT_SHA256 = {
    "assets/moods/edit/lovely.png": "95315109d434d02750fb9c2a2db164895e9ba3cfa61d09a0ec2a187d97296958",
    "docs/reference/preview/lovely-compare.png": "dcde6d59711a005df8c90a6e5e2d87a5aad3091477e8883937b84f7f60d6868b",
    "docs/reference/preview/lovely-diff.png": "e1bee06529b0209157d5b2bd3e0ad0211c11cd95e6f98454bbdb28c357d43a9b",
}
LOVELY_CANDIDATE_FILES = (PREVIEW_DIR / "lovely-lens06.png", PREVIEW_DIR / "lovely-lens06-vs-04-compare.png",
                          PREVIEW_DIR / "lovely-lens06-vs-04-diff.png")
LOVELY_CANDIDATE_SHA256 = {  # 0.6 후보 (2026-10-31 생성). 글로이 후보를 만드는 동안 바뀌면 안 됩니다
    "docs/reference/preview/lovely-lens06.png": "b18f41fdf371b0a03b700def3229eecdee6bd518a21abe8ab456559d2a9e7576",
    "docs/reference/preview/lovely-lens06-vs-04-compare.png": "52699177f17baaa84994bd5b07547e1abf75e6d2a7690848a6f26c2eb3d99aff",
    "docs/reference/preview/lovely-lens06-vs-04-diff.png": "d2e40730dfd1976206aca3095a6cc76fdbaf3200949a43ca63462c83cce1b5bf",
}

# LOVELY 글로이 블랙 브라운 후보 (2026-10-31 설계). 원본에서 만들고, 마스크·보호 조건·아이라인은 현재 0.4와 같습니다.
# 다른 무드 렌즈(홍채 y 97~106, 밝기 35~130 중앙값): PURE·LOVELY 원본 밝기 73·채도 0.29·색상각 123°, NUDE v2 82·0.36·139°,
# MODERN 76·0.12·128°. 색상각은 Cr/Cb 각도로, 클수록 노란빛·작을수록 붉은빛입니다. 새 후보는 밝기를 크게 낮추고(약 47~58)
# 색상각은 중간(126~130°), 채도는 MODERN보다 높게(0.2 이상) 둡니다.
# target: 색 방향(밝기에 맞춰 크기 조절), strength: 색을 옮기는 비율.
# gain: 원래 밝기가 gain_luma[0] 이하인 결은 gain[0]배, gain_luma[1] 이상인 밝은 결은 gain[1]배 (사이는 직선). 밝은 결을 덜 어둡게 해서
#   전체는 블랙에 가깝고 빛 받는 결은 브라운으로 남게 합니다 (글로이 효과).
# ring: 홍채 중심에서 거리 ring[0]~ring[1]px 사이에서 외곽 링 배율 ring[2]까지 더 어둡게 합니다.
# check: 바뀐 픽셀의 (밝기 중앙값 범위, 채도 중앙값 최소, 색상각 중앙값 범위). 예상값은 손계산입니다(실행 확인 전).
LOVELY_GLOWY_CANDIDATES = {
    "A": {"name": "글로이 블랙 브라운", "target": (0x3A, 0x2C, 0x25), "strength": 0.8, "gain": (0.62, 0.82),
          "ring": (9.5, 11.5, 0.90), "check": ((40, 55), 0.18, (120, 135))},  # 예상: 밝기 약 47, 채도 약 0.22, 126°
    "B": {"name": "글로이 에스프레소", "target": (0x4C, 0x35, 0x28), "strength": 0.7, "gain": (0.72, 0.90),
          "ring": (9.5, 11.5, 0.92), "check": ((48, 62), 0.22, (120, 135))},  # 예상: 밝기 약 54, 채도 약 0.28, 126°
}
LOVELY_GLOWY_GAIN_LUMA = (45, 95)
LOVELY_GLOWY_FLOOR = 34  # 바뀐 밝기가 min(원래 밝기, 이 값)보다 낮아지지 않게 해서 동공(밝기 24 이하)과 뭉치지 않게 합니다
LOVELY_GLOWY_FILES = {"A": PREVIEW_DIR / "lovely-glowyA.png", "B": PREVIEW_DIR / "lovely-glowyB.png",
                      "compare": PREVIEW_DIR / "lovely-glowyAB-compare.png", "diff": PREVIEW_DIR / "lovely-glowyAB-diff.png"}
# 비교 이미지 참고 줄에 넣을 다른 무드 렌즈 (수정본 파일, 홍채 중심)
# LOVELY 최종 (2026-10-31 결정): 렌즈는 글로이 A, 아이라인은 버전 1(0.4) 그대로. 버전 1은 versions/lovely-v1*.png로 백업했습니다.
LOVELY_FINAL_GLOWY = "A"
LOVELY_GLOWY_A_SHA256 = "4ee857ef45e6910ae78a142659221bcfad3887e8eb7cb5e330bde24fefe91401"  # lovely-glowyA.png (승인한 후보)
LOVELY_V1_BACKUP = PREVIEW_DIR / "versions" / "lovely-v1.png"
LOVELY_V1_SHA256 = "95315109d434d02750fb9c2a2db164895e9ba3cfa61d09a0ec2a187d97296958"
_LOVELY_OUTPUTS = ("assets/moods/edit/lovely.png", "docs/reference/preview/lovely-compare.png", "docs/reference/preview/lovely-diff.png")
_LOVELY_V1_BACKUPS = {
    "docs/reference/preview/versions/lovely-v1.png": "95315109d434d02750fb9c2a2db164895e9ba3cfa61d09a0ec2a187d97296958",
    "docs/reference/preview/versions/lovely-v1-compare.png": "dcde6d59711a005df8c90a6e5e2d87a5aad3091477e8883937b84f7f60d6868b",
    "docs/reference/preview/versions/lovely-v1-diff.png": "e1bee06529b0209157d5b2bd3e0ad0211c11cd95e6f98454bbdb28c357d43a9b",
}
_LOVELY_GLOWY_SHA256 = {
    "docs/reference/preview/lovely-glowyA.png": "4ee857ef45e6910ae78a142659221bcfad3887e8eb7cb5e330bde24fefe91401",
    "docs/reference/preview/lovely-glowyB.png": "b31a3c4ae625a81ae670bee36468819ff056f4eecb09e3dca22dcecf7f360e22",
    "docs/reference/preview/lovely-glowyAB-compare.png": "77796cede667a753a1751d8cb2cead20573b9bd126bf6ad3934d5130dd49dd48",
    "docs/reference/preview/lovely-glowyAB-diff.png": "9f3c9098ae227b1a4864fb26e668071571c93384f8c6a956b312547d2d716425",
}
# LOVELY 최종 실행 중 바뀌면 안 되는 파일: 보호 목록에서 lovely 결과물 3개(이번에 다시 만듦)를 빼고,
# LOVELY v1 백업 3개, 0.6 후보 3개, 글로이 후보 4개를 더한 36개.
LOVELY_FINAL_RUN_PROTECTED_SHA256 = {
    **{rel: h for rel, h in SESSION_PROTECTED_SHA256.items() if rel not in _LOVELY_OUTPUTS},
    **_LOVELY_V1_BACKUPS, **LOVELY_CANDIDATE_SHA256, **_LOVELY_GLOWY_SHA256,
}
LOVELY_GLOWY_REFERENCES = [("PURE", OUT_DIR / "pure.png", (48, 96)), ("NUDE", OUT_DIR / "nude.png", (48, 96)),
                           ("MODERN", OUT_DIR / "modern.png", (49, 96))]


def luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def to_ycc(c):
    r, g, b = c
    return (luma(c),
            -0.168736 * r - 0.331264 * g + 0.5 * b,
            0.5 * r - 0.418688 * g - 0.081312 * b)


def from_ycc(y, cb, cr):
    rgb = (y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb)
    return tuple(max(0, min(255, round(v))) for v in rgb)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def saturation(c):
    """밝기에 대한 색 진하기 비율. 회색(흰자, 반사광)은 0에 가깝습니다."""
    y, cb, cr = to_ycc(c)
    return math.hypot(cb, cr) / max(y, 1)


def ramp(x, at0, at1):
    """x가 at0이면 0, at1이면 1, 사이는 직선으로 잇습니다 (at0 > at1도 됩니다)."""
    return min(1, max(0, (x - at0) / (at1 - at0)))


def drawn_mask(draw_fn):
    """4배 크기로 그린 도형을 원래 크기로 줄여 가장자리가 부드러운 마스크를 만듭니다."""
    big = Image.new("L", (SIZE[0] * SCALE, SIZE[1] * SCALE), 0)
    draw_fn(ImageDraw.Draw(big), SCALE)
    return big.resize(SIZE, Image.Resampling.BOX)


def erase_tails(img, tails):
    """꼬리 영역을 위아래 피부 색 사이 값으로 채웁니다. 원래 피부보다 어두운 픽셀만 바꿉니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    mask = drawn_mask(lambda d, s: [d.rectangle([(l - 0.5) * s, (t - 0.5) * s, (r + 1.5) * s, (b + 1.5) * s], fill=255)
                                    for l, t, r, b in tails])
    m = mask.load()
    for l, t, r, b in tails:
        above, below = t - 2, b + 2  # 꼬리에 닿지 않은 피부 줄
        for y in range(t - 1, b + 2):
            frac = min(1, max(0, (y - above) / (below - above)))
            for x in range(l - 1, r + 2):
                w = m[x, y] / 255
                if not w:
                    continue
                skin = lerp(src[x, above], src[x, below], frac)
                dark = min(1, max(0, (luma(skin) - luma(src[x, y])) / 30))
                if dark:
                    dst[x, y] = lerp(src[x, y], skin, w * dark)
    return out, mask


def tone_weight(y):
    """동공·윗라인(어두움)과 반사광·흰자(밝음)는 0, 홍채 중간 밝기는 1."""
    if y <= PUPIL_MAX_Y or y >= HIGHLIGHT_MIN_Y:
        return 0
    if y < PUPIL_MAX_Y + 16:
        return (y - PUPIL_MAX_Y) / 16
    if y > HIGHLIGHT_MIN_Y - 30:
        return (HIGHLIGHT_MIN_Y - y) / 30
    return 1


def iris_protected(src, x, y):
    """홍채 마스크에서 빼야 하는 픽셀: 윗눈꺼풀 선과 그 위, 동공·윗라인(어두움), 반사광·흰자(밝음)."""
    lid = LID_BOTTOM.get(x)
    if lid is None or y <= lid:
        return True
    py = luma(src[x, y])
    return py <= PUPIL_MAX_Y or py >= HIGHLIGHT_MIN_Y


def iris_mask(img, centers):
    """홍채 원 마스크에서 보호 픽셀을 0으로 만들고, 아래 속눈썹 쪽은 서서히 0으로 줄입니다."""
    src = img.load()
    r = IRIS_RADIUS
    mask = drawn_mask(lambda d, s: [d.ellipse([(cx + 0.5 - r) * s, (cy + 0.5 - r) * s, (cx + 0.5 + r) * s, (cy + 0.5 + r) * s], fill=255)
                                    for cx, cy in centers])
    m = mask.load()
    for y in range(SIZE[1]):
        fade = 1 if y <= IRIS_BOTTOM else max(0, 1 - (y - IRIS_BOTTOM) / 2)
        for x in range(SIZE[0]):
            if m[x, y]:
                m[x, y] = 0 if iris_protected(src, x, y) else round(m[x, y] * fade)
    return mask


def recolor_irises(img, centers, target):
    """밝기(Y)는 그대로 두고 색 성분(Cb, Cr)만 목표 색 쪽으로 옮깁니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    mask = iris_mask(img, centers)
    m = mask.load()
    ty, tcb, tcr = to_ycc(target)
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            w = m[x, y] / 255 * tone_weight(py)
            if w:
                cb = pcb + (tcb * py / ty - pcb) * w
                cr = pcr + (tcr * py / ty - pcr) * w
                dst[x, y] = from_ycc(py, cb, cr)
    return out, mask


def nude_lens_protected(src, x, y):
    """NUDE 렌즈에서 빼는 픽셀: 측정한 보호 좌표, 윗눈꺼풀 선과 그 위, 동공·반사광·흰자(밝기), 회색 픽셀(채도)."""
    if (x, y) in NUDE_LENS_KEEP:
        return True
    lid = NUDE_LID_BOTTOM.get(x)
    if lid is None or y <= lid:
        return True
    py = luma(src[x, y])
    if py <= PUPIL_MAX_Y or py >= HIGHLIGHT_MIN_Y:
        return True
    return saturation(src[x, y]) < NUDE_SAT[0]


def nude_lens_masks(img):
    """(원 마스크, 렌즈 마스크)를 돌려줍니다. 원 마스크는 픽셀 중심이 원 안인 픽셀 전체(겹침 검사용),
    렌즈 마스크는 그중 보호 픽셀을 뺀 것입니다. 아래 경계는 IRIS_BOTTOM까지 100%, 다음 줄 절반, 그 아래 0입니다."""
    src = img.load()
    circle, lens = Image.new("L", SIZE, 0), Image.new("L", SIZE, 0)
    c, m = circle.load(), lens.load()
    r = NUDE_IRIS_RADIUS
    for cx, cy in NUDE_IRISES:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    continue
                c[x, y] = 255
                if y <= IRIS_BOTTOM + 1 and not nude_lens_protected(src, x, y):
                    m[x, y] = 255 if y <= IRIS_BOTTOM else 128
    return circle, lens


def recolor_nude_irises(img):
    """색 성분(Cb, Cr)을 카멜 브라운 쪽으로 옮기고 밝기(Y)를 최대 NUDE_LENS_GAIN배까지 올립니다.
    채도가 낮을수록(NUDE_SAT 구간) 덜 바꿔 동공·홍채 경계를 부드럽게 둡니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    circle, mask = nude_lens_masks(img)
    m = mask.load()
    ty, tcb, tcr = to_ycc(NUDE_LENS)
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            w = m[x, y] / 255 * tone_weight(py) * ramp(saturation(src[x, y]), *NUDE_SAT)
            if w:
                ny = py * (1 + (NUDE_LENS_GAIN - 1) * w)
                cb = pcb + (tcb * ny / ty - pcb) * w
                cr = pcr + (tcr * ny / ty - pcr) * w
                dst[x, y] = from_ycc(ny, cb, cr)
    return out, circle, mask


def check_unchanged(label, orig, edit, pixels):
    """좌표 목록의 RGB가 원본과 정확히 같은지 확인합니다. 마스크 계산과 따로, 픽셀 값만 비교합니다."""
    o, e = orig.load(), edit.load()
    moved = sorted((x, y) for x, y in pixels if o[x, y] != e[x, y])
    if moved:
        sys.exit(f"{label}: 보호 좌표 {len(moved)}개의 RGB가 원본과 다릅니다 (예: {moved[:5]}). 중단합니다.")
    return len(pixels)


def extend_wings(img, wings, color):
    """기존 꼬리 끝에서 같은 방향으로 끝이 가늘어지는 선을 덧그립니다. 원본보다 어두워지는 픽셀만 바꿉니다."""
    def draw(d, s):
        for (tx, ty), (dx, dy), length in wings:
            nx, ny = -dy, dx
            x0, y0 = tx - dx * 1.5, ty - dy * 1.5  # 기존 꼬리 안쪽에서 시작해 이음새를 숨깁니다
            x1, y1 = tx + dx * length, ty + dy * length
            w0, w1 = 0.8, 0.15  # 시작과 끝의 반폭
            pts = [(x0 + nx * w0, y0 + ny * w0), (x1 + nx * w1, y1 + ny * w1),
                   (x1 - nx * w1, y1 - ny * w1), (x0 - nx * w0, y0 - ny * w0)]
            d.polygon([((px + 0.5) * s, (py + 0.5) * s) for px, py in pts], fill=255)

    alpha = drawn_mask(draw)
    out = img.copy()
    src, dst, a = img.load(), out.load(), alpha.load()
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if a[x, y]:
                drawn = lerp(src[x, y], color, a[x, y] / 255)
                dst[x, y] = tuple(min(src[x, y][i], drawn[i]) for i in range(3))
    return out, alpha


def restyle_tails(img, tails, color, lift):
    """꼬리 라인을 웜 브라운으로 바꾸고 바깥쪽 끝을 지웁니다. 원래 라인의 명암(진한 가운데, 흐린 가장자리)을 그대로 살려
    색 성분은 color 쪽으로, 밝기는 color 밝기 쪽으로 lift 비율만큼만 옮깁니다. 바꾸는 정도는 라인이 덮은 정도(cover) ×
    recolor 비율이고, keep이 1보다 작은 곳은 그만큼 피부 추정값으로 채웁니다. 피부보다 어둡지 않은 픽셀은 바꾸지 않습니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(mask)
    ty, tcb, tcr = to_ycc(color)
    for tail in tails:
        l, t, r, b = tail["box"]
        draw.rectangle([l, t, r, b], fill=255)
        above, below = t - 1, b + 1  # 꼬리에 닿지 않은 피부 줄
        for y in range(t, b + 1):
            frac = (y - above) / (below - above)
            for x in range(l, r + 1):
                skin = src[x, above] if x in tail["skin_above_only"] else lerp(src[x, above], src[x, below], frac)
                span = luma(skin) - LINER_CORE_Y - TAIL_MIN_DARK
                if span <= 0:
                    continue
                cover = min(1, max(0, (luma(skin) - luma(src[x, y]) - TAIL_MIN_DARK) / span))
                if not cover:
                    continue
                w = cover * ramp(x, *tail["recolor"])
                py, pcb, pcr = to_ycc(src[x, y])
                ny = py + (ty - py) * lift * w
                colored = from_ycc(ny, pcb + (tcb * ny / ty - pcb) * w, pcr + (tcr * ny / ty - pcr) * w)
                dst[x, y] = lerp(colored, skin, 1 - ramp(x, *tail["keep"]))
    return out, mask


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def changed_pixels(a, b):
    """R, G, B 중 하나라도 다르면 255인 흑백 이미지. 흑백 변환 대신 채널별 최댓값을 써서 1 차이도 놓치지 않습니다."""
    r, g, b_ = ImageChops.difference(a, b).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b_).point(lambda v: 255 if v else 0)


def count_nonzero(gray):
    """흑백(L) 이미지에서 0이 아닌 픽셀 수."""
    return sum(gray.histogram()[1:])


def make_previews(name, orig, edit, mask):
    band = (0, 64, 201, 114)  # 두 눈이 들어가는 띠
    zoom = 6
    full = Image.new("RGB", (SIZE[0] * 4 + 8, SIZE[1] * 2), "white")
    full.paste(orig.resize((SIZE[0] * 2, SIZE[1] * 2), Image.Resampling.NEAREST), (0, 0))
    full.paste(edit.resize((SIZE[0] * 2, SIZE[1] * 2), Image.Resampling.NEAREST), (SIZE[0] * 2 + 8, 0))
    bw, bh = (band[2] - band[0]) * zoom, (band[3] - band[1]) * zoom
    compare = Image.new("RGB", (bw, full.height + bh * 2 + 24), "white")
    compare.paste(full, (0, 0))
    compare.paste(orig.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, full.height + 8))
    compare.paste(edit.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, full.height + bh + 16))
    compare.save(PREVIEW_DIR / f"{name}-compare.png")

    # 차이 이미지: 흐린 원본 위에 바뀐 픽셀은 빨강(진할수록 많이 바뀜), 마스크 테두리는 하늘색
    base = orig.convert("L").point(lambda v: v // 3 + 60).convert("RGB")
    p, o, e, m = base.load(), orig.load(), edit.load(), mask.load()
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            delta = max(abs(o[x, y][i] - e[x, y][i]) for i in range(3))
            if delta:
                p[x, y] = (min(255, 90 + delta * 4), 30, 30)
            elif m[x, y] and any(not m[min(SIZE[0] - 1, max(0, x + dx)), min(SIZE[1] - 1, max(0, y + dy))]
                                 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                p[x, y] = (60, 200, 230)
    base.crop(band).resize((bw, bh), Image.Resampling.NEAREST).save(PREVIEW_DIR / f"{name}-diff.png")


def edit_pure(img):
    out, mask = erase_tails(img, PURE_TAILS)
    return out, mask, []


def edit_chic(img):
    lens, lens_mask = recolor_irises(img, CHIC_IRISES, LENS_GRAY)
    src, res = img.load(), lens.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if src[x, y] != res[x, y]]
    protected = sum(1 for x, y in changed if iris_protected(src, x, y))
    if protected:
        sys.exit(f"chic: 보호 픽셀(눈꺼풀 선, 동공, 반사광, 흰자) {protected}개가 바뀌었습니다. 중단합니다.")
    y_shift = max(abs(luma(src[p]) - luma(res[p])) for p in changed)
    out, wing_mask = extend_wings(lens, CHIC_WINGS, LINER)
    notes = [f"렌즈: 바뀐 픽셀 {len(changed)}개, 보호 픽셀 중 바뀐 것 {protected}개, 최대 밝기 변화 {y_shift:.2f}"]
    return out, ImageChops.lighter(lens_mask, wing_mask), notes


def edit_nude(img):
    lens, circle, lens_mask = recolor_nude_irises(img)
    src, res = img.load(), lens.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if src[x, y] != res[x, y]]
    if not changed:
        sys.exit("nude: 렌즈에서 바뀐 픽셀이 없습니다. 마스크와 보호 조건을 확인해야 합니다. 중단합니다.")
    kept = check_unchanged("nude 렌즈", img, lens, NUDE_LENS_KEEP | NUDE_LID_PIXELS)
    y_shift = max(abs(luma(src[p]) - luma(res[p])) for p in changed)

    # 꼬리 상자는 렌즈 마스크와 따로 만듭니다. 보호 픽셀을 빼기 전의 원 전체와 겹치는지 봅니다 (둘 다 0 또는 255).
    out, tail_mask = restyle_tails(lens, NUDE_TAILS, NUDE_LINER, NUDE_LINER_LIFT)
    if count_nonzero(ImageChops.multiply(circle, tail_mask)):
        sys.exit("nude: 렌즈 원과 꼬리 상자가 겹칩니다. 중단합니다.")
    tail_changed = changed_pixels(lens, out)
    if count_nonzero(ImageChops.multiply(tail_changed, tail_mask.point(lambda v: 0 if v else 255))):
        sys.exit("nude: 꼬리 처리가 꼬리 상자 밖 픽셀을 바꿨습니다. 중단합니다.")
    if not count_nonzero(tail_changed):
        sys.exit("nude: 꼬리에서 바뀐 픽셀이 없습니다. 꼬리 상자와 기준값을 확인해야 합니다. 중단합니다.")
    check_unchanged("nude 최종", img, out, NUDE_LENS_KEEP | NUDE_LID_PIXELS)

    notes = [f"렌즈: 바뀐 픽셀 {len(changed)}개, 최대 밝기 변화 {y_shift:.2f}",
             f"보호 좌표 {kept}개(동공·반사광·작은 반사광·테두리·윗눈꺼풀 선): 렌즈 후와 최종 모두 원본과 RGB 같음",
             f"꼬리: 바뀐 픽셀 {count_nonzero(tail_changed)}개 (상자 {[t['box'] for t in NUDE_TAILS]} 안)"]
    return out, ImageChops.lighter(lens_mask, tail_mask), notes


def modern_lens_protected(src, x, y):
    """MODERN 렌즈에서 빼는 픽셀: 측정한 보호 좌표, 윗눈꺼풀 선과 그 위, 동공·반사광·흰자(밝기), 회색 픽셀(채도)."""
    if (x, y) in MODERN_LENS_KEEP:
        return True
    lid = MODERN_LID_BOTTOM.get(x)
    if lid is None or y <= lid:
        return True
    py = luma(src[x, y])
    if py <= PUPIL_MAX_Y or py >= HIGHLIGHT_MIN_Y:
        return True
    return saturation(src[x, y]) < MODERN_SAT[0]


def modern_lens_masks(img):
    """(원 마스크, 렌즈 마스크)를 돌려줍니다. 원 마스크는 픽셀 중심이 원 안인 픽셀 전체(겹침 검사용),
    렌즈 마스크는 그중 보호 픽셀을 뺀 것입니다. MODERN_IRIS_BOTTOM까지 100%, 다음 줄은 밝기 조건을 넘는 픽셀만 50%, 그 아래 0입니다."""
    src = img.load()
    circle, lens = Image.new("L", SIZE, 0), Image.new("L", SIZE, 0)
    c, m = circle.load(), lens.load()
    r = MODERN_IRIS_RADIUS
    for cx, cy in MODERN_IRISES:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    continue
                c[x, y] = 255
                if y > MODERN_IRIS_BOTTOM + 1 or modern_lens_protected(src, x, y):
                    continue
                if y <= MODERN_IRIS_BOTTOM:
                    m[x, y] = 255
                elif luma(src[x, y]) < MODERN_MIXED_ROW_MAX_Y:
                    m[x, y] = 128
    return circle, lens


def recolor_modern_irises(img):
    """밝기(Y)는 그대로 두고 색 성분(Cb, Cr)만 애시 그레이 브라운 쪽으로 옮깁니다.
    채도가 낮을수록(MODERN_SAT 구간) 덜 바꿔 동공·홍채 경계를 부드럽게 둡니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    circle, mask = modern_lens_masks(img)
    m = mask.load()
    ty, tcb, tcr = to_ycc(MODERN_LENS)
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            w = MODERN_LENS_STRENGTH * m[x, y] / 255 * tone_weight(py) * ramp(saturation(src[x, y]), *MODERN_SAT)
            if w:
                cb = pcb + (tcb * py / ty - pcb) * w
                cr = pcr + (tcr * py / ty - pcr) * w
                dst[x, y] = from_ycc(py, cb, cr)
    return out, circle, mask


def modern_skin(src, x, y):
    """꼬리 자리의 피부 추정값: 위 줄과 아래 줄(두 줄 중 밝은 쪽) 사이를 세로로 섞습니다."""
    above = src[x, MODERN_SKIN_ABOVE_Y]
    below_y = MODERN_SKIN_BELOW_YS[0]
    below = max((src[x, by] for by in MODERN_SKIN_BELOW_YS), key=luma)
    return lerp(above, below, (y - MODERN_SKIN_ABOVE_Y) / (below_y - MODERN_SKIN_ABOVE_Y))


def restyle_modern_tails(img):
    """올라간 꼬리를 지우고 수평 라인 바깥쪽을 차콜로 바꿉니다. (결과, 상자 마스크, 지운 픽셀 수, 수평 부분으로 본 열)을 돌려줍니다.
    지우기는 새 꼬리 선(MODERN_WINGS) 중심보다 MODERN_ERASE_MARGIN 이상 위인 어두운 픽셀만, 색 바꾸기는 restyle_tails와 같은 식입니다.
    상자 안이라도 라인 띠가 y 90까지 내려온 열(MODERN_BASE_MIN_DARK)은 수평 부분이라 지우지 않습니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(mask)
    erased = 0
    base_columns = []
    for (l, t, r, b), ((sx, sy), (dx, dy), _) in zip(MODERN_TAIL_BOXES, MODERN_WINGS):
        draw.rectangle([l, t, r, b], fill=255)
        for x in range(l, r + 1):
            low = MODERN_SKIN_BELOW_YS[0]
            if luma(modern_skin(src, x, low)) - luma(src[x, low]) >= MODERN_BASE_MIN_DARK:
                base_columns.append(x)
        for y in range(t, b + 1):
            for x in range(l, r + 1):
                if (x in base_columns or (x, y) in MODERN_TAIL_KEEP
                        or y > sy + dy / dx * (x - sx) - MODERN_ERASE_MARGIN):
                    continue
                skin = modern_skin(src, x, y)
                if luma(skin) - luma(src[x, y]) >= TAIL_MIN_DARK:
                    dst[x, y] = skin
                    erased += 1

    ty, tcb, tcr = to_ycc(MODERN_LINER)
    for part in MODERN_RECOLOR:
        l, t, r, b = part["box"]
        draw.rectangle([l, t, r, b], fill=255)
        for y in range(t, b + 1):
            for x in range(l, r + 1):
                skin_y = luma(src[x, MODERN_SKIN_ABOVE_Y])
                span = skin_y - LINER_CORE_Y - TAIL_MIN_DARK
                if span <= 0:
                    continue
                py, pcb, pcr = to_ycc(dst[x, y])  # 지우기 뒤 값. 지운 픽셀은 피부라 cover가 0입니다
                cover = min(1, max(0, (skin_y - py - TAIL_MIN_DARK) / span))
                w = cover * ramp(x, *part["ramp"])
                if not w:
                    continue
                ny = py + (ty - py) * MODERN_LINER_LIFT * w
                dst[x, y] = from_ycc(ny, pcb + (tcb * ny / ty - pcb) * w, pcr + (tcr * ny / ty - pcr) * w)
    return out, mask, erased, base_columns


def check_other_moods(when):
    """다른 무드의 수정본·비교 이미지가 기록한 SHA-256과 같은지 확인합니다. 없거나 다르면 중단합니다.
    실행 뒤 확인: .venv/bin/python -c 'import runpy; runpy.run_path("dev/edit-moods.py")["check_other_moods"]("실행 후")'"""
    for rel, expected in MODERN_OTHER_OUTPUTS_SHA256.items():
        path = ROOT / rel
        if not path.exists():
            sys.exit(f"다른 무드 파일 확인({when}): {rel}이 없습니다. 중단합니다.")
        if sha256(path) != expected:
            sys.exit(f"다른 무드 파일 확인({when}): {rel}의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    print(f"다른 무드 파일 확인({when}): {len(MODERN_OTHER_OUTPUTS_SHA256)}개 모두 기록한 SHA-256과 같음")
    return len(MODERN_OTHER_OUTPUTS_SHA256)


def edit_modern(img):
    check_other_moods("MODERN 편집 전")
    lens, circle, lens_mask = recolor_modern_irises(img)
    src, res = img.load(), lens.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if src[x, y] != res[x, y]]
    if not changed:
        sys.exit("modern: 렌즈에서 바뀐 픽셀이 없습니다. 마스크와 보호 조건을 확인해야 합니다. 중단합니다.")
    kept = check_unchanged("modern 렌즈", img, lens, MODERN_LENS_KEEP | MODERN_LID_PIXELS)
    y_shift = max(abs(luma(src[p]) - luma(res[p])) for p in changed)

    tailed, tail_mask, erased, base_columns = restyle_modern_tails(lens)
    out, wing_mask = extend_wings(tailed, MODERN_WINGS, MODERN_LINER)
    o, t, a = out.load(), tailed.load(), wing_mask.load()
    clipped = 0
    for y in range(MODERN_WING_MAX_Y + 1, SIZE[1]):
        for x in range(SIZE[0]):
            if a[x, y]:
                o[x, y], a[x, y] = t[x, y], 0
                clipped += 1
    work_mask = ImageChops.lighter(tail_mask, wing_mask)

    # 꼬리 작업 영역은 렌즈 마스크와 따로 만듭니다. 보호 픽셀을 빼기 전의 원 전체와 겹치는지 봅니다.
    if count_nonzero(ImageChops.multiply(circle, work_mask)):
        sys.exit("modern: 렌즈 원과 꼬리 작업 영역이 겹칩니다. 중단합니다.")
    tail_changed = changed_pixels(lens, out)
    if count_nonzero(ImageChops.multiply(tail_changed, work_mask.point(lambda v: 0 if v else 255))):
        sys.exit("modern: 꼬리 처리가 꼬리 작업 영역 밖 픽셀을 바꿨습니다. 중단합니다.")
    if not count_nonzero(tail_changed) or not erased:
        sys.exit(f"modern: 꼬리에서 바뀐 픽셀 {count_nonzero(tail_changed)}개, 지운 픽셀 {erased}개입니다. 상자와 기준값을 확인해야 합니다. 중단합니다.")
    check_unchanged("modern 최종", img, out, MODERN_LENS_KEEP | MODERN_LID_PIXELS)
    check_unchanged("modern 아래 눈매 선", img, out, MODERN_LOWER_LASH)
    in_boxes = {(x, y) for l, t_, r, b in MODERN_TAIL_BOXES for y in range(t_, b + 1) for x in range(l, r + 1)}
    # 상자 안 보호 좌표 중 y 88 이상((12,88))은 색 바꾸기 대상이라 뺍니다. 지우기에서 남긴 것은 y 87 이하로 확인합니다.
    crease = ([p for p in MODERN_CREASE_AREA if p not in in_boxes]
              + [p for p in MODERN_TAIL_KEEP if p[1] < MODERN_RECOLOR[0]["box"][1]])
    check_unchanged("modern 주름 그늘·꼬리 보호", img, out, crease)

    # 꼬리 방향: 열마다 윗라인 자리(y 86~90)에서 가장 어두운 줄이 1px 안에 있어야 합니다.
    p = out.load()
    flat = []
    for xs in MODERN_FLAT_COLUMNS:
        rows = {}
        for x in xs:
            y = min(range(86, MODERN_WING_MAX_Y + 1), key=lambda yy: luma(p[x, yy]))
            if luma(p[x, MODERN_SKIN_ABOVE_Y]) - luma(p[x, y]) >= MODERN_LINE_MIN_DARK:
                rows[x] = y
        if len(rows) < 4 or max(rows.values()) - min(rows.values()) > 1:
            sys.exit(f"modern: 꼬리가 수평에 가깝지 않습니다 (열별 가장 어두운 줄 {rows}). 중단합니다.")
        flat.append(rows)
    # 올라간 꼬리가 남았는지: y 87 미만에서 피부 추정값보다 MODERN_LEFTOVER_DARK 이상 어두운 픽셀 (주름 그늘 보호 좌표 제외)
    left_over = [(x, y) for xs in MODERN_LEFTOVER_COLUMNS for x in xs for y in range(MODERN_TAIL_BOXES[0][1], 87)
                 if (x, y) not in MODERN_TAIL_KEEP and luma(modern_skin(src, x, y)) - luma(p[x, y]) >= MODERN_LEFTOVER_DARK]
    if left_over:
        sys.exit(f"modern: 지우지 못한 꼬리 픽셀 {len(left_over)}개 (예: {left_over[:5]}). 중단합니다.")

    notes = [f"렌즈: 바뀐 픽셀 {len(changed)}개, 최대 밝기 변화 {y_shift:.2f}",
             f"보호 좌표 {kept}개(동공·반사광·작은 반사광·윗눈꺼풀 선): 렌즈 후와 최종 모두 원본과 RGB 같음",
             f"꼬리: 바뀐 픽셀 {count_nonzero(tail_changed)}개 (지운 픽셀 {erased}개, 되돌린 덧그리기 픽셀 {clipped}개, "
             f"상자 안 수평 부분으로 본 열 {base_columns})",
             f"아래 눈매 선 {len(MODERN_LOWER_LASH)}개, 주름 그늘·꼬리 보호 {len(crease)}개: 원본과 RGB 같음",
             f"꼬리 열별 가장 어두운 줄: 왼쪽 {flat[0]}, 오른쪽 {flat[1]}"]
    return out, ImageChops.lighter(lens_mask, work_mask), notes


def check_recorded_outputs(when, table):
    """기록한 SHA-256 표의 파일이 모두 있고 값이 같은지 확인합니다. 없거나 다르면 중단합니다.
    실행 뒤 확인: .venv/bin/python -c 'import runpy; m = runpy.run_path("dev/edit-moods.py"); m["check_recorded_outputs"]("실행 후", m["SESSION_PROTECTED_SHA256"])'"""
    for rel, expected in table.items():
        path = ROOT / rel
        if not path.exists():
            sys.exit(f"보호 파일 확인({when}): {rel}이 없습니다. 중단합니다.")
        if sha256(path) != expected:
            sys.exit(f"보호 파일 확인({when}): {rel}의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    print(f"보호 파일 확인({when}): {len(table)}개 모두 기록한 SHA-256과 같음")
    return len(table)


def chic_wing_reach(x, y):
    """늘린 꼬리 픽셀이 원래 꼬리 끝(CHIC_WINGS 끝점)에서 꼬리 방향으로 나간 거리(px)."""
    (tx, ty), (dx, dy), _ = CHIC_WINGS[0 if x < SIZE[0] // 2 else 1]
    return (x - tx) * dx + (y - ty) * dy


def edit_chic_v2(img):
    check_recorded_outputs("CHIC 편집 전", SESSION_PROTECTED_SHA256)
    v1, v1_mask, _ = edit_chic(img)
    if sha256(CHIC_V1_BACKUP) != CHIC_V1_SHA256:
        sys.exit(f"chic: 버전 1 백업({CHIC_V1_BACKUP.relative_to(ROOT)})의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    with Image.open(CHIC_V1_BACKUP) as f:
        if f.mode != "RGB" or f.size != SIZE or f.get_flattened_data() != v1.get_flattened_data():
            sys.exit("chic: 다시 만든 버전 1이 백업 파일과 픽셀이 다릅니다. 중단합니다.")
    o, v = img.load(), v1.load()
    v1_changed = {(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if o[x, y] != v[x, y]}
    if len(v1_changed) != CHIC_V1_CHANGED_COUNT or not CHIC_V1_WING_PIXELS <= v1_changed:
        sys.exit(f"chic: 버전 1 변경 픽셀이 기록과 다릅니다 ({len(v1_changed)}개). 중단합니다.")

    out = v1.copy()
    d = out.load()
    for x, y in CHIC_V1_WING_PIXELS:
        w = ramp(chic_wing_reach(x, y), *CHIC_V2_TRIM)
        if w:
            d[x, y] = lerp(v[x, y], o[x, y], w)

    # 렌즈·라인·나머지: 늘린 꼬리 23개 밖은 모두 버전 1과 RGB가 같아야 합니다 (렌즈 595개 포함).
    rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if (x, y) not in CHIC_V1_WING_PIXELS]
    check_unchanged("chic 버전 1 대비 렌즈·나머지", v1, out, rest)
    moved = sorted(p for p in CHIC_V1_WING_PIXELS if d[p] != v[p])
    if not moved:
        sys.exit("chic: 버전 1에서 바뀐 꼬리 픽셀이 없습니다. CHIC_V2_TRIM을 확인해야 합니다. 중단합니다.")
    if any(chic_wing_reach(*p) < CHIC_V2_TRIM[0] for p in moved):
        sys.exit("chic: 남겨야 할 꼬리(거리 1.0 미만) 픽셀이 바뀌었습니다. 중단합니다.")
    if any(not min(v[p][i], o[p][i]) <= d[p][i] <= max(v[p][i], o[p][i]) for p in moved for i in range(3)):
        sys.exit("chic: 꼬리 픽셀이 버전 1과 원본 사이 값이 아닙니다. 중단합니다.")
    # 길이: 원본보다 CHIC_LENGTH_MIN_DARK 이상 어두운 꼬리 픽셀 중 가장 먼 거리. 양쪽 모두 버전 1보다 짧아야 합니다.
    lengths = []
    for side in (lambda x: x < SIZE[0] // 2, lambda x: x >= SIZE[0] // 2):
        wing = [p for p in CHIC_V1_WING_PIXELS if side(p[0])]
        before, after = [max((chic_wing_reach(*p) for p in wing if luma(o[p]) - luma(px[p]) >= CHIC_LENGTH_MIN_DARK), default=0)
                         for px in (v, d)]
        if not 0 < after < before:
            sys.exit(f"chic: 꼬리 길이가 줄지 않았거나 사라졌습니다 (버전 1 {before:.2f}, 결과 {after:.2f}). 중단합니다.")
        lengths.append(f"{before:.2f}→{after:.2f}")

    notes = [f"버전 1(edit_chic로 다시 만듦)이 백업 {CHIC_V1_BACKUP.name}과 픽셀까지 같음, 원본 대비 변경 {len(v1_changed)}개",
             f"렌즈·나머지 {len(rest)}개: 버전 1과 RGB 같음 (렌즈 변경 0개)",
             f"꼬리: 버전 1 대비 바뀐 픽셀 {len(moved)}개 {moved}",
             f"꼬리 길이(원래 끝에서 px, 왼쪽/오른쪽): {lengths[0]} / {lengths[1]}"]
    return out, v1_mask, notes


def lovely_lens_masks(img):
    """(원 마스크, 렌즈 마스크). 원 마스크는 픽셀 중심이 원 안인 픽셀 전체(겹침 검사용), 렌즈 마스크는 그중 보호 픽셀을 뺀 것.
    중심이 소수(47.5)여도 되도록 픽셀 중심과의 거리로 고릅니다. LOVELY_IRIS_BOTTOM 아래 줄은 넣지 않습니다."""
    src = img.load()
    circle, lens = Image.new("L", SIZE, 0), Image.new("L", SIZE, 0)
    c, m = circle.load(), lens.load()
    r = LOVELY_IRIS_RADIUS
    for cx, cy in LOVELY_IRISES:
        for y in range(math.floor(cy - r), math.ceil(cy + r) + 1):
            for x in range(math.floor(cx - r), math.ceil(cx + r) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    continue
                c[x, y] = 255
                if y > LOVELY_IRIS_BOTTOM or (x, y) in LOVELY_LENS_KEEP:
                    continue
                lid = LOVELY_LID_BOTTOM.get(x)
                if lid is None or y <= lid:
                    continue
                py = luma(src[x, y])
                if py <= PUPIL_MAX_Y or py >= HIGHLIGHT_MIN_Y or saturation(src[x, y]) < LOVELY_SAT[0]:
                    continue
                m[x, y] = 255
    return circle, lens


def recolor_lovely_irises(img):
    """밝기(Y)는 그대로 두고 색 성분(Cb, Cr)만 장밋빛 웜 브라운 쪽으로 LOVELY_LENS_STRENGTH만큼 옮깁니다."""
    out = img.copy()
    src, dst = img.load(), out.load()
    circle, mask = lovely_lens_masks(img)
    m = mask.load()
    ty, tcb, tcr = to_ycc(LOVELY_LENS)
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            w = LOVELY_LENS_STRENGTH * tone_weight(py) * ramp(saturation(src[x, y]), *LOVELY_SAT)
            if w:
                cb = pcb + (tcb * py / ty - pcb) * w
                cr = pcr + (tcr * py / ty - pcr) * w
                dst[x, y] = from_ycc(py, cb, cr)
    return out, circle, mask


def lovely_trim_skin(src, trim, x, y):
    """꼬리 끝 자리의 피부 추정값: 위아래 피부 줄을 세로로 섞습니다."""
    top, bottom = trim["skin_rows"]
    return lerp(src[x, top], src[x, bottom], (y - top) / (bottom - top))


def restyle_lovely_tails(img):
    """라인(밝기 70 이하)을 따뜻한 브라운으로 바꾸고, 꼬리 끝을 피부 쪽으로 서서히 채워 짧고 둥글게 만듭니다. (결과, 상자 마스크)."""
    out = img.copy()
    src, dst = img.load(), out.load()
    mask = Image.new("L", SIZE, 0)
    draw = ImageDraw.Draw(mask)
    ty, tcb, tcr = to_ycc(LOVELY_LINER)
    for part in LOVELY_RECOLOR:
        l, t, r, b = part["box"]
        draw.rectangle([l, t, r, b], fill=255)
        for y in range(t, b + 1):
            for x in range(l, r + 1):
                py, pcb, pcr = to_ycc(src[x, y])
                w = ramp(py, *LOVELY_LINER_DARK) * ramp(x, *part["ramp"])
                if not w:
                    continue
                ny = py + (ty - py) * LOVELY_LINER_LIFT * w
                dst[x, y] = from_ycc(ny, pcb + (tcb * ny / ty - pcb) * w, pcr + (tcr * ny / ty - pcr) * w)
    for trim in LOVELY_TRIMS:
        l, t, r, b = trim["box"]
        draw.rectangle([l, t, r, b], fill=255)
        for y in range(t, b + 1):
            for x in range(l, r + 1):
                skin = lovely_trim_skin(src, trim, x, y)
                if luma(skin) - luma(src[x, y]) >= TAIL_MIN_DARK:
                    dst[x, y] = lerp(dst[x, y], skin, 1 - ramp(x, *trim["keep"]))
    return out, mask


def edit_lovely(img):
    check_recorded_outputs("LOVELY 편집 전", SESSION_PROTECTED_SHA256)
    lens, circle, lens_mask = recolor_lovely_irises(img)
    src, res = img.load(), lens.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if src[x, y] != res[x, y]]
    if not changed:
        sys.exit("lovely: 렌즈에서 바뀐 픽셀이 없습니다. 마스크와 보호 조건을 확인해야 합니다. 중단합니다.")
    kept = check_unchanged("lovely 렌즈", img, lens, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
    y_shift = max(abs(luma(src[p]) - luma(res[p])) for p in changed)

    out, tail_mask = restyle_lovely_tails(lens)
    if count_nonzero(ImageChops.multiply(circle, tail_mask)):
        sys.exit("lovely: 렌즈 원과 꼬리 작업 상자가 겹칩니다. 중단합니다.")
    tail_changed = changed_pixels(lens, out)
    if count_nonzero(ImageChops.multiply(tail_changed, tail_mask.point(lambda v: 0 if v else 255))):
        sys.exit("lovely: 꼬리 처리가 꼬리 작업 상자 밖 픽셀을 바꿨습니다. 중단합니다.")
    if not count_nonzero(tail_changed):
        sys.exit("lovely: 꼬리에서 바뀐 픽셀이 없습니다. 상자와 기준값을 확인해야 합니다. 중단합니다.")
    check_unchanged("lovely 최종", img, out, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
    check_unchanged("lovely 아래 눈매 선", img, out, LOVELY_LOWER_LASH)
    trim_px = {(x, y) for t in LOVELY_TRIMS for y in range(t["box"][1], t["box"][3] + 1)
               for x in range(t["box"][0], t["box"][2] + 1)}
    shadow = [p for p in LOVELY_SHADOW_AREA if p not in trim_px and luma(src[p]) > LOVELY_SHADOW_MIN_Y]
    check_unchanged("lovely 섀도·주름 그늘", img, out, shadow)
    check_unchanged("lovely 흰자", img, out, LOVELY_WHITES)

    p = out.load()
    # 길이: keep이 0인 열에 피부 추정값보다 20 이상 어두운 픽셀이 남으면 실패 (끝의 작은 삐침 포함)
    left_over = [(x, y) for trim, xs in zip(LOVELY_TRIMS, LOVELY_TRIMMED_COLUMNS) for x in xs
                 for y in range(trim["box"][1], trim["box"][3] + 1)
                 if luma(lovely_trim_skin(src, trim, x, y)) - luma(p[x, y]) >= 20]
    if left_over:
        sys.exit(f"lovely: 지워야 할 꼬리 끝 픽셀 {len(left_over)}개가 남았습니다 (예: {left_over[:5]}). 중단합니다.")
    # 너무 많이 지우지 않았는지: 남은 꼬리 끝 열에 위 피부(y 89)보다 30 이상 어두운 픽셀이 있어야 합니다
    for trim, x in zip(LOVELY_TRIMS, LOVELY_TAIL_END_COLUMNS):
        top = trim["skin_rows"][0]
        if max(luma(p[x, top]) - luma(p[x, y]) for y in range(trim["box"][1], trim["box"][3] + 1)) < 30:
            sys.exit(f"lovely: 꼬리 끝 열 x {x}에 라인이 남지 않았습니다. 중단합니다.")
    # 방향: 바깥쪽이 안쪽보다 1~4줄 아래 (살짝 아래로)
    directions = []
    for inner, outer in LOVELY_DIRECTION:
        mean_y = [sum(min(range(87, 96), key=lambda yy: luma(p[x, yy])) for x in range(*span)) / (span[1] - span[0])
                  for span in (inner, outer)]
        drop = mean_y[1] - mean_y[0]
        if not 1 <= drop <= 4:
            sys.exit(f"lovely: 꼬리 방향이 기준(바깥쪽이 1~4줄 아래)과 다릅니다 (안쪽 {mean_y[0]:.1f}, 바깥쪽 {mean_y[1]:.1f}). 중단합니다.")
        directions.append(f"{mean_y[0]:.1f}→{mean_y[1]:.1f}")
    # 색: 바꾼 라인 픽셀의 색 성분이 원본보다 목표색(같은 밝기로 맞춘 #5A4033) 쪽에 가까워야 합니다
    ty, tcb, tcr = to_ycc(LOVELY_LINER)
    recolored = [(x, y) for part in LOVELY_RECOLOR for y in range(part["box"][1], part["box"][3] + 1)
                 for x in range(part["box"][0], part["box"][2] + 1) if (x, y) not in trim_px and src[x, y] != p[x, y]]

    def chroma_gap(c):
        y, cb, cr = to_ycc(c)
        return math.hypot(cb - tcb * y / ty, cr - tcr * y / ty)
    gap_before = sum(chroma_gap(src[q]) for q in recolored) / max(len(recolored), 1)
    gap_after = sum(chroma_gap(p[q]) for q in recolored) / max(len(recolored), 1)
    if not recolored or gap_after >= gap_before:
        sys.exit(f"lovely: 라인 색이 목표색 쪽으로 옮겨지지 않았습니다 ({gap_before:.2f}→{gap_after:.2f}). 중단합니다.")

    notes = [f"렌즈: 바뀐 픽셀 {len(changed)}개, 최대 밝기 변화 {y_shift:.2f}",
             f"보호 좌표 {kept}개(동공·반사광·윗눈꺼풀 선): 렌즈 후와 최종 모두 원본과 RGB 같음",
             f"꼬리: 바뀐 픽셀 {count_nonzero(tail_changed)}개 (색 바꾼 라인 {len(recolored)}개, 목표색과 거리 {gap_before:.2f}→{gap_after:.2f})",
             f"아래 눈매 선 {len(LOVELY_LOWER_LASH)}개, 섀도 {len(shadow)}개, 흰자 {len(LOVELY_WHITES)}개: 원본과 RGB 같음",
             f"꼬리 방향(안쪽→바깥쪽 가장 어두운 줄 평균, 왼쪽/오른쪽): {directions[0]} / {directions[1]}"]
    return out, ImageChops.lighter(lens_mask, tail_mask), notes


def nude_tail_skin(src, tail, x, y):
    """restyle_tails와 같은 피부 추정값: 상자 위아래 한 줄 밖의 피부를 세로로 섞습니다 (skin_above_only 열은 위 줄만)."""
    l, t, r, b = tail["box"]
    above, below = t - 1, b + 1
    if x in tail["skin_above_only"]:
        return src[x, above]
    return lerp(src[x, above], src[x, below], (y - above) / (below - above))


def nude_tail_reach(img, src, tail, outward):
    """꼬리 상자에서 피부 추정값보다 NUDE_LENGTH_MIN_DARK 이상 어두운 칸이 있는 가장 바깥 열 (outward: -1 왼쪽, 1 오른쪽)."""
    l, t, r, b = tail["box"]
    p = img.load()
    cols = [x for x in range(l, r + 1) for y in range(t, b + 1)
            if luma(nude_tail_skin(src, tail, x, y)) - luma(p[x, y]) >= NUDE_LENGTH_MIN_DARK]
    return (min(cols) if outward < 0 else max(cols)) if cols else None


def check_nude_v2_shape(orig, edit):
    """72개 되돌린 칸의 라인 형태 검사 (NUDE_SHAPE_* 주석 참고). 실패하면 중단하고, 통과하면 (원본 라인 수, 새 라인 좌표)를 돌려줍니다.
    저장된 파일로 확인: .venv/bin/python -c 'import runpy; from PIL import Image; m = runpy.run_path("dev/edit-moods.py");
      print(m["check_nude_v2_shape"](Image.open("assets/moods/nude.png").convert("RGB"), Image.open("assets/moods/edit/nude.png").convert("RGB")))'"""
    o, e = orig.load(), edit.load()

    def dark(px, p):
        tail = NUDE_TAILS[0] if p[0] < SIZE[0] // 2 else NUDE_TAILS[1]
        return luma(nude_tail_skin(o, tail, *p)) - luma(px[p])
    line_orig = {p for p in NUDE_V1_TRIMMED_PIXELS if dark(o, p) >= NUDE_LENGTH_MIN_DARK}
    line_edit = {p for p in NUDE_V1_TRIMMED_PIXELS if dark(e, p) >= NUDE_LENGTH_MIN_DARK}
    if len(line_orig) != NUDE_SHAPE_LINE_COUNT:
        sys.exit(f"nude 형태: 원본 라인 칸이 {len(line_orig)}개로 기록({NUDE_SHAPE_LINE_COUNT}개)과 다릅니다. 중단합니다.")
    lost = sorted(line_orig - line_edit)
    if lost:
        sys.exit(f"nude 형태: 원본 라인 칸 {len(lost)}개가 라인이 아니게 됐습니다 (예: {lost[:5]}). 중단합니다.")
    new = sorted(line_edit - line_orig)
    bad = [p for p in new if p not in NUDE_SHAPE_NEW_LINE_ALLOWED or dark(o, p) < NUDE_SHAPE_BORDER_MIN_DARK]
    if bad:
        sys.exit(f"nude 형태: 허용하지 않은 칸이 새로 라인이 됐습니다 {bad}. 중단합니다.")
    return len(line_orig), new


def edit_nude_v2(img):
    check_recorded_outputs("NUDE 편집 전", NUDE_RUN_PROTECTED_SHA256)
    v1, v1_mask, _ = edit_nude(img)
    if sha256(NUDE_V1_BACKUP) != NUDE_V1_SHA256:
        sys.exit(f"nude: 버전 1 백업({NUDE_V1_BACKUP.relative_to(ROOT)})의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    with Image.open(NUDE_V1_BACKUP) as f:
        if f.mode != "RGB" or f.size != SIZE or f.get_flattened_data() != v1.get_flattened_data():
            sys.exit("nude: 다시 만든 버전 1이 백업 파일과 픽셀이 다릅니다. 중단합니다.")
    o, v = img.load(), v1.load()
    v1_changed = {(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if o[x, y] != v[x, y]}
    if len(v1_changed) != NUDE_V1_CHANGED_COUNT or not NUDE_V1_TRIMMED_PIXELS <= v1_changed:
        sys.exit(f"nude: 버전 1 변경 픽셀이 기록과 다릅니다 ({len(v1_changed)}개). 중단합니다.")

    # 꼬리를 줄이지 않고 색만 바꾼 결과. 렌즈는 같은 함수라 버전 1과 같습니다.
    lens, _, _ = recolor_nude_irises(img)
    full, _ = restyle_tails(lens, NUDE_TAILS_FULL, NUDE_LINER, NUDE_LINER_LIFT)
    f_ = full.load()
    # 같은 색 처리인지 확인: 버전 1에서 색만 바뀐 꼬리 칸(keep = 1)은 full과 RGB가 같아야 합니다.
    recolor_only = [p for p in v1_changed - NUDE_V1_TRIMMED_PIXELS
                    if any(t["box"][0] <= p[0] <= t["box"][2] and t["box"][1] <= p[1] <= t["box"][3] for t in NUDE_TAILS)]
    check_unchanged("nude 색만 바뀐 꼬리(버전 1 대비 full)", v1, full, recolor_only)

    out = v1.copy()
    d = out.load()
    for p in NUDE_V1_TRIMMED_PIXELS:
        d[p] = f_[p]

    # 허용 영역(72개) 밖은 모두 버전 1과 RGB가 같아야 합니다 (렌즈 511개, 보호 좌표, 아래 눈매 선 포함).
    rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if (x, y) not in NUDE_V1_TRIMMED_PIXELS]
    check_unchanged("nude 버전 1 대비 렌즈·나머지", v1, out, rest)
    check_unchanged("nude 보호 좌표(원본 대비)", img, out, NUDE_LENS_KEEP | NUDE_LID_PIXELS)
    lower = [(x, y) for y in range(92, SIZE[1]) for x in [*range(0, 31), *range(170, SIZE[0])]]
    check_unchanged("nude 아래 눈매 선(원본 대비)", img, out, lower)
    moved = sorted(p for p in NUDE_V1_TRIMMED_PIXELS if d[p] != v[p])
    if not moved:
        sys.exit("nude: 버전 1에서 되돌린 꼬리 픽셀이 없습니다. 중단합니다.")
    if any(luma(d[p]) > luma(v[p]) for p in moved):
        sys.exit("nude: 되돌린 칸 중 버전 1보다 밝아진 픽셀이 있습니다 (라인이 아니라 피부 쪽으로 바뀜). 중단합니다.")
    outside = sum(1 for t in NUDE_TAILS for y in range(t["box"][1], t["box"][3] + 1) for x in range(t["box"][0], t["box"][2] + 1)
                  if (x, y) not in NUDE_V1_TRIMMED_PIXELS and (x, y) not in v1_changed and f_[x, y] != v[x, y])

    # 길이: 가장 바깥 라인 열이 원본과 같고, 버전 1은 그보다 안쪽이어야 합니다.
    lengths = []
    for tail, outward in zip(NUDE_TAILS, (-1, 1)):
        reach = [nude_tail_reach(im, o, tail, outward) for im in (img, v1, out)]
        if None in reach or reach[2] != reach[0] or (reach[1] - reach[0]) * outward >= 0:
            sys.exit(f"nude: 꼬리 길이가 원본과 다릅니다 (가장 바깥 열 원본/버전 1/v2 = {reach}). 중단합니다.")
        lengths.append("/".join(map(str, reach)))
    # 색: 되돌린 칸의 색 성분이 원본보다 웜 브라운(같은 밝기로 맞춘 #6B4A35) 쪽에 가까워야 합니다.
    ty, tcb, tcr = to_ycc(NUDE_LINER)

    def chroma_gap(c):
        y, cb, cr = to_ycc(c)
        return math.hypot(cb - tcb * y / ty, cr - tcr * y / ty)
    gap_before = sum(chroma_gap(o[p]) for p in moved) / len(moved)
    gap_after = sum(chroma_gap(d[p]) for p in moved) / len(moved)
    if gap_after >= gap_before:
        sys.exit(f"nude: 되돌린 꼬리 색이 웜 브라운 쪽으로 옮겨지지 않았습니다 ({gap_before:.2f}→{gap_after:.2f}). 중단합니다.")
    n_line, new_line = check_nude_v2_shape(img, out)

    notes = [f"버전 1(edit_nude로 다시 만듦)이 백업 {NUDE_V1_BACKUP.name}과 픽셀까지 같음, 원본 대비 변경 {len(v1_changed)}개",
             f"색만 바뀐 꼬리 {len(recolor_only)}개: 줄이지 않은 결과와 RGB 같음 (같은 색 처리)",
             f"렌즈·나머지 {len(rest)}개: 버전 1과 RGB 같음, 보호 좌표·아래 눈매 선: 원본과 RGB 같음",
             f"꼬리: 버전 1 대비 되돌린 픽셀 {len(moved)}개 (허용 72개 안), 허용 영역 밖에서 full과 버전 1이 다른 칸 {outside}개(바꾸지 않음)",
             f"가장 바깥 라인 열(원본/버전 1/v2): 왼쪽 {lengths[0]}, 오른쪽 {lengths[1]}",
             f"되돌린 칸 색 성분과 웜 브라운의 거리: 원본 {gap_before:.2f} → v2 {gap_after:.2f}",
             f"형태: 원본 라인 {n_line}개 모두 유지, 새로 라인이 된 칸 {new_line} (허용 경계 칸)"]
    return out, v1_mask, notes


def chic_trimmed(v1, orig, trim):
    """버전 1의 늘린 꼬리 23개를 trim 구간(원래 꼬리 끝에서의 거리)에 따라 원본 쪽으로 되돌린 이미지. edit_chic_v2와 같은 식입니다."""
    out = v1.copy()
    d, v, o = out.load(), v1.load(), orig.load()
    for x, y in CHIC_V1_WING_PIXELS:
        w = ramp(chic_wing_reach(x, y), *trim)
        if w:
            d[x, y] = lerp(v[x, y], o[x, y], w)
    return out


def chic_wing_length(orig, img, left):
    """원본보다 CHIC_LENGTH_MIN_DARK 이상 어두운 꼬리 픽셀 중 원래 꼬리 끝에서 가장 먼 거리(px)."""
    o, p = orig.load(), img.load()
    return max((chic_wing_reach(*q) for q in CHIC_V1_WING_PIXELS
                if (q[0] < SIZE[0] // 2) == left and luma(o[q]) - luma(p[q]) >= CHIC_LENGTH_MIN_DARK), default=0)


def edit_chic_v3(img):
    check_recorded_outputs("CHIC v3 편집 전", CHIC_V3_RUN_PROTECTED_SHA256)
    v1, v1_mask, _ = edit_chic(img)
    v2 = chic_trimmed(v1, img, CHIC_V2_TRIM)
    for path, expected, made, label in ((CHIC_V1_BACKUP, CHIC_V1_SHA256, v1, "버전 1"), (CHIC_V2_BACKUP, CHIC_V2_SHA256, v2, "v2")):
        if sha256(path) != expected:
            sys.exit(f"chic: {label} 백업({path.relative_to(ROOT)})의 SHA-256이 기록값과 다릅니다. 중단합니다.")
        with Image.open(path) as f:
            if f.mode != "RGB" or f.size != SIZE or f.get_flattened_data() != made.get_flattened_data():
                sys.exit(f"chic: 다시 만든 {label}이 백업 파일과 픽셀이 다릅니다. 중단합니다.")
    o, v = img.load(), v1.load()
    v1_changed = {(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if o[x, y] != v[x, y]}
    if len(v1_changed) != CHIC_V1_CHANGED_COUNT or not CHIC_V1_WING_PIXELS <= v1_changed:
        sys.exit(f"chic: 버전 1 변경 픽셀이 기록과 다릅니다 ({len(v1_changed)}개). 중단합니다.")

    out = chic_trimmed(v1, img, CHIC_V3_TRIM)
    d, b = out.load(), v2.load()
    # 렌즈·라인·나머지: 늘린 꼬리 23개 밖은 모두 v2(= 버전 1)와 RGB가 같아야 합니다 (렌즈 595개 포함).
    rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if (x, y) not in CHIC_V1_WING_PIXELS]
    check_unchanged("chic v3 v2 대비 렌즈·나머지", v2, out, rest)
    moved = sorted(p for p in CHIC_V1_WING_PIXELS if d[p] != b[p])
    if not moved or not set(moved) <= CHIC_V3_CHANGED_PIXELS:
        sys.exit(f"chic: v2 대비 바뀐 픽셀이 허용한 6개와 다릅니다 ({moved}). 중단합니다.")
    if any(chic_wing_reach(*p) < CHIC_V3_TRIM[0] for p in moved):
        sys.exit("chic: 남겨야 할 꼬리(거리 0.5 미만, 가장 진한 끝 포함) 픽셀이 바뀌었습니다. 중단합니다.")
    if any(not min(b[p][i], o[p][i]) <= d[p][i] <= max(b[p][i], o[p][i]) for p in moved for i in range(3)):
        sys.exit("chic: 꼬리 픽셀이 v2와 원본 사이 값이 아닙니다. 중단합니다.")
    lengths = []
    for left in (True, False):
        before, after = chic_wing_length(img, v2, left), chic_wing_length(img, out, left)
        if not (after > 0 and CHIC_V3_SHORTEN[0] <= before - after <= CHIC_V3_SHORTEN[1]):
            sys.exit(f"chic: 꼬리가 v2보다 {CHIC_V3_SHORTEN[0]}~{CHIC_V3_SHORTEN[1]}px 짧아지지 않았습니다 "
                     f"(v2 {before:.2f}, v3 {after:.2f}). 중단합니다.")
        lengths.append(f"{before:.2f}→{after:.2f}")

    notes = [f"버전 1·v2(다시 만듦)가 백업 {CHIC_V1_BACKUP.name}, {CHIC_V2_BACKUP.name}과 픽셀까지 같음",
             f"렌즈·나머지 {len(rest)}개: v2와 RGB 같음 (렌즈 변경 0개)",
             f"꼬리: v2 대비 바뀐 픽셀 {len(moved)}개 {moved} (허용 6개 안)",
             f"꼬리 길이(원래 끝에서 px, v2→v3, 왼쪽/오른쪽): {lengths[0]} / {lengths[1]}"]
    return out, v1_mask, notes


def make_chic_v3_vs_v2_previews():
    """실행 뒤 따로 호출: v2(백업)와 v3(현재 수정본)의 눈 띠와 꼬리 끝을 확대한 비교 이미지, v2 대비 바뀐 픽셀 차이 이미지를 새 파일로 만듭니다.
    파일이 이미 있으면 만들지 않고 중단합니다.
    호출: .venv/bin/python -c 'import runpy; runpy.run_path("dev/edit-moods.py")["make_chic_v3_vs_v2_previews"]()'"""
    existing = [p for p in CHIC_V3_PAIR_PREVIEWS if p.exists()]
    if existing:
        sys.exit("이미 있는 파일이라 덮어쓰지 않고 중단합니다: " + ", ".join(str(p.relative_to(ROOT)) for p in existing))
    if sha256(CHIC_V2_BACKUP) != CHIC_V2_SHA256:
        sys.exit("v2 백업의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    with Image.open(CHIC_V2_BACKUP) as f:
        v2 = f.copy()
    with Image.open(OUT_DIR / "chic.png") as f:
        v3 = f.copy()
    o, n = v2.load(), v3.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if o[x, y] != n[x, y]]
    if not changed or not set(changed) <= CHIC_V3_CHANGED_PIXELS:
        sys.exit(f"v3가 v2와 허용한 6개 밖에서 다르거나 같습니다 ({changed}). 중단합니다.")

    band, zoom = (0, 64, 201, 114), 6
    tails, tail_zoom = [(0, 70, 13, 87), (186, 70, 199, 87)], 20  # 꼬리 끝 (왼쪽, 위, 오른쪽, 아래)
    bw, bh = (band[2] - band[0]) * zoom, (band[3] - band[1]) * zoom
    tw, th = (tails[0][2] - tails[0][0]) * tail_zoom, (tails[0][3] - tails[0][1]) * tail_zoom

    def layout(top, bottom, tail_imgs):
        """위: top 눈 띠, 가운데: bottom 눈 띠, 아래: 꼬리 끝 확대 4칸 (왼쪽 v2, 왼쪽 v3, 오른쪽 v2, 오른쪽 v3)."""
        sheet = Image.new("RGB", (bw, bh * 2 + th + 24), "white")
        sheet.paste(top.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, 0))
        sheet.paste(bottom.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, bh + 8))
        for i, (im, box) in enumerate(tail_imgs):
            sheet.paste(im.crop(box).resize((tw, th), Image.Resampling.NEAREST), (i * (tw + 8), bh * 2 + 16))
        return sheet

    compare = layout(v2, v3, [(v2, tails[0]), (v3, tails[0]), (v2, tails[1]), (v3, tails[1])])
    # 차이 이미지: 흐린 v2 위에 v3에서 바뀐 픽셀을 빨강으로 (진할수록 많이 바뀜)
    base = v2.convert("L").point(lambda v: v // 3 + 60).convert("RGB")
    p = base.load()
    for x, y in changed:
        p[x, y] = (min(255, 90 + max(abs(o[x, y][i] - n[x, y][i]) for i in range(3)) * 4), 30, 30)
    diff = layout(v2, base, [(v2, tails[0]), (base, tails[0]), (v2, tails[1]), (base, tails[1])])  # 위: v2 원래 모습, 가운데·꼬리: 차이 표시
    for path, im in zip(CHIC_V3_PAIR_PREVIEWS, (compare, diff)):
        with open(path, "xb") as fp:  # "x": 파일이 이미 있으면 열지 않고 오류를 냅니다 (덮어쓰기 방지)
            im.save(fp, format="PNG")
    print(f"v2→v3 비교 이미지: {', '.join(str(p.relative_to(ROOT)) for p in CHIC_V3_PAIR_PREVIEWS)} (바뀐 픽셀 {len(changed)}개)")
    return len(changed)


def recolor_lovely_irises_at(img, strength):
    """recolor_lovely_irises와 같은 처리를 렌즈 강도만 바꿔 적용합니다 (같은 마스크·보호 조건)."""
    out = img.copy()
    src, dst = img.load(), out.load()
    circle, mask = lovely_lens_masks(img)
    m = mask.load()
    ty, tcb, tcr = to_ycc(LOVELY_LENS)
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            w = strength * tone_weight(py) * ramp(saturation(src[x, y]), *LOVELY_SAT)
            if w:
                cb = pcb + (tcb * py / ty - pcb) * w
                cr = pcr + (tcr * py / ty - pcr) * w
                dst[x, y] = from_ycc(py, cb, cr)
    return out, mask


def make_lovely_strength_candidate():
    """원본 lovely.png에 렌즈 강도 LOVELY_CANDIDATE_STRENGTH를 적용한 후보와, 현재 결과물(0.4)과의 비교·차이 이미지를 새 파일로 만듭니다.
    아이라인 처리는 현재 결과물과 같은 함수로 하므로 렌즈 밖은 0.4 결과와 픽셀이 같아야 합니다. 파일이 이미 있으면 중단합니다.
    호출: .venv/bin/python -c 'import runpy; runpy.run_path("dev/edit-moods.py")["make_lovely_strength_candidate"]()'"""
    existing = [p for p in LOVELY_CANDIDATE_FILES if p.exists()]
    if existing:
        sys.exit("이미 있는 파일이라 덮어쓰지 않고 중단합니다: " + ", ".join(str(p.relative_to(ROOT)) for p in existing))
    check_recorded_outputs("LOVELY 후보 만들기 전", SESSION_PROTECTED_SHA256)
    check_recorded_outputs("LOVELY 현재 결과물", LOVELY_CURRENT_SHA256)
    with Image.open(SRC_DIR / "lovely.png") as f:
        orig = f.copy()
    with Image.open(OUT_DIR / "lovely.png") as f:
        current = f.copy()

    # 0.4: 현재 결과물을 같은 함수로 다시 만들어 파일과 픽셀이 같은지 확인합니다 (edit_lovely의 검사도 모두 다시 돕니다).
    redo, _, _ = edit_lovely(orig)
    if redo.get_flattened_data() != current.get_flattened_data():
        sys.exit("lovely: 다시 만든 0.4 결과가 현재 수정본과 픽셀이 다릅니다. 중단합니다.")
    # 후보: 렌즈 강도만 바꾸고 아이라인은 같은 함수(restyle_lovely_tails)로 처리합니다.
    lens, lens_mask = recolor_lovely_irises_at(orig, LOVELY_CANDIDATE_STRENGTH)
    cand, _ = restyle_lovely_tails(lens)

    c, n, m = current.load(), cand.load(), lens_mask.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if c[x, y] != n[x, y]]
    outside = [p for p in changed if not m[p]]
    if outside:
        sys.exit(f"lovely: 렌즈 마스크 밖에서 0.4 결과와 다른 픽셀 {len(outside)}개 (예: {outside[:5]}). 중단합니다.")
    if not changed:
        sys.exit("lovely: 0.4 결과와 다른 픽셀이 없습니다. 중단합니다.")
    lens_area = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if m[x, y]]
    rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if not m[x, y]]
    check_unchanged("lovely 후보 렌즈 밖(아이라인 포함, 0.4 대비)", current, cand, rest)
    check_unchanged("lovely 후보 보호 좌표(동공·반사광·윗눈꺼풀 선, 0.4 대비)", current, cand, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
    check_unchanged("lovely 후보 보호 좌표(원본 대비)", orig, cand, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
    o = orig.load()
    y_shift = max(abs(luma(o[p]) - luma(n[p])) for p in changed)
    s0, s4, s6 = (sorted(saturation(px[p]) for p in changed) for px in (o, c, n))

    # 비교 이미지: 위 0.4, 가운데 0.6 (눈 띠 6배), 아래 홍채 12배 (왼쪽 눈 0.4 | 0.6, 오른쪽 눈 0.4 | 0.6)
    band, zoom = (0, 64, 201, 114), 6
    irises, iris_zoom = [(34, 82, 62, 110), (135, 82, 163, 110)], 12
    bw, bh = (band[2] - band[0]) * zoom, (band[3] - band[1]) * zoom
    iw, ih = (irises[0][2] - irises[0][0]) * iris_zoom, (irises[0][3] - irises[0][1]) * iris_zoom

    def layout(top, middle, crops):
        sheet = Image.new("RGB", (max(bw, 4 * iw + 24), bh * 2 + ih + 24), "white")
        sheet.paste(top.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, 0))
        sheet.paste(middle.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, bh + 8))
        for i, (im, box) in enumerate(crops):
            sheet.paste(im.crop(box).resize((iw, ih), Image.Resampling.NEAREST), (i * (iw + 8), bh * 2 + 16))
        return sheet

    compare = layout(current, cand, [(current, irises[0]), (cand, irises[0]), (current, irises[1]), (cand, irises[1])])
    base = current.convert("L").point(lambda v: v // 3 + 60).convert("RGB")
    p = base.load()
    for x, y in changed:
        p[x, y] = (min(255, 90 + max(abs(c[x, y][i] - n[x, y][i]) for i in range(3)) * 4), 30, 30)
    diff = layout(current, base, [(current, irises[0]), (base, irises[0]), (current, irises[1]), (base, irises[1])])
    for path, im in zip(LOVELY_CANDIDATE_FILES, (cand, compare, diff)):
        with open(path, "xb") as fp:  # "x": 파일이 이미 있으면 열지 않고 오류를 냅니다 (덮어쓰기 방지)
            im.save(fp, format="PNG")
    with Image.open(LOVELY_CANDIDATE_FILES[0]) as f:
        if f.get_flattened_data() != cand.get_flattened_data():
            sys.exit("lovely: 저장한 후보 파일을 다시 읽은 픽셀이 다릅니다.")
    check_recorded_outputs("LOVELY 후보 만든 후", SESSION_PROTECTED_SHA256)

    med = lambda s: s[len(s) // 2]
    print(f"0.4 대비 바뀐 픽셀 {len(changed)}개 (모두 렌즈 마스크 {len(lens_area)}개 안), 원본 대비 최대 밝기 변화 {y_shift:.2f}")
    print(f"바뀐 픽셀 채도 중앙값: 원본 {med(s0):.3f} → 0.4 {med(s4):.3f} → 0.6 {med(s6):.3f}")
    for q in ((44, 102), (52, 104), (143, 102), (153, 103)):
        print(f"  {q}: 원본 #{'%02X%02X%02X' % o[q]} → 0.4 #{'%02X%02X%02X' % c[q]} → 0.6 #{'%02X%02X%02X' % n[q]}")
    for path in LOVELY_CANDIDATE_FILES:
        print(f"{path.relative_to(ROOT)}: SHA-256 {sha256(path)}")
    return len(changed)


def lens_tone(c):
    """(밝기, 채도, 색상각°). 색상각은 Cr/Cb 각도로 클수록 노란빛, 작을수록 붉은빛입니다."""
    y, cb, cr = to_ycc(c)
    return y, math.hypot(cb, cr) / max(y, 1), math.degrees(math.atan2(cr, cb))


def lens_medians(img, pixels):
    """좌표 목록의 (밝기, 채도, 색상각) 중앙값."""
    px = img.load()
    tones = [lens_tone(px[p]) for p in pixels]
    return tuple(sorted(t[i] for t in tones)[len(tones) // 2] for i in range(3))


def iris_sample(center):
    """다른 무드와 같은 기준으로 비교할 홍채 표본 좌표: 중심에서 10px 안, y 97~106 (밝기 조건은 lens_reference_medians에서)."""
    cx, cy = center
    return [(x, y) for y in range(97, 107) for x in range(int(cx) - 11, int(cx) + 12) if (x - cx) ** 2 + (y - cy) ** 2 <= 100]


def lens_reference_medians(img, centers):
    """홍채 표본 중 밝기 35~130인 픽셀의 (밝기, 채도, 색상각) 중앙값. 다른 무드 렌즈와 비교하는 데 씁니다."""
    px = img.load()
    pixels = [p for c in centers for p in iris_sample(c) if 35 < luma(px[p]) < 130]
    return lens_medians(img, pixels)


def recolor_lovely_irises_glowy(img, cand):
    """현재 0.4와 같은 마스크·보호 조건에서, 밝기를 결에 따라 낮추고(글로이) 색 성분을 딥 브라운 쪽으로 옮깁니다. (결과, 렌즈 마스크)."""
    out = img.copy()
    src, dst = img.load(), out.load()
    _, mask = lovely_lens_masks(img)
    m = mask.load()
    ty, tcb, tcr = to_ycc(cand["target"])
    ring_from, ring_to, ring_gain = cand["ring"]
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            if not m[x, y]:
                continue
            py, pcb, pcr = to_ycc(src[x, y])
            wt = tone_weight(py) * ramp(saturation(src[x, y]), *LOVELY_SAT)
            if not wt:
                continue
            cx, cy = LOVELY_IRISES[0 if x < SIZE[0] // 2 else 1]
            gain = cand["gain"][0] + (cand["gain"][1] - cand["gain"][0]) * ramp(py, *LOVELY_GLOWY_GAIN_LUMA)
            gain *= 1 + (ring_gain - 1) * ramp(math.hypot(x - cx, y - cy), ring_from, ring_to)
            ny = max(py * (1 + (gain - 1) * wt), min(py, LOVELY_GLOWY_FLOOR))
            k = ny / py  # 어두워진 만큼 원래 색 성분도 줄여 채도를 유지한 뒤 목표색 쪽으로 옮깁니다
            w = cand["strength"] * wt
            cb = pcb * k + (tcb * ny / ty - pcb * k) * w
            cr = pcr * k + (tcr * ny / ty - pcr * k) * w
            dst[x, y] = from_ycc(ny, cb, cr)
    return out, mask


def make_lovely_glowy_candidates():
    """원본 lovely.png로 글로이 블랙 브라운 후보 A·B와, 현재 0.4와의 비교·차이 이미지를 새 파일로 만듭니다.
    아이라인은 현재 0.4와 같은 함수(restyle_lovely_tails)로 처리합니다. 파일이 이미 있으면 중단합니다. EDITS·현재 결과물은 바꾸지 않습니다.
    호출: .venv/bin/python -c 'import runpy; runpy.run_path("dev/edit-moods.py")["make_lovely_glowy_candidates"]()'"""
    existing = [p for p in LOVELY_GLOWY_FILES.values() if p.exists()]
    if existing:
        sys.exit("이미 있는 파일이라 덮어쓰지 않고 중단합니다: " + ", ".join(str(p.relative_to(ROOT)) for p in existing))
    protected = {**SESSION_PROTECTED_SHA256, **LOVELY_CURRENT_SHA256, **LOVELY_CANDIDATE_SHA256}
    check_recorded_outputs("글로이 후보 만들기 전", protected)
    with Image.open(SRC_DIR / "lovely.png") as f:
        orig = f.copy()
    with Image.open(OUT_DIR / "lovely.png") as f:
        current = f.copy()
    redo, _, _ = edit_lovely(orig)
    if redo.get_flattened_data() != current.get_flattened_data():
        sys.exit("lovely: 다시 만든 0.4 결과가 현재 수정본과 픽셀이 다릅니다. 중단합니다.")

    o, c = orig.load(), current.load()
    results, notes = {}, []
    for key, cand in LOVELY_GLOWY_CANDIDATES.items():
        lens, lens_mask = recolor_lovely_irises_glowy(orig, cand)
        made, _ = restyle_lovely_tails(lens)
        n, m = made.load(), lens_mask.load()
        rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if not m[x, y]]
        check_unchanged(f"글로이 {key} 렌즈 밖(아이라인 포함, 0.4 대비)", current, made, rest)
        check_unchanged(f"글로이 {key} 보호 좌표(0.4 대비)", current, made, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
        check_unchanged(f"글로이 {key} 보호 좌표(원본 대비)", orig, made, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
        changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if o[x, y] != n[x, y] and m[x, y]]
        if not changed:
            sys.exit(f"글로이 {key}: 렌즈에서 바뀐 픽셀이 없습니다. 중단합니다.")
        too_dark = [p for p in changed if luma(n[p]) <= PUPIL_MAX_Y]
        if too_dark:
            sys.exit(f"글로이 {key}: 동공 밝기({PUPIL_MAX_Y}) 이하로 어두워진 홍채 픽셀 {len(too_dark)}개 (예: {too_dark[:5]}). 중단합니다.")
        y_med, s_med, h_med = lens_medians(made, changed)
        (y_lo, y_hi), s_min, (h_lo, h_hi) = cand["check"]
        if not (y_lo <= y_med <= y_hi and s_med >= s_min and h_lo <= h_med <= h_hi):
            sys.exit(f"글로이 {key}: 색 범위를 벗어났습니다 (밝기 {y_med:.1f}, 채도 {s_med:.3f}, 색상각 {h_med:.1f}°; "
                     f"기준 밝기 {y_lo}~{y_hi}, 채도 {s_min} 이상, 색상각 {h_lo}~{h_hi}°). 중단합니다.")
        ref = lens_reference_medians(made, LOVELY_IRISES)
        results[key] = made
        notes.append(f"{key} {cand['name']}: 0.4 대비 렌즈 밖 변경 0개, 원본 대비 바뀐 픽셀 {len(changed)}개 "
                     f"(밝기 {y_med:.0f}, 채도 {s_med:.3f}, 색상각 {h_med:.0f}°) / 다른 무드와 같은 기준 {ref[0]:.0f}·{ref[1]:.3f}·{ref[2]:.0f}°")

    # 비교 이미지: 눈 띠 6배 3줄(0.4 / A / B), 홍채 12배(왼쪽 눈 0.4 | A | B, 오른쪽 눈 0.4 | A | B), 참고 줄(PURE | NUDE | MODERN 왼쪽 홍채)
    band, zoom, iris_zoom, half = (0, 64, 201, 114), 6, 12, 14
    bw, bh = (band[2] - band[0]) * zoom, (band[3] - band[1]) * zoom
    iw = ih = half * 2 * iris_zoom
    iris_box = lambda cx: (round(cx) - half, 96 - half, round(cx) + half, 96 + half)
    references = []
    for label, path, center in LOVELY_GLOWY_REFERENCES:
        with Image.open(path) as f:
            ref_img = f.copy()
        references.append((ref_img, iris_box(center[0])))
        r = lens_reference_medians(ref_img, [center])
        notes.append(f"참고 {label}: 밝기 {r[0]:.0f}, 채도 {r[1]:.3f}, 색상각 {r[2]:.0f}°")

    def sheet(bands, iris_rows):
        width = max(bw, 6 * (iw + 8))
        out = Image.new("RGB", (width, (bh + 8) * len(bands) + (ih + 8) * len(iris_rows)), "white")
        top = 0
        for im in bands:
            out.paste(im.crop(band).resize((bw, bh), Image.Resampling.NEAREST), (0, top))
            top += bh + 8
        for row in iris_rows:
            for i, (im, box) in enumerate(row):
                out.paste(im.crop(box).resize((iw, ih), Image.Resampling.NEAREST), (i * (iw + 8), top))
            top += ih + 8
        return out

    a, b = results["A"], results["B"]
    eyes = [iris_box(LOVELY_IRISES[0][0]), iris_box(LOVELY_IRISES[1][0])]
    compare = sheet([current, a, b], [[(im, eyes[0]) for im in (current, a, b)] + [(im, eyes[1]) for im in (current, a, b)],
                                      references])
    diffs = []
    for made in (a, b):  # 흐린 0.4 위에 바뀐 픽셀을 빨강으로 (진할수록 많이 바뀜)
        base = current.convert("L").point(lambda v: v // 3 + 60).convert("RGB")
        p, n = base.load(), made.load()
        for y in range(SIZE[1]):
            for x in range(SIZE[0]):
                delta = max(abs(c[x, y][i] - n[x, y][i]) for i in range(3))
                if delta:
                    p[x, y] = (min(255, 90 + delta * 4), 30, 30)
        diffs.append(base)
    diff = sheet(diffs, [[(diffs[0], eyes[0]), (diffs[1], eyes[0]), (diffs[0], eyes[1]), (diffs[1], eyes[1])]])
    outputs = {"A": a, "B": b, "compare": compare, "diff": diff}
    for key, path in LOVELY_GLOWY_FILES.items():
        with open(path, "xb") as fp:  # "x": 파일이 이미 있으면 열지 않고 오류를 냅니다 (덮어쓰기 방지)
            outputs[key].save(fp, format="PNG")
    for key in ("A", "B"):
        with Image.open(LOVELY_GLOWY_FILES[key]) as f:
            if f.get_flattened_data() != outputs[key].get_flattened_data():
                sys.exit(f"글로이 {key}: 저장한 파일을 다시 읽은 픽셀이 다릅니다.")
    check_recorded_outputs("글로이 후보 만든 후", protected)

    for note in notes:
        print(note)
    for key, path in LOVELY_GLOWY_FILES.items():
        print(f"{path.relative_to(ROOT)}: SHA-256 {sha256(path)}")
    return notes


def edit_lovely_v2(img):
    """LOVELY 최종: 렌즈는 글로이 A, 아이라인은 버전 1과 같은 함수. 승인한 후보 파일·버전 1 백업과 픽셀을 대조합니다."""
    check_recorded_outputs("LOVELY 최종 편집 전", LOVELY_FINAL_RUN_PROTECTED_SHA256)
    cand = LOVELY_GLOWY_CANDIDATES[LOVELY_FINAL_GLOWY]
    lens, lens_mask = recolor_lovely_irises_glowy(img, cand)
    out, tail_mask = restyle_lovely_tails(lens)
    approved = LOVELY_GLOWY_FILES[LOVELY_FINAL_GLOWY]
    for path, expected, label in ((approved, LOVELY_GLOWY_A_SHA256, "승인한 글로이 A 후보"), (LOVELY_V1_BACKUP, LOVELY_V1_SHA256, "버전 1 백업")):
        if sha256(path) != expected:
            sys.exit(f"lovely: {label}({path.relative_to(ROOT)})의 SHA-256이 기록값과 다릅니다. 중단합니다.")
    with Image.open(approved) as f:
        if f.mode != "RGB" or f.size != SIZE or f.get_flattened_data() != out.get_flattened_data():
            sys.exit("lovely: 다시 만든 결과가 승인한 글로이 A 후보와 픽셀이 다릅니다. 중단합니다.")
    with Image.open(LOVELY_V1_BACKUP) as f:
        v1 = f.copy()
    m = lens_mask.load()
    rest = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if not m[x, y]]
    check_unchanged("lovely 최종 렌즈 밖(아이라인 포함, 버전 1 대비)", v1, out, rest)
    check_unchanged("lovely 최종 보호 좌표(원본 대비)", img, out, LOVELY_LENS_KEEP | LOVELY_LID_PIXELS)
    o, n = img.load(), out.load()
    changed = [(x, y) for y in range(SIZE[1]) for x in range(SIZE[0]) if m[x, y] and o[x, y] != n[x, y]]
    if not changed or any(luma(n[p]) <= PUPIL_MAX_Y for p in changed):
        sys.exit("lovely: 렌즈 변경이 없거나 동공 밝기 이하로 어두워진 홍채 픽셀이 있습니다. 중단합니다.")
    y_med, s_med, h_med = lens_medians(out, changed)
    (y_lo, y_hi), s_min, (h_lo, h_hi) = cand["check"]
    if not (y_lo <= y_med <= y_hi and s_med >= s_min and h_lo <= h_med <= h_hi):
        sys.exit(f"lovely: 렌즈 색 범위를 벗어났습니다 (밝기 {y_med:.1f}, 채도 {s_med:.3f}, 색상각 {h_med:.1f}°). 중단합니다.")
    tail_changed = count_nonzero(changed_pixels(lens, out))
    notes = [f"승인한 글로이 A 후보(lovely-glowyA.png)와 픽셀까지 같음",
             f"렌즈 밖 {len(rest)}개(아이라인 포함): 버전 1(0.4)과 RGB 같음, 보호 좌표: 원본과 RGB 같음",
             f"렌즈: 바뀐 픽셀 {len(changed)}개 (밝기 {y_med:.0f}, 채도 {s_med:.3f}, 색상각 {h_med:.0f}°), 꼬리: 바뀐 픽셀 {tail_changed}개"]
    return out, ImageChops.lighter(lens_mask, tail_mask), notes


EDITS = {"pure": edit_pure, "chic": edit_chic, "nude": edit_nude}
EDITS["modern"] = edit_modern
EDITS["chic"] = edit_chic_v2  # 기존 edit_chic(버전 1)은 그대로 두고, chic 실행 시 버전 1에서 꼬리 끝만 줄인 v2를 만듭니다
EDITS["lovely"] = edit_lovely
EDITS["nude"] = edit_nude_v2  # 기존 edit_nude(버전 1)은 그대로 두고, nude 실행 시 줄였던 꼬리 끝만 원본 길이로 되돌린 v2를 만듭니다
EDITS["chic"] = edit_chic_v3  # edit_chic·edit_chic_v2는 그대로 두고, chic 실행 시 v2보다 꼬리를 0.5~1px 더 줄인 v3를 만듭니다
EDITS["lovely"] = edit_lovely_v2  # edit_lovely(0.4)는 그대로 두고, lovely 실행 시 글로이 A 렌즈 + 버전 1 아이라인 최종본을 만듭니다


def main():
    names = list(dict.fromkeys(sys.argv[1:] or EDITS))  # 같은 이름을 두 번 적어도 한 번만 처리합니다
    if OUT_DIR.resolve() == SRC_DIR.resolve():
        sys.exit("출력 폴더가 원본 폴더와 같습니다. 중단합니다.")
    unknown = [name for name in names if name not in EDITS]
    if unknown:
        sys.exit(f"모르는 무드 이름입니다: {unknown}. 가능한 이름: {list(EDITS)}")
    # 이미 있는 수정본·비교 이미지는 덮어쓰지 않습니다. 하나라도 있으면 아무것도 처리하지 않고 멈춥니다.
    # 다시 만들려면 승인을 받은 뒤 기존 파일을 먼저 옮겨야 합니다.
    existing = [path for name in names
                for path in (OUT_DIR / f"{name}.png", PREVIEW_DIR / f"{name}-compare.png", PREVIEW_DIR / f"{name}-diff.png")
                if path.exists()]
    if existing:
        sys.exit("이미 있는 파일이라 덮어쓰지 않고 중단합니다: " + ", ".join(str(p.relative_to(ROOT)) for p in existing))
    failed = False
    for name in names:
        src_path, out_path = SRC_DIR / f"{name}.png", OUT_DIR / f"{name}.png"
        before = sha256(src_path)
        with Image.open(src_path) as f:
            if f.format != "PNG" or f.mode != "RGB" or f.size != SIZE:
                sys.exit(f"{name}: 원본 형식이 예상과 다릅니다 ({f.format}, {f.mode}, {f.size})")
            orig = f.copy()

        edit, mask, notes = EDITS[name](orig)

        changed = changed_pixels(orig, edit)
        outside = ImageChops.multiply(changed, mask.point(lambda v: 0 if v else 255))
        n_outside = count_nonzero(outside)
        n_inside = count_nonzero(changed)
        max_delta = max(max(abs(a[i] - b[i]) for i in range(3)) for a, b in zip(orig.get_flattened_data(), edit.get_flattened_data()))
        print(f"[{name}] 원본 SHA-256 (작업 전): {before}")
        print(f"[{name}] 바뀐 픽셀: 마스크 안 {n_inside}개, 마스크 밖 {n_outside}개, 바뀐 영역 {changed.getbbox()}, 최대 변화량 {max_delta}")
        for note in notes:
            print(f"[{name}] {note}")
        if n_outside:
            print(f"[{name}] 실패: 마스크 밖 픽셀이 바뀌었습니다. 저장하지 않습니다.")
            failed = True
            continue

        OUT_DIR.mkdir(exist_ok=True)
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        if out_path.resolve().parent != (ROOT / "assets" / "moods" / "edit").resolve():
            sys.exit(f"{name}: 저장 위치가 assets/moods/edit/가 아닙니다 ({out_path}). 중단합니다.")
        with open(out_path, "xb") as fp:  # "x": 파일이 이미 있으면 열지 않고 오류를 냅니다 (덮어쓰기 방지)
            edit.save(fp, format="PNG")
        make_previews(name, orig, edit, mask)

        with Image.open(out_path) as f:
            ok = f.format == "PNG" and f.mode == "RGB" and f.size == SIZE and f.get_flattened_data() == edit.get_flattened_data()
        after = sha256(src_path)
        print(f"[{name}] 수정본: {out_path.relative_to(ROOT)} ({'형식·크기·픽셀 확인 OK' if ok else '확인 실패'}), SHA-256 {sha256(out_path)}")
        print(f"[{name}] 원본 SHA-256 (작업 후): {after} ({'같음' if after == before else '달라짐!'})")
        failed |= not ok or after != before
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
