import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-bold text-moss-600">
              BRIDGE 2026
            </h1>
            <p className="text-moss-500 mt-2">
              Physical AI Expansion — Moss Coin DAO
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Where agents propose, people decide, reality updates.
            </p>
          </div>
          <ConnectButton />
        </header>

        {/* Navigation */}
        <nav className="mb-12">
          <ul className="flex gap-6">
            <li>
              <Link
                href="/reality-feed"
                className="text-moss-600 hover:text-moss-700 font-medium"
              >
                Reality Feed
              </Link>
            </li>
            <li>
              <Link
                href="/proposals"
                className="text-moss-600 hover:text-moss-700 font-medium"
              >
                Proposals
              </Link>
            </li>
            <li>
              <Link
                href="/delegation"
                className="text-moss-600 hover:text-moss-700 font-medium"
              >
                Delegation
              </Link>
            </li>
            <li>
              <Link
                href="/outcomes"
                className="text-moss-600 hover:text-moss-700 font-medium"
              >
                Outcomes
              </Link>
            </li>
          </ul>
        </nav>

        {/* Main Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Reality Oracle Card */}
          <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Reality Oracle
            </h2>
            <p className="text-gray-600 mb-4">
              실세계 신호를 검증 가능한 거버넌스 입력으로 변환합니다.
            </p>
            <Link
              href="/reality-feed"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              신호 보기 →
            </Link>
          </div>

          {/* Agentic Consensus Card */}
          <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Agentic Consensus
            </h2>
            <p className="text-gray-600 mb-4">
              AI 에이전트들이 협의하여 Decision Packet을 생성합니다.
            </p>
            <Link
              href="/proposals"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              제안 보기 →
            </Link>
          </div>

          {/* Human Governance Card */}
          <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Human Governance
            </h2>
            <p className="text-gray-600 mb-4">
              모스코인 홀더가 최종 결정을 내립니다.
            </p>
            <Link
              href="/proposals"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              투표하기 →
            </Link>
          </div>

          {/* Atomic Actuation Card */}
          <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Atomic Actuation
            </h2>
            <p className="text-gray-600 mb-4">
              거버넌스 결정을 원자적으로 실행합니다.
            </p>
            <Link
              href="/outcomes"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              실행 내역 →
            </Link>
          </div>

          {/* Proof of Outcome Card */}
          <div className="bg-white rounded-lg shadow-md p-6 border border-moss-200">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Proof of Outcome
            </h2>
            <p className="text-gray-600 mb-4">
              결과를 측정하고 평가하여 증명합니다.
            </p>
            <Link
              href="/outcomes"
              className="text-moss-600 hover:text-moss-700 font-medium"
            >
              결과 보기 →
            </Link>
          </div>

          {/* Moss Coin Info Card */}
          <div className="bg-moss-50 rounded-lg shadow-md p-6 border border-moss-300">
            <h2 className="text-xl font-semibold text-moss-700 mb-3">
              Moss Coin
            </h2>
            <p className="text-gray-600 mb-2">
              <strong>Contract:</strong>
            </p>
            <p className="text-sm font-mono text-moss-600 mb-4 break-all">
              {process.env.NEXT_PUBLIC_MOSS_COIN_ADDRESS || '0x8bbfe65e31b348cd823c62e02ad8c19a84dd0dab'}
            </p>
            <p className="text-gray-600 text-sm">
              ERC-20 기반 거버넌스 토큰
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}









