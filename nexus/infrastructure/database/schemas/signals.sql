-- Signals Table
-- Reality Oracle에서 수집된 신호를 저장합니다.

CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metadata JSONB NOT NULL,
    data JSONB NOT NULL,
    attestation JSONB NOT NULL,
    audit_log_ref TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_metadata_source ON signals((metadata->>'source'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_type ON signals((metadata->>'type'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_timestamp ON signals((metadata->>'timestamp'));

-- GIN 인덱스 (JSONB 검색용)
CREATE INDEX IF NOT EXISTS idx_signals_data_gin ON signals USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_signals_metadata_gin ON signals USING GIN(metadata);









