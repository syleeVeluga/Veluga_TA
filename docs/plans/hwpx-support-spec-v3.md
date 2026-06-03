# 21 — HWPX (한글 문서) 지원 빌트인 스킬 아키텍처 설계 (v3, 최종)

> Status: 📝 계획 (v3, 2026-06-03) · 이력: [원안](hwp-hwpx-support-spec.md) → [검토 의견서](hwp-hwpx-support-review.md) → [v2](hwp-hwpx-support-spec-v2.md) → **v3(최종)**
> 목표 한 줄: 개방형 표준 한글 문서 **`.hwpx`** 를 **오프라인 샌드박스에서** 읽고(Read) 템플릿 기반으로 생성(Write)하는 스킬을, **docx와 동일한 독립 빌트인 아티팩트 스킬**로 제공한다.

> **v3 변경(v2 대비)**
> 1. **HWPX 전용으로 범위 축소** — `.hwp`(바이너리) 읽기/쓰기 전면 제외. 복잡도(레코드 파싱, pyhwp 표 손실, JVM/LibreOffice 의존)를 제거.
> 2. **gov-proposal과 비연결** — 도메인 스킬에 의존성으로 묶지 않고, **docx처럼 `.hwpx` 작업 시 설명(description) 매칭으로 자동 활성화**되는 독립 빌트인으로 동작.
> 3. **macOS 포함 크로스플랫폼 동작 근거 명시** (§6).
> 4. 텍스트 경로는 Python 표준 라이브러리만으로 동작. `soffice`는 PDF 미리보기/검증용 **선택적** 도구(없으면 skip).
> 5. **(2026-06-03 보완) 표·중첩표·병합셀을 1급 요구사항으로 반영** — 공공·금융 문서 특성상 표 사용 빈도가 매우 높아, 표 작성을 재귀 구조로 정식 설계(§2.2·§5.4)하고, 직접 구현 부담을 줄이기 위해 순수 파이썬 `python-hwpx`(Apache-2.0) 채택을 권장(§3).

---

## 1. 개요 및 범위

Veluga는 대한민국 공공기관·금융 환경을 주 타깃으로 하는 엔터프라이즈 AI 에이전트 플랫폼이다. 국내 업무 표준인 한글 문서를 1급 시민으로 다루기 위해, **개방형 국가표준 포맷인 `.hwpx`** 를 docx 빌트인 스킬과 동일한 *unpack → edit XML → repack* 패턴으로 읽고 쓰는 스킬을 정의한다.

**범위(In scope)**
- `.hwpx` 신규 생성 / 기존 `.hwpx` 편집(레이아웃·스타일 보존) / `.hwpx` 텍스트·표 추출(→ Markdown, KB 주입).

**비범위(Out of scope, v3)**
- `.hwp`(한글 5.0 바이너리) 읽기·쓰기. 사유: OLE 복합파일 + 레코드 스트림 해석은 복잡도가 크고, 가용 도구(pyhwp)는 표 텍스트 손실 버그가 있으며, 대안(hwp2hwpx/hwplib)은 JVM 의존을 끌어들인다. 현 단계의 ROI가 낮다.
- 처리 정책: 입력이 `.hwp`이면 스킬은 **"`.hwpx`로 저장 후 다시 시도"** 안내만 하고 변환은 시도하지 않는다(향후 별도 확장으로 분리).

> 개방형 표준이라 비용·라이선스·외부 트래픽 없이 처리 가능한 `.hwpx`에 집중하는 것이, 한글 지원의 80% 가치를 20% 복잡도로 확보하는 길이다. 실제로 공공기관의 신규 문서는 HWPX 저장이 확산 중이다.

---

## 2. 기술 분석: HWPX 포맷

`.hwpx`는 국가표준 **KS X 6101 (OWPML, 2011-12-30 제정)** 을 따르는 ZIP+XML 개방형 포맷이다. 한컴이 포맷 자료를 공개하며, 한컴 공식 튜토리얼도 **Python 표준 라이브러리(`zipfile` + `xml.etree.ElementTree`)만으로** 파싱한다 → 외부 의존성·트래픽 0 목표가 실현 가능하다.

