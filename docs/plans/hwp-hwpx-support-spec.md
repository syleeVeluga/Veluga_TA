# 21 — HWP / HWPX (한글 문서) 지원 스킬 아키텍처 설계 계획

> 목표 한 줄: 한국 공공·금융 도메인의 핵심 문서 규격인 HWP 및 HWPX 파일을 파싱(Read)하고 템플릿 기반으로 자동 생성(Write)하는 특화 에이전트 스킬을 구축한다.

---

## 1. 개요 및 추진 배경

Veluga는 대한민국 공공기관 및 금융 네트워크 환경을 주요 타깃으로 하는 엔터프라이즈 AI 에이전트 플랫폼입니다. 국내 비즈니스 환경에서 한글 문서(.hwp, .hwpx)는 필수 불가결한 표준 포맷이지만, 외산 클라우드 기반 AI 솔루션들은 이를 원활하게 지원하지 못합니다. 

이 설계안은 기존 Word(.docx) 제어 아키텍처를 참고하여, 별도의 상용 라이선스 종속성이나 플랫폼 제약 없이 서버 및 데스크톱 샌드박스에서 한글 문서를 독립적으로 다룰 수 있는 스킬을 구성하는 것을 목표로 합니다.

---

## 2. 기술 분석: HWP vs HWPX

| 분류 | 한글 5.0 (바이너리, .hwp) | 개방형 한글 XML (.hwpx) |
| :--- | :--- | :--- |
| **구조** | OLE Compound File (바이너리 스트림 구조) | OOXML 포맷과 유사한 ZIP 패키징 내 XML 구조 |
| **포맷 오픈 여부**| 비공개에 가까운 정적 이진 명세 (HwpV5 구조) | 국가 표준(KS X 6101:2018) 표준 개방형 스키마 |
| **수정/생성 난이도**| **상 (Very Difficult)**<br>한컴 프로그램 제어나 직접 구조 가공 필요 | **중 (Normal/Clean)**<br>ZIP 압축 후 XML 노드를 파싱하여 가공 가능 |
| **플랫폼 이식성** | Windows 전용 COM 제어 기술 위주 작동(데스크톱 전용) | Linux/NodeJS/Python 환경 불문 100% 동작 가능 |
| **추천 제어 방식** | pyhwp 라이브러리를 활용한 단방향 파싱 및 읽기 전용으로 대응 | JSZip + fast-xml-parser 기반 직접 편집 및 작성 대응 (권장) |

---

## 3. 관련 오픈소스 생태계 분석 및 연동 방안

깃허브(GitHub) 등 오픈소스 커뮤니티에서 검증된 핵심 도구 및 라이브러리를 활용하여 개발 공수를 최소화합니다.

### A. 파서(Parser/Reader) 최적 오픈소스
1. **`pyhwp` (Python, mete0r/pyhwp)**:
   - 전반적으로 HWP 5.0 명세 분석에 있어 가장 신뢰도 높은 라이브러리입니다.
   - **활용**: 업로드된 바이너리 `.hwp` 파일 내부 스트림(BodyText)을 해제하고 원문 인코딩을 해석하여 마크다운(Markdown) 혹은 일반 텍스트로 변환해 주는 전처리 파이프라인으로 구성합니다.
2. **`jszip` (NodeJS) / `fast-xml-parser` (NodeJS)**:
   - 별도의 무거운 컴파일러 없이 NodeJS 환경 내에서 무손동성 파싱을 수행하기 위한 경량 모듈 조합입니다.
   - **활용**: `.hwpx` 파일 구조 해제 후 내부의 `Contents/section0.xml`에서 텍스트 노드를 고속 수집합니다.

### B. 빌더(Builder/Writer) 최적 구현 메커니즘
- 새 빈 문서를 제로 베이스에서 XML 코드로 한땀 한땀 조립하는 방식은 정렬 오정렬 리스크가 큽니다.
- **템플릿 정적 주입 방식(Static-based Hydration)**을 채택합니다.
  - 미리 여백, 본문 기본 스타일셋(예: 글꼴 함초롬바탕/맑은고딕, 크기 12pt, 줄간격 160% 등)이 완벽하게 디자인된 베이스 템플릿(`.zip`) 파일을 보관합니다.
  - 쓰기 작업 발생 시, 임시 가상 디렉터리에 압축을 풀고 내부의 `Contents/header.xml`과 `Contents/section0.xml` 파일만 XML 노드 제어기(Node DOMParser 또는 Python ElementTree)를 사용해 수정(Hydrate)합니다.
  - 완료된 디렉터리를 다시 ZIP 압축 후 `.hwpx` 확장자로 내려보냅니다.

