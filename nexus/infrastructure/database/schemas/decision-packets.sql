-- Decision Packets Table
-- Agentic Consensus에서 생성된 Decision Packet을 저장합니다.

CREATE TABLE IF NOT EXISTS decision_packets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    recommendation TEXT NOT NULL,
    recommendation_details TEXT NOT NULL,
    alternatives JSONB NOT NULL,
    risks JSONB NOT NULL,
    kpis JSONB NOT NULL,
    dissenting_opinions JSONB NOT NULL,
    agent_reasoning JSONB NOT NULL,
    overall_confidence FLOAT NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
    uncertainty_summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    moderator JSONB NOT NULL,
    metadata JSONB
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_decision_packets_issue_id ON decision_packets(issue_id);
CREATE INDEX IF NOT EXISTS idx_decision_packets_created_at ON decision_packets(created_at);
CREATE INDEX IF NOT EXISTS idx_decision_packets_confidence ON decision_packets(overall_confidence);
CREATE INDEX IF NOT EXISTS idx_decision_packets_agent_reasoning_gin ON decision_packets USING GIN(agent_reasoning);