### 2.1 패키지 구성요소 (한컴 공식 기준)

| 경로 | 역할 | 생성 시 주의 |
| :--- | :--- | :--- |
| `mimetype` | HWPX 시그니처 | **ZIP 첫 엔트리 + 무압축(STORED)** 필수 (OPC/EPUB·ODF 규약) |
| `version.xml` | OWPML 버전·저장 환경 | 템플릿 값 유지 |
| `settings.xml` | 커서 위치(CaretPosition) 등 | 통상 유지 |
| `Contents/content.hpf` | **OPF**: `metadata`·`manifest`·`spine`. 모든 파트가 manifest에 등재되고 spine 순서로 읽힘 | 파트 추가 시 manifest/spine 갱신 |
| `Contents/header.xml` | 글자·문단 모양 매핑(Shape Table)·호환성·변경추적. 루트 `<hh:head>` | 스타일 ID 참조 무결성 유지 |
| `Contents/section{N}.xml` | 구역 본문. 루트 로컬명 **`sec`**(`hs` 네임스페이스). 본문은 `<hp:p> → <hp:run> → <hp:t>` | 구역 추가 시 `secCnt`·manifest 동기화 |
| `META-INF/{container.xml, manifest.xml, container.rdf}` | 컨테이너 목록 / (암호 시) 암호화 정보 | 유지 |
| `BinData/`, `Preview/`, `Scripts/` | 이미지·OLE / 미리보기 / 스크립트 | 이미지 삽입 시 BinData + manifest 동시 갱신 |

> 기본 글꼴: **함초롬바탕(serif) / 함초롬돋움(sans)** — HWPX 기본값(맑은 고딕 아님).
> 네임스페이스 URI는 파트·버전별(2011/2016/2021/2023)로 다를 수 있어 **반드시 런타임에 동적 추출**해 사용한다(§5.2).

### 2.2 본문 논리 구조와 표·중첩표 (KS X 6101 기준)

KS X 6101(10.2)이 정의하는 본문 논리 구조는 **본문 → 구역(sec) → 문단(p) → run → 콘텐츠**다. 핵심은 표가 텍스트와 같은 레벨의 **`run`의 하위 콘텐츠**(`run`의 choice: `t` | `tbl` | `pic` | `ctrl` …)라는 점이며, 표준은 *"표·글상자 같은 특수한 경우 문단은 다시 **문단 목록(ParaList)** 을 가질 수 있다"* 고 명시한다. 이 ParaList가 셀 내부의 `subList`이고, 그 안의 문단이 다시 표를 가질 수 있으므로 **중첩표(표 안의 표)는 별도 장치 없이 재귀로 표현**된다.

```
sec
└ hp:p (문단, paraPrIDRef)
   └ hp:run (charPrIDRef)
      ├ hp:t            ← 텍스트
      └ hp:tbl          ← 표(TableType): rowCnt·colCnt·borderFillIDRef
         └ hp:tr        ← 행
            └ hp:tc     ← 셀
               ├ hp:cellAddr   (colAddr, rowAddr)        ← 격자 좌표
               ├ hp:cellSpan   (colSpan, rowSpan)        ← 병합(merged)
               ├ hp:cellSz     (width, height)           ← 셀 크기(명시 필요)
               ├ hp:cellMargin
               └ hp:subList    ← 셀 내용 = ParaList
                  └ hp:p
                     └ hp:run
                        ├ hp:t        ← 셀 텍스트
                        └ hp:tbl      ← ★ 중첩표(재귀)
```

표 작성 시 주의점(공공·금융 양식에서 빈번):
- **병합 셀**: 병합의 기준 셀이 `cellSpan`(colSpan/rowSpan>1)을 갖고, 병합에 흡수된 셀은 **생략**된다. 읽기 시 격자 복원, 쓰기 시 흡수 셀 누락 + `cellAddr` 정합이 필요하다.
- **참조 무결성**: `tbl`의 `borderFillIDRef`, 셀 문단의 `paraPrIDRef`/`charPrIDRef`는 모두 `header.xml`의 매핑 테이블 ID를 참조한다. 제로 베이스로 표를 만들면 이 참조가 깨지므로 **스타일이 갖춰진 표 템플릿을 복제**하는 방식이 안전하다.
- **셀 크기**: HWPX는 `cellSz`·표 전체 크기를 명시값으로 요구한다. 행·열을 동적으로 늘리면 크기 재계산이 필요하며, 이 부분이 직접 구현 시 가장 큰 난점이다.

