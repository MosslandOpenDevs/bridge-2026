-- Outcomes Table
-- Proof of Outcome에서 측정된 결과를 저장합니다.

CREATE TABLE IF NOT EXISTS outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    decision_packet_id UUID NOT NULL REFERENCES decision_packets(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'in_progress', 'success', 'partial_success', 'failure', 'cancelled')),
    kpi_measurements JSONB NOT NULL,
    evaluation JSONB,
    execution_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    execution_end_time TIMESTAMP WITH TIME ZONE,
    on_chain_proof_hash TEXT,
    ipfs_ref TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_outcomes_proposal_id ON outcomes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_decision_packet_id ON outcomes(decision_packet_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON outcomes(status);
CREATE INDEX IF NOT EXISTS idx_outcomes_execution_start_time ON outcomes(execution_start_time);
CREATE INDEX IF NOT EXISTS idx_outcomes_kpi_measurements_gin ON outcomes USING GIN(kpi_measurements);

-- Reputation Table
-- 에이전트 신뢰도 및 평판을 저장합니다.

CREATE TABLE IF NOT EXISTS reputation (
    agent_type VARCHAR(50) PRIMARY KEY,
    total_evaluations INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    average_confidence FLOAT NOT NULL DEFAULT 0 CHECK (average_confidence >= 0 AND average_confidence <= 1),
    trust_score FLOAT NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 1),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_reputation_trust_score ON reputation(trust_score);
CREATE INDEX IF NOT EXISTS idx_reputation_updated_at ON reputation(updated_at);

-- Governance Learning Table
-- 거버넌스 학습 데이터를 저장합니다.

CREATE TABLE IF NOT EXISTS governance_learning (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_categories TEXT[] NOT NULL,
    agent_types TEXT[] NOT NULL,
    success_patterns TEXT[],
    failure_patterns TEXT[],
    improvement_suggestions TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_governance_learning_categories ON governance_learning USING GIN(issue_categories);
CREATE INDEX IF NOT EXISTS idx_governance_learning_agent_types ON governance_learning USING GIN(agent_types);
CREATE INDEX IF NOT EXISTS idx_governance_learning_created_at ON governance_learning(created_at);









