/**
 * Shared Types
 * 
 * BRIDGE 2026의 모든 레이어에서 공유하는 타입 정의를 export합니다.
 */

export * from './signal';
export * from './issue';
export * from './decision-packet';
export * from './proposal';
export * from './outcome';

// DelegationPolicy는 proposal.ts에 포함되어 있음

// Utils
//
// The file is named explicitly: `../utils` is a directory carrying its own
// package.json (@bridge-2026/shared-utils) whose "types" points at
// ../dist/utils/index.d.ts, so a directory-style import resolves to the
// previous build's output as soon as dist/ exists and tsc then refuses to
// overwrite its own input.
export * from '../utils/index';

