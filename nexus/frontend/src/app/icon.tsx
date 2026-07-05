import { ImageResponse } from 'next/og';

// App-router generated favicon — no binary asset needed, renders at build time.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 800,
          color: '#ffffff',
          background: 'linear-gradient(135deg, #16a34a 0%, #052e16 100%)',
          borderRadius: 7,
        }}
      >
        B
      </div>
    ),
    { ...size },
  );
}