---

## 3. 라이브러리 선정 (오프라인·크로스플랫폼)

표 사용 빈도가 높은 현실(§2.2)을 반영해, **표 작성은 검증된 순수 파이썬 라이브러리에 위임**하고 stdlib는 단순 텍스트 경로의 무의존 폴백으로 둔다.

| 용도 | 채택 | 비고 |
| :--- | :--- | :--- |
| **표·중첩표·병합·양식채우기 (권장 코어)** | **`python-hwpx`** (Apache-2.0, 순수 Python + lxml) | N×M 표 생성, 셀 병합/분할, **중첩 테이블**, 라벨 기반 셀 탐색·`fill_by_path`, XSD/패키지 검증, HWPML 2016→2011 네임스페이스 자동 정규화. macOS/Linux/Windows/CI 지원 |
| **HWPX 읽기/추출** | `python-hwpx` `export_markdown()`/`export_html()`/`TextExtractor` (또는 stdlib `zipfile`+`ElementTree`) | 표를 HTML `<table>`(colspan/rowspan)로 보존 추출 가능 |
| **단순 텍스트 생성 (무의존 폴백)** | 완전한 베이스 템플릿 + stdlib XML 치환(Static Hydration, §5) | lxml도 불가한 환경의 폴백 |
| **(선택) PDF 미리보기/검증** | LibreOffice `soffice --headless --convert-to pdf` | **선택적**. 없으면 skip. docx/pptx/xlsx와 동일 패턴 |

