# Database Schema

BRIDGE 2026의 데이터베이스 스키마 정의입니다.

## 데이터베이스

PostgreSQL을 사용합니다.

## 스키마 구조

### 주요 테이블

1. **signals** - Reality Oracle에서 수집된 신호
2. **issues** / **issue_groups** - Inference Mining에서 추출·묶인 이슈
3. **decision_packets** - Agentic Consensus에서 생성된 Decision Packet
4. **proposals** - Human Governance에서 생성된 제안
5. **votes** - 투표 정보 (proposal_id + voter_address 유일)
6. **proposal_results** - votes에서 파생된 집계 결과
7. **delegation_policies** - 정책 기반 위임
8. **outcomes** - Proof of Outcome에서 측정된 결과
9. **reputation** / **governance_learning** - 에이전트 평판 및 학습 데이터
10. **events** - 이벤트 버스의 이벤트 로그

`schemas/`의 정의가 기준이고, `migrations/001_initial_schema.sql`은 그것을
실행 가능한 형태로 옮긴 것이며, `backend/src/entities/`의 TypeORM 엔티티가 같은
테이블에 매핑됩니다. 백엔드는 development 환경 밖에서 `synchronize`를 끄기
때문에, 셋 중 하나에만 있는 컬럼은 서버가 조회하지만 존재하지 않는 컬럼이
됩니다. 스키마를 바꿀 때는 셋을 함께 고쳐야 합니다.

## 마이그레이션

마이그레이션 파일은 `migrations/` 디렉토리에 있습니다.

### 초기 스키마 생성

```bash
psql -U postgres -d bridge2026 -f migrations/001_initial_schema.sql
```

마이그레이션은 단독으로 실행 가능합니다. 필요한 확장 기능을 스스로
생성하므로 `schemas/init.sql`을 먼저 적용할 필요가 없습니다.

## 인덱스 전략

- **B-tree 인덱스**: 일반적인 검색 및 정렬용
- **GIN 인덱스**: JSONB 필드의 효율적인 검색용
- **표현식 인덱스**: `metadata->>'source'`처럼 JSONB 문서 내부 값 조회용
- **복합 인덱스**: 자주 함께 사용되는 필드 조합

## 확장 기능

- `uuid-ossp`: UUID 생성용. 기본 키의 `DEFAULT uuid_generate_v4()`가 여기에
  의존하고, TypeORM의 `@PrimaryGeneratedColumn('uuid')`도 이 기본값을 사용해
  INSERT 후 생성된 값을 되읽습니다.
- `pg_trgm`: 텍스트 검색 및 유사도 계산용
