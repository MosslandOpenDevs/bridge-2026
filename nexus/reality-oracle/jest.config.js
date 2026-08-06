/**
 * 테스트는 dist가 아니라 옆에 있는 TypeScript 원본(`../hash-chain`)을 직접
 * import하므로 transform이 없으면 아예 실행되지 않는다.
 *
 * 설정 파일이 워크스페이스 루트가 아니라 이 패키지에 있어야 하는 이유: Jest는
 * 실행된 디렉터리에서 설정을 찾고 상위로 거슬러 올라가지 않으며, `pnpm test`가
 * 이 디렉터리에서 실행된다.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    // 빌드용 tsconfig는 __tests__를 제외하므로, 테스트를 컴파일하려면
    // 테스트까지 포함하는 별도 설정을 가리켜야 한다.
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
