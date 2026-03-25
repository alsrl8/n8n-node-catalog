# n8n-node-catalog

n8n 버전별 지원 노드 목록과 typeVersion 매핑.

- 6시간마다 n8n 새 릴리스를 폴링하여 자동 빌드
- 결과물은 GitHub Releases에 JSON으로 저장
- `node scripts/extract.cjs n8n@2.13.2` 로 수동 빌드 가능
