# Stage 0 — 인프라 스캐폴드

## 목표
격리 폴더 골격을 만들고 IPC 채널·독립 스토어·외부 wire-up 4지점을 완성한다. 이 단계에서 뷰어는 빈 쉘이며 실제 파일 렌더는 Stage 1에서 추가한다.

## 작업
1. `features/file-viewer/` 폴더 생성
2. `store.ts` — 독립 Zustand (`path`, `open`, `close` + `openFileInViewer` 헬퍼)
3. `types.ts` — `PreviewKind`, `ReadFileResult`
4. `preview-kind.ts` — Set 기반 분기 (`.md`, CODE_EXTS, IMAGE_EXTS, `.pdf`, `.html`, `.csv/.tsv`, `.docx`, `.xlsx/.xls`, TEXT_EXTS → `'unsupported'`)
5. `ipc/main-handler.ts` — `registerFileViewerIpc(ipcMain)`:
   - 채널: `file-viewer:read`
   - 경로 검증: `isAbsolute` + `decodePathSafely` 패턴 복제 (기존 `revealFileInFolder` 의존성 만들지 않음)
   - **50MB 하드 리밋**: `fs.statSync` → 초과 시 `{ error: 'TOO_LARGE', limit }`
   - 정상: `{ buffer: base64, ext, name, size }`
   - 실패: `{ error: 'NOT_FOUND' | 'NOT_ABSOLUTE' | 'READ_FAILED' }`
6. `ipc/preload-binding.ts` — `createFileViewerBinding()` + `window.electronAPI.fileViewer` 타입 선언
7. `FileViewerPanel.tsx` — 헤더/닫기만 있는 빈 쉘 (`path === null`이면 `null`)
8. `open-from-ui.ts` — **모든 진입점이 공유하는 단일 라우터**:
   ```ts
   export async function openFileFromUI(filePath: string, cwd?: string) {
     const ext = path.extname(filePath).toLowerCase()
     if (OS_ONLY_EXTS.has(ext)) {
       await window.electronAPI.showItemInFolder(filePath, cwd)
     } else {
       openFileInViewer(filePath)
     }
   }
   ```
9. `index.ts` — `FileViewerPanel`, `openFileFromUI`, `openFileInViewer`, `OS_ONLY_EXTS` export
10. 외부 wire-up:
    - `App.tsx`: ContextPanel과 동일 패턴 (`PanelErrorBoundary + Suspense`)으로 마운트
    - `main/index.ts`: `app.whenReady()` 안 `registerFileViewerIpc(ipcMain)` 1회
    - `preload/index.ts`: `electronAPI` 객체에 `fileViewer: createFileViewerBinding()` 머지
    - 진입점 5곳에는 Stage 0에서 import만 추가 (실제 라우팅 교체는 Stage 1)

## 영향 파일
- 신규: `features/file-viewer/` 내 9개 파일 (`open-from-ui.ts` 추가)
- 수정: `App.tsx`, `main/index.ts`, `preload/index.ts`
- 진입점 import만 추가 (라우팅 교체는 Stage 1): `ContextPanel.tsx`, `message/ContentBlockView.tsx`

## 검증
- `pnpm --filter cowork-core build` 성공
- `pnpm --filter cowork-core typecheck` 성공
- DevTools에서 `window.electronAPI.fileViewer.read('/...')` 직접 호출 시 base64 응답
- 50MB 초과 파일 → `{ error: 'TOO_LARGE' }`
- 상대 경로 → `{ error: 'NOT_ABSOLUTE' }`

## 체크리스트
- [x] `features/file-viewer/` 폴더 + 9개 스캐폴드 파일 생성 (`open-from-ui.ts` 포함)
- [x] `useFileViewerStore`가 기존 `useAppStore`와 완전 독립 (grep으로 교차 import 0 확인)
- [x] `previewKindForFile()` 정상 동작 (수동 테스트)
- [x] `openFileFromUI()` 단일 라우터 export 확인 (OS_ONLY_EXTS 분기 포함)
- [x] `file-viewer:read` 정상 파일 → base64 반환
- [x] 50MB 초과 → `TOO_LARGE` 에러 코드
- [x] 상대/미존재 경로 → 명시적 에러 코드
- [x] 빌드 + 타입체크 성공
- [x] ContextPanel/ContentBlockView 기존 동작 회귀 없음 (라우팅 미교체 상태)
- [x] `window.electronAPI.fileViewer.read` 타입 노출 확인

## 롤백
이 단계의 커밋만 revert하면 기능 흔적 없이 원복. `App.tsx`에서 `<FileViewerPanel/>` 마운트만 주석해도 즉시 비활성.
