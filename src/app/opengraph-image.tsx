import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'CrewShift AI — The AI Compliance Engine for Construction & Real Estate';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#111111',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        {/* Logo icon — simplified geometric mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '40px' }}>
          {/* Orange geometric logo mark */}
          <svg width="72" height="80" viewBox="0 0 198 229">
            <path fill="#ff751f" d="M 197.996094 114.773438 L 197.996094 190.769531 L 132.175781 228.765625 L 66.367188 190.769531 Z" />
            <path fill="#ff751f" d="M 0.550781 152.769531 L 0.550781 76.773438 L 132.175781 0.78125 L 175.09375 25.558594 L 197.996094 38.773438 L 66.367188 114.773438 L 66.367188 190.769531 Z" />
          </svg>
          {/* CrewShift text */}
          <div style={{ display: 'flex', fontSize: '64px', fontWeight: 800, color: '#ffffff', letterSpacing: '-1px' }}>
            CrewShift
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            display: 'flex',
            fontSize: '32px',
            fontWeight: 500,
            color: 'rgba(255,255,255,0.7)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          The AI Compliance Engine for Construction & Real Estate
        </div>
      </div>
    ),
    { ...size }
  );
}