> **의존성 트레이드오프(중요)**: 표·중첩표·병합셀을 stdlib만으로 직접 구현하려면 `cellAddr`/`cellSpan`/`cellSz` 재계산과 `header.xml` 참조 무결성을 모두 손으로 관리해야 해 난이도·버그 위험이 매우 크다. `python-hwpx`는 이 영역을 이미 해결했고 Apache-2.0·순수 파이썬(C 확장은 lxml 1개)·완전 오프라인이라, **표 중심 요구를 고려하면 채택 이득이 분명하다.** "외부 트래픽 0" 원칙은 그대로 유지되며(로컬 라이브러리), 기존 "stdlib only" 문구는 "오프라인·최소 의존(lxml)"으로 완화한다.
>
> **알려진 제약(반드시 인지)**: `python-hwpx`는 (a) `<hp:pic>` 완전 자동 생성·복잡 도형(add_shape/add_control)은 미완, (b) 암호화 HWPX 미지원, (c) `.hwp` 미지원(v3 범위와 동일). 즉 **표·텍스트·양식은 강력하나 이미지/도형이 많은 문서는 한/글에서 검증 필요.**
>
> **선행 사례/스택**: 동일 저자가 `python-hwpx`(라이브러리) + [`hwpx-mcp-server`](https://github.com/airmang/hwpx-mcp-server)(MCP) + [`hwpx-skill`](https://github.com/airmang/hwpx-skill)(에이전트 온보딩 스킬)로 구성된 3종 스택을 제공한다. 우리 빌트인 스킬은 **`hwpx-skill`을 출발점으로 차용/적응**하는 것을 우선 검토한다(라이선스·코드 품질 별도 실사). 또 다른 참고: [`mzoryy/hwpxskill`](https://github.com/mzoryy/hwpxskill)(직접 XML 편집 + page_guard).

---

## 4. 빌트인 스킬 통합 설계 (docx와 동형, 독립)

HWPX 스킬은 docx/pptx/xlsx/pdf와 **같은 위치·같은 형식**의 독립 빌트인 아티팩트 스킬로 배치한다. **특정 도메인 스킬(gov-proposal)의 의존성으로 묶지 않는다.**

```
packages/cowork-core/.claude/skills/
└── hwpx/
    ├── SKILL.md                 # name/description/license (빌트인 포맷)
    ├── LICENSE.txt
    ├── reference/
    │   ├── owpml.md             # 네임스페이스 표·요소 맵·표준 참조
    │   └── tables.md            # 표/중첩표/병합셀 작성 패턴(§2.2·§5.4)
    ├── scripts/
    │   ├── extract_text.py      # .hwpx → markdown/HTML(표는 <table> colspan/rowspan 보존)
    │   ├── build_table.py       # N×M 표·병합·중첩표 생성 (python-hwpx 래퍼)
    │   ├── fill_form.py         # 라벨/경로 기반 양식 표 채우기 (fill_by_path)
    │   ├── hydrate.py           # 단순 텍스트 치환(stdlib 무의존 폴백)
    │   ├── pack.py / unpack.py  # mimetype STORED·최우선 재압축 / 해제 (폴백 경로용)
    │   └── validate.py          # XSD·패키지 무결성·페이지 수·라운드트립 검사
    └── templates/
        ├── base.hwpx            # 완전한 표준 양식 패키지(빈 문서)
        └── table_proto.hwpx     # 스타일·borderFill이 갖춰진 표 프로토타입
```

> 표 관련 스크립트(`build_table.py`/`fill_form.py`)는 `python-hwpx`의 `add_table`·`merge_cells`·`fill_by_path` API를 호출하는 얇은 래퍼다(§3). lxml 불가 환경에서는 `hydrate.py`(stdlib) 텍스트 경로로 graceful degrade 하되, 표 기능은 비활성된다는 점을 SKILL.md에 명시한다.

### ① `SKILL.md` (빌트인 포맷, docx와 동일 스키마)
```yaml
---
name: hwpx
description: "개방형 표준 한글 문서(.hwpx) 생성·편집·분석. ZIP+XML(OWPML) 구조를 직접 다뤄 본문/스타일을 보존한 채 내용을 갱신하고, 텍스트를 추출한다. 특히 공공·금융 양식에서 흔한 표 작업(N×M 표 생성, 셀 병합/분할, 표 안의 표=중첩표, 라벨 기반 양식 채우기)을 1급으로 지원. 오프라인 샌드박스에서 외부 호출 없이 동작. .hwpx 파일이 입력 또는 출력으로 관여하는 모든 작업(신규 생성, 기존 문서 편집, 표 작성, 텍스트 추출, docx 대안 산출 포맷)에 사용. 단, 구형 바이너리 .hwp는 미지원이며 .hwpx로 저장 후 사용 권장."
license: Proprietary. LICENSE.txt has complete terms
---
```

### ② 활성화 방식 = docx와 동일
- 정책 메타(clearance·KB scope)는 빌트인 스킬에 넣지 않는다.
- 에이전트가 `.hwpx` 관련 작업을 인지하면 **description 매칭으로 자동 선택**된다(docx가 `.docx` 작업에서 선택되는 것과 동일). 도메인 스킬에서 강제로 호출하는 의존 간선은 만들지 않는다.

### ③ 등록 (skill-resolver.ts) — docx와 동일 등급, gov-proposal 미변경
[`packages/veluga-main/src/agents/skill-resolver.ts`](../../packages/veluga-main/src/agents/skill-resolver.ts):
```ts
// SKILL_DEPENDENCIES
hwpx: [],                 // docx: [] 와 동일 (독립)

// SKILL_ORDER
hwpx: 6,                  // docx/pptx/xlsx 와 동일 단계

// WRITE_SKILLS 집합에 'hwpx' 추가
```
> ⚠️ `gov-proposal`의 `depends_on`은 **변경하지 않는다**(현행 `['style-card','citation-verifier','docx','compliance-checker']` 유지). gov-proposal은 사용자가 추가한 도메인 전용 스킬이며, hwpx는 docx처럼 범용으로 열려 있어 필요 시 에이전트가 알아서 선택한다.
> 정책의 `active_skill_ids`에 `hwpx`가 포함돼야 resolve된다(docx와 동일 전제).

---

## 5. 핵심 구현 메커니즘 (Static Hydration, Python)

완전한 베이스 템플릿을 두고 본문만 치환한다(제로 베이스 XML 조립은 참조 오류 위험으로 비채택).

### 5.1 mimetype-safe 재압축 (`pack.py` 핵심) — 샌드박스 검증 완료
```python
import zipfile, pathlib

def pack_hwpx(src_dir: str, out_path: str) -> None:
    src = pathlib.Path(src_dir)
    with zipfile.ZipFile(out_path, "w") as zf:
        # 1) mimetype: 반드시 첫 엔트리 + 무압축(STORED)
        zf.writestr(zipfile.ZipInfo("mimetype"),
                    (src / "mimetype").read_bytes(),
                    compress_type=zipfile.ZIP_STORED)
        # 2) 나머지는 DEFLATE
        for p in sorted(src.rglob("*")):
            if p.is_file() and p.name != "mimetype":
                zf.write(p, p.relative_to(src).as_posix(),
                         compress_type=zipfile.ZIP_DEFLATED)
```

### 5.2 네임스페이스 동적 처리 + 본문 치환 (`hydrate.py` 골자) — 샌드박스 검증 완료
```python
from io import BytesIO
import xml.etree.ElementTree as ET

def _namespaces(xml_bytes: bytes) -> dict:
    ns = {}
    for _, (prefix, uri) in ET.iterparse(BytesIO(xml_bytes), events=("start-ns",)):
        ns[prefix] = uri          # hwpml/2011 · owpml/2021|2023 등 혼재 → 동적 추출
    return ns

def set_section_text(section_xml: bytes, paragraphs: list[str]) -> bytes:
    ns = _namespaces(section_xml)
    for p, u in ns.items():
        ET.register_namespace(p, u)      # serialize 시 prefix 보존
    hp = ns["hp"]                         # paragraph URI (prefix 하드코딩 금지)
    root = ET.fromstring(section_xml)     # 구역 루트: {…/section}sec (검증: 로컬명 'sec')

    # 템플릿 첫 <hp:p>를 prototype으로 복제 → charPrIDRef/paraPrIDRef(서식 참조) 보존
    # {uri}local (Clark notation)로 탐색 → prefix 변화에 강건. <hp:t> 텍스트만 교체.
    ...
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)
```
> 검증 메모(2026-06-03 샌드박스): 위 동적 추출로 `hp`/`hs` URI를 정확히 얻고, Clark notation 탐색으로 `hp:t` 텍스트를 회수했으며, 구역 루트의 실제 로컬명이 **`sec`** 임을 확인. (원안 `getElementsByTagName('hs:section')`은 로컬명·prefix 가정이 모두 틀려 조용히 실패함)

### 5.3 본문 외 파트 갱신 규칙
- 구역 추가: `header.xml`의 `secCnt`++ 와 `content.hpf` manifest/spine에 `section{N}` 등재.
- 이미지 삽입: `BinData/` 추가 + `content.hpf` manifest에 `media-type`·`isEmbeded` 등재 + 본문 참조 태그.

### 5.4 표·중첩표 작성 전략 (핵심)

표는 §2.2의 재귀 구조 때문에 "문단을 \n\n로 나눠 넣기"식 단순 치환으로는 처리 불가하다. 두 경로로 나눈다.

1. **권장 경로 — `python-hwpx` API 위임** (`build_table.py`/`fill_form.py`)
   ```python
   from hwpx import HwpxDocument

   doc = HwpxDocument.open("templates/base.hwpx")     # 또는 HwpxDocument.new()
   tbl = doc.add_table(3, 4)                            # 3행 4열
   tbl.merge_cells(0, 0, 0, 3)                          # 머리행 가로 병합
   tbl.set_cell_text(0, 0, "사업 개요", logical=True, split_merged=True)

   # 표 안의 표(중첩표): 셀 내부에 다시 표 추가
   inner = tbl.cell(1, 0).add_table(2, 2)
   inner.set_cell_text(0, 0, "세부1")

   # 양식형 표 일괄 채우기(라벨/경로 기반)
   doc.fill_by_path({"성명 > right": "홍길동", "소속 > right": "플랫폼팀"})
   doc.save_to_path(out_path)
   ```
   - 병합(`cellSpan`)·격자좌표(`cellAddr`)·`header.xml` 참조 무결성을 라이브러리가 관리하므로 직접 계산 불필요.
   - 중첩표는 셀 안에서 다시 표를 추가해 재귀 표현(§2.2와 정확히 대응).
   - ⚠️ 위 메서드명·시그니처(`add_table`/`merge_cells`/`set_cell_text`/`fill_by_path`/`cell().text`)는 `python-hwpx` README 기준 예시다. 구현 착수 시 [usage 문서](https://airmang.github.io/python-hwpx/usage.html)로 중첩표·분할 등 정확한 API를 확정한다.

2. **무의존 폴백 — 표 프로토타입 복제** (`hydrate.py`, lxml 불가 시)
   - `templates/table_proto.hwpx`에 *스타일·borderFill이 갖춰진* 1×1 또는 2×2 표를 미리 둔다.
   - `tr`/`tc` 노드를 복제해 목표 차원으로 늘리고, 각 `tc`의 `cellAddr`를 (row,col)로 재지정, 병합 셀은 흡수 셀을 생략하고 기준 셀에 `cellSpan` 부여, `tbl@rowCnt/colCnt`와 `cellSz` 합을 재계산.
   - 이 경로는 구현 부담·오류 위험이 크므로 **단순 표에 한정**하고, 복잡/중첩/병합은 권장 경로로 유도한다.

> 추출(읽기) 시 표는 Markdown 파이프 테이블 대신 **HTML `<table>`(colspan/rowspan)** 로 내보내 병합·중첩 구조를 보존한다(`extract_text.py`, `export_html()`).

---

## 6. 크로스플랫폼 동작 (macOS 포함) ✅

**결론: macOS·Windows·Linux 모두 동일하게 동작한다.**

1. **실행 환경이 호스트 OS와 무관**하다. cowork-core는 macOS에서 **Lima**, Windows에서 **WSL** 기반 Linux 게스트로 에이전트를 구동한다(`packages/cowork-core/dist-lima-agent`, `dist-wsl-agent` 확인). 스킬의 Python 스크립트는 호스트가 macOS든 Windows든 **동일한 Linux VM 안에서** 실행되므로 경로·바이너리 차이가 발생하지 않는다.
2. **순수 파이썬 의존성.** 단순 텍스트 경로는 표준 라이브러리(`zipfile`/`ElementTree`)뿐이고, 표 경로의 `python-hwpx`도 순수 파이썬 + lxml(휠 제공)로 Linux/macOS/Windows/CI 모두 지원(라이브러리 자체 명시) → OS 종속 코드가 없다.
3. **선택적 `soffice`도 docx와 동일하게 안전**하다. docx/pptx/xlsx 스크립트는 `soffice`를 PATH에서 호출하고 없으면 `"Warning: soffice not found. Skipping validation."`로 graceful fallback 한다(검증 생략, 핵심 기능은 유지). HWPX도 같은 패턴을 따르므로, macOS에 LibreOffice가 없어도 생성·편집·추출은 정상 동작한다.

> 즉 별도의 macOS 분기 코드가 필요 없다. (호스트에서 직접 `soffice`를 부른다면 macOS 경로가 `/Applications/LibreOffice.app/Contents/MacOS/soffice`로 다르지만, 본 스킬은 Linux VM 내부에서 PATH의 `soffice`를 호출하므로 해당되지 않는다.)

---

## 7. 검증 및 테스트 계획 (CI 자동화 가능, HWPX 전용)

**읽기 — `tests/phase3/` (KB 연계)**
- `.hwpx` → Markdown 추출이 표 포함 무손실로 KB 디렉터리에 주입되는가.

**쓰기 — office 스킬 테스트와 동일 계층**
1. **무결성**: 생성물 unzip 시 `mimetype`이 첫 엔트리·무압축인가, `content.hpf` manifest가 실제 파트와 일치하는가. (+`python-hwpx`의 `hwpx-validate`/`hwpx-validate-package`로 XSD·패키지 검증)
2. **라운드트립**: 생성물을 `extract_text.py`로 재추출한 텍스트가 입력과 100% 일치하는가.
3. **표 검증(핵심)**: ① N×M 표 생성 → 행·열 수 일치, ② 병합셀 → `cellSpan`(colSpan/rowSpan)·격자 좌표 정합 및 흡수 셀 생략 확인, ③ **중첩표** → 셀 `subList` 내부 `tbl` 재귀 추출이 원본과 일치, ④ 양식 채우기(`fill_by_path`)의 `applied_count`/`failed_count` 검증.
4. **(선택) 헤드리스 로드**: `soffice` 존재 시 `--convert-to pdf` exit 0 및 비어있지 않은 PDF 산출. 없으면 skip.
5. **페이지 가드**: 기존 문서 편집 시 페이지 수 불변(page_guard) 검사.

**통합(범용, gov-proposal 비의존)**
- 에이전트가 `.hwpx` 산출을 요청받았을 때 hwpx 스킬이 선택되어 파일을 만들고, 인앱 파일 뷰어/다운로드로 출력되는가. (file-viewer-panel에 `.hwpx` 미리보기 추가는 별도 계획으로 분리)

---

## 8. 완료 조건 (Success Criteria)

1. **오프라인·무결성**: 전 과정이 격리 샌드박스에서 외부 트래픽 0으로 수행(네트워크 차단 CI에서 §7 통과).
2. **인식·로드**: 생성 `.hwpx`가 `mimetype` 규약을 만족하고, (soffice 가용 시) 헤드리스 변환에서 깨짐 없이 로드. 최신 한글 오피스(2022+) 수동 확인은 보조 지표.
3. **텍스트 라운드트립**: 입력 ↔ 재추출 텍스트 일치율 100%(서식·레이아웃 보존은 best-effort로 별도 표기).
4. **표 충실도**: N×M 표·병합셀·**중첩표**·양식 채우기가 한/글에서 깨짐 없이 열리고, 라운드트립 추출 시 구조(행·열·span·중첩)가 보존된다. (이미지/복잡 도형이 많은 문서는 한/글 수동 검증 필요 — §3 제약)
5. **크로스플랫폼**: macOS·Windows·Linux 호스트에서 순수 파이썬(텍스트=stdlib, 표=python-hwpx+lxml)으로 읽기/쓰기 동작(§6).
6. **독립성**: docx와 동일 등급의 범용 빌트인으로 등록되며, 특정 도메인 스킬에 의존성으로 결합되지 않는다.

---

## 부록. 참고 자료

- 한컴테크 [HWPX 포맷 구조](https://tech.hancom.com/hwpxformat/) · [Python HWPX 파싱 (1)](https://tech.hancom.com/python-hwpx-parsing-1/) · [Python HWPX 파싱 (2) — 본문·표 구조](https://tech.hancom.com/python-hwpx-parsing-2/)
- 한컴 [HWP/OWPML 공식 자료](https://www.hancom.com/support/downloadCenter/hwpOwpml) · [KS X 6101 (OWPML)](https://www.kssn.net/search/stddetail.do?itemNo=K001010119985) · [hancom-io/hwpx-owpml-model](https://github.com/hancom-io/hwpx-owpml-model) (공식 OWPML 모델)
- **표 작성 코어(권장)**: [airmang/python-hwpx](https://github.com/airmang/python-hwpx) (Apache-2.0, 순수 Python) + [hwpx-mcp-server](https://github.com/airmang/hwpx-mcp-server) + [hwpx-skill](https://github.com/airmang/hwpx-skill)
- 참고: [neolord0/hwpxlib](https://github.com/neolord0/hwpxlib)(Java) · [mzoryy/hwpxskill](https://github.com/mzoryy/hwpxskill) · [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc)(HWPX→Markdown 표 지원) · [HWPX 표 파싱 예시(harampark)](https://blog.harampark.com/blog/python-read-hwpx/)
- 코드베이스: `skills/README.md`, `packages/cowork-core/.claude/skills/{docx,pptx,xlsx}/`, `packages/cowork-core/dist-{lima,wsl}-agent`, `packages/veluga-main/src/agents/skill-resolver.ts`
