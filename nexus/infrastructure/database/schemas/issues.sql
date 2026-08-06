-- Issues Table
-- Inference Mining에서 추출된 이슈를 저장합니다.

CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) NOT NULL,
    evidence JSONB NOT NULL,
    categories TEXT[] DEFAULT '{}',
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    related_issue_ids UUID[] DEFAULT '{}',
    metadata JSONB
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_detected_at ON issues(detected_at);
CREATE INDEX IF NOT EXISTS idx_issues_categories ON issues USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_issues_evidence_gin ON issues USING GIN(evidence);

-- Issue Groups Table
-- 그룹화된 이슈들을 저장합니다.

CREATE TABLE IF NOT EXISTS issue_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    issue_ids UUID[] NOT NULL,
    priority_score FLOAT NOT NULL,
    clustering_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_issue_groups_priority_score ON issue_groups(priority_score);
CREATE INDEX IF NOT EXISTS idx_issue_groups_issue_ids ON issue_groups USING GIN(issue_ids);









