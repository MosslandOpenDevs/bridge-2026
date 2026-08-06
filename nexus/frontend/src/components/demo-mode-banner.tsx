'use client';

/**
 * Rendered on every page that can show demo fixtures. It must stay
 * unmissable — the whole point of demo mode is that nobody mistakes a fixture
 * for a real proposal, outcome, or signal and acts on its id.
 */
export function DemoModeBanner() {
  return (
    <div
      role="status"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <p className="font-semibold text-amber-900">데모 데이터입니다</p>
      <p className="mt-1 text-sm text-amber-800">
        <code className="font-mono">NEXT_PUBLIC_DEMO_MODE=true</code>로 실행 중이라
        백엔드를 호출하지 않고 예시 데이터를 보여줍니다. 실제 제안·결과·신호가
        아니므로 투표 등 어떤 행동의 근거로도 사용하지 마세요.
      </p>
    </div>
  );
}