---

## 4. Veluga 스킬 통합 설계

새롭게 도입되는 스킬은 `hwpx-engine` 코어와 이를 소비하는 도메인 제안서 스킬 `gov-proposal` 형태로 구성됩니다.

```
Veluga_TA/
├── skills/
│   ├── core/
│   │   └── hwpx-engine/              # HWP/HWPX 파싱 및 생성 서비스 엔진
│   │       ├── SKILL.md              # 메타정보 선언
│   │       ├── handler.ts            # HWPX 압축 해제 및 XML 조작 핸들러
│   │       └── templates/
│   │           └── base_template.hwpx # 표준 공공 양식 사전 패키징 파일
│   └── domain/
│       └── gov-proposal/             # 기존 제안서 생성 스킬 고도화
```

### ① core/hwpx-engine/SKILL.md 설계
```yaml
---
id: hwpx-engine
version: 1.0.0
category: core
description: "HWP 바이너리 텍스트 파싱 및 표준 HWPX 문서 생성을 지원하는 한국 맞춤형 한글 문서 제어 엔진"
required_scopes: [fs:read, fs:write]
---
```

### ② core/hwpx-engine/handler.ts 흐름도
```typescript
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from 'xmldom';

export async function createHwpxFromMarkdown(outputPath: string, markdownText: string): Promise<void> {
  const templatePath = path.join(__dirname, 'templates', 'base_template.hwpx');
  const fileBuffer = fs.readFileSync(templatePath);
  
  // XML 로딩 및 파싱
  const zip = await JSZip.loadAsync(fileBuffer);
  const sectionStr = await zip.file('Contents/section0.xml')?.async('string');
  if (!sectionStr) throw new Error('Error loading HWPX Base Section');
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(sectionStr, 'text/xml');
  const sectionNode = xmlDoc.getElementsByTagName('hs:section')[0];
  
  // 기존 템플릿 안 골격 비우기
  while (sectionNode.firstChild) {
    sectionNode.removeChild(sectionNode.firstChild);
  }
  
  // Markdown 문단을 루프 돌며 <hp:p> 생성 및 매핑
  const paragraphs = markdownText.split('\n\n');
  paragraphs.forEach((pText) => {
    const pNode = xmlDoc.createElement('hp:p');
    const runNode = xmlDoc.createElement('hp:run');
    const textNode = xmlDoc.createElement('hp:t');
    
    textNode.textContent = pText.trim();
    runNode.appendChild(textNode);
    pNode.appendChild(runNode);
    sectionNode.appendChild(pNode);
  });
  
  // 파일 갱신 및 재압축
  const serializer = new XMLSerializer();
  zip.file('Contents/section0.xml', serializer.serializeToString(xmlDoc));
  
  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(outputPath, outputBuffer);
}
```

---

## 5. 단계별 검증 및 테스트 계획 (Tests)

* **테스트 위치**: `tests/phase3/phase3-hwpx-engine.test.ts` 추가
* **그라운드 트루스 검증**:
  - **1단계: 검증 테스트 (Unpack integrity)**: 임의 생성한 `.hwpx` 파일이 실제로 파이썬 이외 규격 및 실제 한컴오피스 한글 뷰어 앱에서 손상 없이 정식 로드되는가 판독.
  - **2단계: RAG 파이프라인 연계 테스트**: `pyhwp` 모듈을 통과하여 텍스트 데이터가 마크다운으로 무손실 변환되어 KB 지식 디렉터리에 자동 가공 및 주입되는가 테스트.
  - **3단계: 단방향 가공 테스트**: 정부 기획 제안서 스킬의 최종 산출 파일 다운로드 API가 Word(.docx)뿐 아니라 HWPX 생성 메서드를 경유해 클라이언트 파일 뷰어로 즉시 출력되는지 통합 테스트.

---

## 6. 완료 조건 (Success Criteria)

1. **로그 분리 및 무결성**: 한글 제어 가공 영역 전체는 오프라인 격리 샌드박스에서 수행되어야 하며 라이선스나 서버 호출에 외산 외부 트래픽을 유발하지 않아야 한다.
2. **레이아웃 유지**: 생성된 `hwpx` 파일을 최신 한글 오피스(2022 이상) 혹은 공공 웹뷰어에서 열었을 때 구조가 온전히 해독되어 깨짐 없이 표현된다.
3. **독립 패키징**: Node.js 단에서 타 운영체제(Windows, Linux WSL)에서도 `unzip/xml parser` 조합만으로 `hwp` 및 `hwpx` 읽기/쓰기가 크로스 플랫폼 안정성을 완수한다.
