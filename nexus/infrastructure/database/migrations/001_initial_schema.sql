-- Migration: 001_initial_schema
-- Description: 초기 데이터베이스 스키마 생성
-- Created: 2026-01-01
--
-- This file has to be runnable on its own — the README documents applying it
-- with `psql -f` against a fresh database — so it creates the extensions it
-- depends on rather than assuming schemas/init.sql ran first.
--
-- It is the executable form of schemas/*.sql, and backend/src/entities/ maps
-- onto the same tables. `synchronize` is off outside development, so a column
-- present in only one of the three is a column the running server queries and
-- never finds.

BEGIN;

-- uuid_generate_v4() is the DEFAULT on the primary keys below, and it is what
-- TypeORM's @PrimaryGeneratedColumn('uuid') depends on: the driver omits the
-- column on insert and reads the generated value back.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Trigram matching for issue and proposal text search.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Signals
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metadata JSONB NOT NULL,
    data JSONB NOT NULL,
    attestation JSONB NOT NULL,
    audit_log_ref TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_metadata_source ON signals((metadata->>'source'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_type ON signals((metadata->>'type'));
CREATE INDEX IF NOT EXISTS idx_signals_metadata_timestamp ON signals((metadata->>'timestamp'));
CREATE INDEX IF NOT EXISTS idx_signals_data_gin ON signals USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_signals_metadata_gin ON signals USING GIN(metadata);

-- Issues
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

CREATE INDEX IF NOT EXISTS idx_issues_priority ON issues(priority);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_detected_at ON issues(detected_at);
CREATE INDEX IF NOT EXISTS idx_issues_categories ON issues USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_issues_evidence_gin ON issues USING GIN(evidence);

-- Issue Groups
CREATE TABLE IF NOT EXISTS issue_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    issue_ids UUID[] NOT NULL,
    priority_score FLOAT NOT NULL,
    clustering_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issue_groups_priority_score ON issue_groups(priority_score);
CREATE INDEX IF NOT EXISTS idx_issue_groups_issue_ids ON issue_groups USING GIN(issue_ids);

-- Decision Packets
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

CREATE INDEX IF NOT EXISTS idx_decision_packets_issue_id ON decision_packets(issue_id);
CREATE INDEX IF NOT EXISTS idx_decision_packets_created_at ON decision_packets(created_at);
CREATE INDEX IF NOT EXISTS idx_decision_packets_confidence ON decision_packets(overall_confidence);
CREATE INDEX IF NOT EXISTS idx_decision_packets_agent_reasoning_gin ON decision_packets USING GIN(agent_reasoning);

-- Proposals
CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('governance', 'treasury', 'technical', 'policy')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'pending', 'active', 'passed', 'rejected', 'executed', 'cancelled')),
    decision_packet_id UUID NOT NULL REFERENCES decision_packets(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actions JSONB NOT NULL,
    voting_start_time TIMESTAMP WITH TIME ZONE,
    voting_end_time TIMESTAMP WITH TIME ZONE,
    min_participation_rate FLOAT CHECK (min_participation_rate >= 0 AND min_participation_rate <= 1),
    passing_threshold FLOAT CHECK (passing_threshold >= 0 AND passing_threshold <= 1),
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_type ON proposals(type);
CREATE INDEX IF NOT EXISTS idx_proposals_decision_packet_id ON proposals(decision_packet_id);
CREATE INDEX IF NOT EXISTS idx_proposals_issue_id ON proposals(issue_id);
CREATE INDEX IF NOT EXISTS idx_proposals_voting_start_time ON proposals(voting_start_time);
CREATE INDEX IF NOT EXISTS idx_proposals_voting_end_time ON proposals(voting_end_time);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_status_created_at ON proposals(status, created_at);

-- Votes
--
-- voter_address stores the EIP-55 checksummed form. The UNIQUE constraint is
-- what actually stops a double vote: the API's "already voted" lookup is not
-- atomic, so two concurrent requests can both pass it.
CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    voter_address TEXT NOT NULL,
    choice VARCHAR(10) NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
    weight NUMERIC NOT NULL CHECK (weight >= 0),
    voted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    tx_hash TEXT,
    UNIQUE(proposal_id, voter_address)
);

CREATE INDEX IF NOT EXISTS idx_votes_proposal_id ON votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter_address ON votes(voter_address);
CREATE INDEX IF NOT EXISTS idx_votes_voted_at ON votes(voted_at);
CREATE INDEX IF NOT EXISTS idx_votes_tx_hash ON votes(tx_hash);

-- Proposal Results
--
-- Derived from `votes` and keyed by proposal, so recomputing a tally replaces
-- the previous summary instead of accumulating stale copies.
CREATE TABLE IF NOT EXISTS proposal_results (
    proposal_id UUID PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
    total_votes INTEGER NOT NULL DEFAULT 0,
    yes_votes INTEGER NOT NULL DEFAULT 0,
    no_votes INTEGER NOT NULL DEFAULT 0,
    abstain_votes INTEGER NOT NULL DEFAULT 0,
    total_weight NUMERIC NOT NULL DEFAULT 0,
    yes_weight NUMERIC NOT NULL DEFAULT 0,
    no_weight NUMERIC NOT NULL DEFAULT 0,
    abstain_weight NUMERIC NOT NULL DEFAULT 0,
    passed BOOLEAN NOT NULL,
    participation_rate FLOAT NOT NULL CHECK (participation_rate >= 0 AND participation_rate <= 1),
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Delegation Policies
--
-- wallet stores the EIP-55 checksummed form, as votes.voter_address does, so
-- one holder cannot end up with two policy sets differing only in casing.
CREATE TABLE IF NOT EXISTS delegation_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet VARCHAR(255) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    scope JSONB,
    max_budget_per_month NUMERIC(20, 2) CHECK (max_budget_per_month >= 0),
    max_budget_per_proposal NUMERIC(20, 2) CHECK (max_budget_per_proposal >= 0),
    no_vote_on_emergency BOOLEAN NOT NULL DEFAULT TRUE,
    cooldown_window_hours INTEGER NOT NULL CHECK (cooldown_window_hours >= 0),
    veto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    require_human_review_above NUMERIC(20, 2) CHECK (require_human_review_above >= 0),
    max_votes_per_day INTEGER CHECK (max_votes_per_day >= 1),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delegation_policies_wallet ON delegation_policies(wallet);
CREATE INDEX IF NOT EXISTS idx_delegation_policies_agent_id ON delegation_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_delegation_policies_wallet_agent ON delegation_policies(wallet, agent_id);

-- Outcomes
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

CREATE INDEX IF NOT EXISTS idx_outcomes_proposal_id ON outcomes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_decision_packet_id ON outcomes(decision_packet_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_status ON outcomes(status);
CREATE INDEX IF NOT EXISTS idx_outcomes_proposal_id_status ON outcomes(proposal_id, status);
CREATE INDEX IF NOT EXISTS idx_outcomes_execution_start_time ON outcomes(execution_start_time);
CREATE INDEX IF NOT EXISTS idx_outcomes_kpi_measurements_gin ON outcomes USING GIN(kpi_measurements);

-- Reputation
CREATE TABLE IF NOT EXISTS reputation (
    agent_type VARCHAR(50) PRIMARY KEY,
    total_evaluations INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    average_confidence FLOAT NOT NULL DEFAULT 0 CHECK (average_confidence >= 0 AND average_confidence <= 1),
    trust_score FLOAT NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 1),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reputation_trust_score ON reputation(trust_score);
CREATE INDEX IF NOT EXISTS idx_reputation_updated_at ON reputation(updated_at);

-- Governance Learning
CREATE TABLE IF NOT EXISTS governance_learning (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_categories TEXT[] NOT NULL,
    agent_types TEXT[] NOT NULL,
    success_patterns TEXT[],
    failure_patterns TEXT[],
    improvement_suggestions TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_learning_categories ON governance_learning USING GIN(issue_categories);
CREATE INDEX IF NOT EXISTS idx_governance_learning_agent_types ON governance_learning USING GIN(agent_types);
CREATE INDEX IF NOT EXISTS idx_governance_learning_created_at ON governance_learning(created_at);

-- Events
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    source TEXT NOT NULL,
    data JSONB NOT NULL,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_data_gin ON events USING GIN(data);

COMMIT;
