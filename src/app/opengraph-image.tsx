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
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #111111 0%, #1a1a1a 50%, #111111 100%)',
          padding: '60px 80px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle accent glow */}
        <div
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-120px',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            left: '-80px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '28px',
          }}
        >
          <div
            style={{
              background: 'rgba(249,115,22,0.15)',
              border: '1px solid rgba(249,115,22,0.3)',
              borderRadius: '100px',
              padding: '8px 20px',
              fontSize: '18px',
              color: '#F97316',
              fontWeight: 600,
              letterSpacing: '0.5px',
              display: 'flex',
            }}
          >
            AI Compliance Engine
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: '64px',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.1,
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span style={{ color: '#F97316', display: 'flex' }}>Compliance, automated.</span>
          <span style={{ display: 'flex', marginTop: '4px' }}>Built for construction</span>
          <span style={{ display: 'flex', marginTop: '4px' }}>& real estate.</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: '22px',
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.5,
            maxWidth: '700px',
            display: 'flex',
          }}
        >
          Upload a violation notice, get a resolution plan in seconds.
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '50px',
            left: '80px',
            right: '80px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#F97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                fontWeight: 800,
              }}
            >
              C
            </div>
            CrewShift AI
          </div>
          <div
            style={{
              fontSize: '18px',
              color: 'rgba(255,255,255,0.4)',
              display: 'flex',
            }}
          >
            crewshiftai.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
