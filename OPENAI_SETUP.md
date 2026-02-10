# OpenAI File Search 연동 실행

1. 의존성 설치

```bash
npm install
```

2. `.env` 생성

```bash
cp .env.example .env
```

아래 값을 채워주세요.

- `OPENAI_API_KEY`
- `OPENAI_VECTOR_STORE_ID`
- `OPENAI_SEARCH_MODEL` (기본: `gpt-4.1-mini`)
- `PORT` (기본: `3000`)
- `HOST` (기본: `0.0.0.0`)

3. 서버 실행

```bash
npm start
```

4. 접속

- `http://127.0.0.1:3000/index.html`
- 같은 네트워크의 다른 기기에서는 `http://<내 컴퓨터의 IP>:3000/index.html`

## 동작 방식

- 업로드 버튼: OpenAI Files + Vector Store에 파일 업로드
- 검색 버튼: OpenAI File Search 결과를 받아 카테고리별 필터링 후 표시
- 로컬에는 `data/openai-file-manifest.json`에 `file_id`/카테고리 매핑을 저장
