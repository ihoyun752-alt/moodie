# 제품 사진 출처 기록 (사용 권한 확인 대기)

사용 권한이 확인되지 않은 제품 사진의 출처를 모아 두는 문서입니다. 기준은 `docs/product-database-design.md` 5절 "이미지"를 따릅니다.

- 이 문서에 적은 사진은 **저장소에 저장하지 않고, `data/products.csv`의 `product_image` 칸에도 적지 않습니다.**
- 사용 권한이 확인되면 허락 근거와 함께 `licensed`로 등록하고, 이 문서의 상태를 바꿉니다.
- 확인일: 2026-11-01 (상품 페이지를 텍스트로 조회해 주소만 기록했으며, 이미지 파일은 내려받지 않았습니다.)

## 사용 권한 근거: 롬앤 공식몰 이용약관

출처: https://romand.co.kr/member/mall_agreement.html (2026-11-01 확인)

> **제22조(저작권의 귀속 및 이용제한)**
> ① "몰"이 작성한 저작물에 대한 저작권 기타 지적재산권은 "몰"에 귀속합니다.
> ② 이용자는 "몰"을 이용함으로써 얻은 정보 중 "몰"에게 지적재산권이 귀속된 정보를 "몰"의 사전 승낙 없이 복제, 송신, 출판, 배포, 방송 기타 방법에 의하여 영리목적으로 이용하거나 제3자에게 이용하게 하여서는 안됩니다.

- 공식몰 푸터 표기: © 2023. iFamilySC Co., Ltd. all rights reserved.
- 공개 GitHub 저장소에 사진 파일을 올리는 것은 복제·배포에 해당할 수 있고, 이를 허락한 근거를 찾지 못했습니다.
- 따라서 아래 사진은 모두 **사용 권한 확인 필요** 상태입니다. 브랜드의 사전 승낙(메일 등)을 받기 전에는 `licensed`로 처리하지 않습니다.

## 공통 사항

- 다섯 상품 페이지 모두 **셰이드별 이미지가 따로 연결되어 있지 않습니다.** 옵션(셰이드) 목록은 글자로만 표시됩니다. 아래 대표 이미지가 어느 셰이드를 보여 주는지는 확인하지 않았습니다.
- 이미지 주소는 모두 아래 공통 경로로 시작합니다. 표에는 그 뒤의 경로만 적었습니다.
  - `https://cafe24.poxo.com/ec01/romand/6aDrbsrpgztyixM+aENnH1D89vbvN874SJZ0smDxiaa/k9zGF5hClK+Cdcc6Crl70h/a8RobAiR24eeOO4zRMg==/_/`
- 대표 이미지(`web/product/big/…`)만 적었습니다. 추가 이미지(`web/product/extra/big/…`)와 상세 설명 이미지(`web/upload/NNEditor/…`)는 개수만 적었습니다.
- 주소는 페이지를 텍스트로 변환해 옮긴 것이므로, 실제로 사용할 때는 상품 페이지에서 다시 확인합니다.

## 롬앤 제품별 출처

| 그룹 | 제품 | 해당 셰이드 행 | 상품 페이지 | 대표 이미지 (공통 경로 뒤) | 추가 이미지 | 사용 권한 |
|---|---|---|---|---|---|---|
| MD-0001 | 제로 매트 립스틱 #오리지널 | MD-0001-01 (02 올 댓 재즈), MD-0001-02 (09 쉘 누드), MD-0001-03 (20 레드 다이브) | https://romand.co.kr/product/롬앤-제로-매트-립스틱-오리지널/516/category/290/display/1/ | `web/product/big/202309/dbdd255a0a2f9c5fe474525da5fb1ef0.jpg`<br>`web/product/big/202309/2f1fef078a6a0a69fbca4f6ae757375e.jpg` | extra 20장, 상세 설명 이미지 있음 | 확인 필요 |
| MD-0002 | 블러 퍼지 틴트 #오리지널 | MD-0002-01 (01 포멜로코), MD-0002-02 (05 비비 캔디), MD-0002-03 (07 쿨 로즈 업) | https://romand.co.kr/product/롬앤-블러-퍼지-틴트-오리지널/692/category/290/display/1/ | `web/product/big/202309/b239662baf241fb91c6ded2bbc649ed7.jpg`<br>`web/product/big/202309/c04b6480ac848bd8448740f0b42a7030.jpg` | extra 8장, 상세 설명 이미지 있음 | 확인 필요 |
| MD-0003 | 글래스팅 워터 글로스 | MD-0003-01 (00 메테오 트랙) | https://romand.co.kr/product/롬앤-글래스팅-워터-글로스/451/category/289/display/1/ | `web/product/big/202309/2fa3517333aca31c43a653fe39f639c7.jpg`<br>`web/product/big/202309/220bfd1ac43faeb7139ba7acb474e744.jpg` | extra 6장 | 확인 필요 |
| MD-0004 | 듀이풀 워터 틴트 #오리지널 | MD-0004-01 (02 솔티 피치) | https://romand.co.kr/product/롬앤-듀이풀-워터-틴트-오리지널/600/category/289/display/1/ | `web/product/big/202309/378a26356340a9c2bd7c29826a9a21ec.jpg`<br>`web/product/big/202309/4aca31b4c195d555cbb943b0dc015ce5.jpg` | extra 12장 | 확인 필요 |
| MD-0005 | 글래스팅 멜팅 밤 #오리지널 | MD-0005-01 (02 러비 핑크), MD-0005-02 (06 카야 피그) | https://romand.co.kr/product/롬앤-글래스팅-멜팅-밤-오리지널/655/category/289/display/1/ | `web/product/big/202309/8c06f9ba91914deaae8a2da78051316b.jpg`<br>`web/product/big/202309/4238966305cb7b9e3bce1947e6815a24.jpg` | extra 8장, 상세 설명 이미지 있음 | 확인 필요 |

## 결정 사항 (2026-11-01)

- 이 프로젝트는 비상업적 수업 제출용 시제품이므로, 현재 단계에서는 브랜드에 사진 사용 허락을 요청하지 않습니다.
- 위 공식 사진은 **사용하지 않습니다.** 사용 권한 상태는 계속 "확인 필요"로 둡니다.
- 대신 패키지와 발색 스와치를 한 장에 담은 AI 생성 이미지(`ai-generated`)를 셰이드마다 만들어 씁니다. 기준은 `docs/product-database-design.md` 5절 "AI 합성 이미지 규칙"을 따릅니다.
- 롬앤 10개 셰이드에 적용했습니다(`assets/products/romand/`). 이미지 안에 글자·브랜드명은 없지만, 패키지 모양이 실제 제품과 매우 비슷하고 원형 각인 2건이 있어 검수 기록을 `docs/image-credits.md`에 남겼습니다.
- 앞으로 브랜드 허락을 받거나 직접 촬영한 사진이 생기면 `licensed` 또는 `own-photo`로 바꿀 수 있습니다.
