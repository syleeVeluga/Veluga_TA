# Stage 0 — 저장 IPC & 보안 (에디터 없음)

## 목표
편집 UI보다 먼저, **안전한 디스크 쓰기 경로**를 만든다. 이 단계 종료 시점에는 UI 변화가 없고, `file-viewer:write` IPC와
보안 검증·단위 테스트만 추가된다. 이후 모든 단계가 이 핸들러 위에 올라간다.

## 배경 (현재 상태)
- [main-handler.ts](../../../packages/cowork-core/src/renderer/features/file-viewer/ipc/main-handler.ts)에는
  `file-viewer:read`와 `file-viewer:grant-path`만 등록되어 있다. **쓰기 경로가 전혀 없다.**
- read 핸들러는 다음 보안 절차를 거친다: `normalizeInputPath` → `resolveCandidatePath`(워크스페이스 기준 resolve)
  → `fs.realpathSync.native` → `isWithinRoot(authorizedRoots)`. authorizedRoots = workspace roots(`getExistingAllowedRoots`) + 사용자가 명시적으로 연 `grantedDirs`.
- 읽기 결과는 base64 buffer로 전달되고([types.ts](../../../packages/cowork-core/src/renderer/features/file-viewer/types.ts) `ReadFileResult`),
  렌더러에서 `textFromReadResult`로 디코드된다.

## 작업

1. **`file-viewer:write` 핸들러 추가** (`ipc/main-handler.ts`):
   - 입력: `{ path: string; content: string; expectedMtimeMs?: number }` (content는 UTF-8 문자열).
   - **read와 동일한 경로 해석/보안을 재사용**한다. 즉 `normalizeInputPath` → authorizedRoots 후보 resolve →
     (존재 시) `realpath` → `isWithinRoot` 확인. 기존 read의 검증 함수를 공유하도록 리팩터(중복 금지).
   - 신규 파일 생성 허용 여부는 **명시적으로 결정**: MVP는 "이미 존재하고 authorizedRoots 안에 있는 파일만" 쓰기 허용
     (신규 파일 생성은 비목표 — 경로 탐색/탈출 위험 축소). 부모 디렉터리도 root 안인지 검증.
   - **원자적 쓰기**: 동일 디렉터리에 임시 파일로 쓰고 `fs.renameSync`로 교체(크래시 시 원본 truncate 방지).
   - **크기 가드**: `FILE_VIEWER_READ_LIMIT_BYTES`(50MB)와 동일 상한 재사용. 초과 시 거부.
   - **확장자 가드**: `.md`/`.markdown`만 허용(이 계획 범위). 그 외는 `UNSUPPORTED_FOR_WRITE`.
   - 반환: `WriteFileResult`(아래).

2. **타입 추가** (`types.ts`):
   ```ts
   export type WriteFileErrorCode =
     | 'NOT_FOUND' | 'NOT_ABSOLUTE' | 'OUTSIDE_WORKSPACE'
     | 'TOO_LARGE' | 'WRITE_FAILED' | 'MTIME_CONFLICT' | 'UNSUPPORTED_FOR_WRITE';
   export type WriteFileResult =
     | { ok: true; mtimeMs: number; size: number }
     | { error: WriteFileErrorCode };
   ```

3. **mtime 충돌 사전 배선**(구현은 Stage 4에서 활성): `expectedMtimeMs`가 주어졌고 현재 디스크 mtime과 다르면
   `MTIME_CONFLICT` 반환. Stage 0에서는 인자 미전달 시 검사 생략(no-op)으로 두어 인터페이스만 확정.

4. **preload 바인딩** (`ipc/preload-binding.ts`):
   - `FileViewerBinding`에 `write: (p, content, expectedMtimeMs?) => Promise<WriteFileResult>` 추가.
   - `ipcRenderer.invoke('file-viewer:write', { path, content, expectedMtimeMs })` 노출.

5. **`onWrite`/`onReject` 텔레메트리 훅**을 read와 동일하게 `FileViewerIpcOptions`에 선택적으로 추가(감사 로깅 연계 가능).

## 영향 파일
- 수정: `ipc/main-handler.ts`(보안 함수 공유 리팩터 + write 핸들러), `ipc/preload-binding.ts`, `types.ts`
- 수정: IPC 등록부(`src/main/index.ts` 또는 file-viewer IPC 등록 위치) — write 핸들러 등록 1줄
- 수정: `src/preload/index.ts` — 노출 확인(이미 `fileViewer.*` 노출 중이면 자동)
- 신규: 단위 테스트 파일

## 검증

| 시나리오 | 기대 |
|---|---|
| workspace root 안의 기존 `.md` 쓰기 | `ok:true`, 디스크 반영, mtime 갱신 |
| `..` 경로 탈출 (`root/../../etc/x.md`) | `OUTSIDE_WORKSPACE` 또는 `NOT_FOUND`, 쓰기 없음 |
| symlink가 root 밖을 가리킴 | `realpath` 후 `OUTSIDE_WORKSPACE` |
| authorizedRoots 비어 있음 | `OUTSIDE_WORKSPACE` |
| `.png`/`.ts` 등 비-md | `UNSUPPORTED_FOR_WRITE` |
| 50MB 초과 content | `TOO_LARGE` |
| 쓰기 중 예외(권한 등) | `WRITE_FAILED`, **원본 보존**(임시파일만 잔존/정리) |
| grantedDirs(사용자가 연 외부 폴더) 안의 `.md` | `ok:true` (read와 동일 정책) |

## 체크리스트
- [ ] read/write가 **동일한 경로 해석·root 검증 함수**를 공유(보안 로직 단일 출처)
- [ ] 원자적 쓰기(temp+rename) 적용, 실패 시 원본 무손상
- [ ] 신규 파일 생성 차단(존재하는 파일만), 부모 디렉터리 root 검증
- [ ] `.md`/`.markdown` 외 쓰기 거부
- [ ] 단위 테스트: 정상/탈출/symlink/확장자/크기/충돌(no-op) 케이스
- [ ] preload `write` 바인딩, 렌더러 `window.electronAPI.fileViewer.write` 타입 통과
- [ ] **UI 변화 없음**(이 단계는 인프라만)

## 롤백
이 단계 커밋만 revert. write 핸들러/바인딩 제거 시 read는 무영향. 편집 UI가 아직 없으므로 사용자 회귀 0.
