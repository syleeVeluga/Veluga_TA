# Stage 5 — XlsxViewer

## 목표
.xlsx 파일을 멀티시트 탭으로 렌더한다.

## 작업
1. `package.json` deps: `exceljs@4.4.0`, `react-spreadsheet@0.10.1`
2. `viewers/XlsxViewer.tsx`:
   - `new ExcelJS.Workbook().xlsx.load(arrayBuffer)`
   - 시트 ≥ 2일 때 탭 UI
   - `worksheet.eachRow` → react-spreadsheet 데이터 변환
   - 큰 시트 (10k+ rows) → 명시적 잘라내기 + 안내 메시지
3. `viewer-map.ts`에서 `xlsx` 활성화

## 영향 파일
- 신규: `viewers/XlsxViewer.tsx`
- 수정: `viewer-map.ts`, `package.json`

## 검증
- 단일 시트 렌더
- 멀티 시트 탭 전환
- 수식 셀 → 계산된 값 표시
- 한글 셀 내용
- `.xls` (구버전) → 명시적 unsupported 또는 변환 확인

## 체크리스트
- [ ] 단일 시트 정상
- [ ] 멀티 시트 탭 전환
- [ ] 수식 결과값 표시
- [ ] 한글 셀 정상
- [ ] 큰 시트 잘라내기 + 안내 메시지
- [ ] `.xls` 처리 정책 결정 및 동작

## 롤백
`xlsx` 키만 unsupported로 되돌리고 exceljs/react-spreadsheet 제거.
