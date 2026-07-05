import { ImageResponse } from 'next/og';

// Social share card (Open Graph + Twitter). 1200x630 is the canonical ratio.
export const alt = 'BRIDGE 2026 — Moss Coin Holder DAO';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background:
            'linear-gradient(135deg, #052e16 0%, #14532d 45%, #16a34a 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            fontSize: 26,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: '#bbf7d0',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.12)',
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            B
          </div>
          Mossland · BRIDGE
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 96,
            fontWeight: 800,
            marginTop: 28,
            lineHeight: 1.05,
          }}
        >
          BRIDGE 2026
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 40,
            fontWeight: 600,
            color: '#dcfce7',
            marginTop: 8,
          }}
        >
          Physical AI Expansion — Moss Coin DAO
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: '#86efac',
            marginTop: 28,
          }}
        >
          Where agents propose, people decide, reality updates.
        </div>
      </div>
    ),
    { ...size },
  );
}
