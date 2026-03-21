'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import './landing.css';

interface PreviewResult {
  property: { address: string | null; borough: string | null };
  violation: {
    agency: string;
    title: string;
    code_section: string | null;
    plain_english: string;
    severity: 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR';
    penalty_amount: number | null;
    compliance_deadline: string | null;
    hearing_date: string | null;
  };
  assessment: {
    urgency: 'IMMEDIATE' | 'URGENT' | 'STANDARD' | 'LOW';
    what_needs_to_happen: string;
    what_happens_if_ignored: string;
    estimated_cost_range: string;
    estimated_timeline: string;
    needs_licensed_professional: boolean;
  };
  permits_likely_needed?: {
    name: string;
    agency: string;
    description: string;
  }[];
  document_quality: string;
}

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#DC2626', bg: '#FEF2F2', label: 'Critical' },
  MAJOR: { color: '#DC2626', bg: '#FEF2F2', label: 'Major' },
  MODERATE: { color: '#2563EB', bg: '#EFF6FF', label: 'Moderate' },
  MINOR: { color: '#059669', bg: '#ECFDF5', label: 'Minor' },
};

const URGENCY_CONFIG: Record<string, { color: string; label: string }> = {
  IMMEDIATE: { color: '#DC2626', label: 'Act immediately' },
  URGENT: { color: '#D97706', label: 'Act within days' },
  STANDARD: { color: '#2563EB', label: 'Standard timeline' },
  LOW: { color: '#059669', label: 'Low urgency' },
};

const EXAMPLE_PROMPTS: Record<string, string> = {
  'Work without permit': 'I got a DOB violation for work without a permit. A contractor did plumbing work in my building and never pulled a permit. DOB showed up and issued a violation.',
  'No hot water': 'HPD issued a violation for no hot water in my residential building. Tenants have been complaining and an inspector came out.',
  'ECB summons': 'I received an ECB summons in the mail with a hearing date. I\'m not sure what it\'s for or what I need to bring to the hearing.',
  'Lead pipes': 'DEP sent me a notice about lead or galvanized water service lines at my property. They said they won\'t do meter work until the pipes are replaced.',
  'Fire alarm violation': 'FDNY issued a violation because the fire alarm system in my building failed inspection. I need to get it fixed and reinspected.',
};

const ANALYZING_STEPS = [
  'Reading your document...',
  'Identifying violation codes...',
  'Determining issuing agency...',
  'Assessing severity and penalties...',
  'Checking deadlines and hearing dates...',
  'Building your assessment...',
];

export default function LandingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Always scroll to top on load
    window.scrollTo(0, 0);

    if (localStorage.getItem('cs_free_used') === '1') {
      setTrialUsed(true);
    }
    // ?demo=1 triggers analyzing preview mode
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      setLoading(true);
      setFilePreview('/scan-flood.webp');
    }
    // Splash screen — show for 1.8s then fade out
    const timer = setTimeout(() => setPageLoaded(true), 2800);
    return () => clearTimeout(timer);
  }, []);

  // Fade-in on scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-visible');
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    // Small delay to let DOM render, then observe
    const t = setTimeout(() => {
      const els = document.querySelectorAll('.lp-fade-in');
      els.forEach((el) => observer.observe(el));
    }, 100);
    return () => { clearTimeout(t); observer.disconnect(); };
  }, []);

  const handleTextareaInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, []);

  useEffect(() => {
    if (loading) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [loading]);

  useEffect(() => {
    if (!loading) return;
    setActiveStep(0);
    const interval = setInterval(() => {
      setActiveStep((prev) => {
        if (prev >= ANALYZING_STEPS.length - 1) { clearInterval(interval); return prev; }
        return prev + 1;
      });
    }, 1800);
    return () => clearInterval(interval);
  }, [loading]);

  function selectFile(f: File) {
    setFile(f);
    setError(null);
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  }

  function removeFile() {
    setFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!file) return;
    if (trialUsed) { window.location.href = '/signup'; return; }
    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    if (context.trim()) formData.append('context', context.trim());

    try {
      const res = await fetch('/api/violations/preview', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); setLoading(false); return; }
      localStorage.setItem('cs_free_used', '1');
      setTrialUsed(true);
      setResult(data.preview);
      setTimeout(() => { window.scrollTo(0, 0); }, 100);
    } catch {
      setError('Connection failed. Check your internet and try again.');
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="lp-page">
      {/* ─── SPLASH SCREEN ─── */}
      <div className={`lp-splash ${pageLoaded ? 'lp-splash-out' : ''}`}>
        <div className="lp-splash-content">
          <img src="/logo.svg" alt="CrewShift" className="lp-splash-logo" />
          <div className="lp-splash-bar">
            <div className="lp-splash-bar-fill" />
          </div>
        </div>
      </div>

      <Nav mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />

      <main>
        {/* ─── HERO ─── */}
        {!loading && !result && (
          <>
            <section className={`lp-hero-section ${pageLoaded ? 'lp-hero-visible' : 'lp-hero-hidden'}`}>
              {/* Hero illustrations */}
              <div className="lp-hero-docs" aria-hidden="true">
                <img src="/illustrations/compliance-forms.svg" alt="" className="lp-hero-illus lp-hero-illus-left" />
                <img src="/illustrations/compliance-forms.svg" alt="" className="lp-hero-illus lp-hero-illus-right" />
              </div>
              <div className="lp-hero-content">
                <span className="lp-hero-badge">AI Compliance Engine</span>
                <h1 className="lp-headline">
                  <span className="lp-headline-accent">Compliance, automated.</span><br />
                  Built for construction<br />& real estate.
                </h1>
                <p className="lp-subtitle">
                  Violations resolved. Permits generated. Properties protected. Across every agency, on every building — automatically.
                </p>

                {/* Prompt Box */}
                <div
                  className="lp-prompt-box"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]); }}
                >
                  {file && (
                    <div className="lp-file-attachment">
                      {filePreview ? (
                        <img src={filePreview} alt="Preview" className="lp-file-thumb" />
                      ) : (
                        <div className="lp-file-pill">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="lp-file-name">{file.name}</span>
                        </div>
                      )}
                      <button onClick={removeFile} className="lp-remove-file" aria-label="Remove file">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <textarea
                    ref={textareaRef}
                    value={context}
                    onChange={(e) => { setContext(e.target.value); handleTextareaInput(); }}
                    placeholder="Upload a violation notice and we'll analyze it instantly — free."
                    className="lp-textarea"
                    rows={1}
                  />

                  <div className="lp-prompt-bottom">
                    <button onClick={() => fileInputRef.current?.click()} className="lp-attach-btn" aria-label="Attach file">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) => { if (e.target.files?.[0]) selectFile(e.target.files[0]); }}
                      style={{ display: 'none' }}
                    />
                    <button
                      onClick={() => {
                        if (!file) {
                          setError('Please attach a violation notice before submitting.');
                          return;
                        }
                        handleSubmit();
                      }}
                      className="lp-submit-btn active"
                      aria-label="Analyze"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  </div>
                </div>

                {!file && (
                  <p className="lp-drop-hint">Drag and drop a violation notice, or click attach. PDF, JPG, or PNG.</p>
                )}

                {error && (
                  <div className="lp-error-box">
                    <p>{error}</p>
                  </div>
                )}

              </div>
            </section>

            {/* ─── AGENCIES ─── */}
            <section className="lp-agencies-section lp-fade-in">
              <p className="lp-agencies-eyebrow">NYC Agencies</p>
              <h2 className="lp-agencies-title">
                Every agency that touches your building. <span className="lp-agencies-accent">Covered.</span>
              </h2>
              <p className="lp-agencies-subtitle">
                DOB, DEP, HPD, FDNY, ECB, DOT, Sanitation, 311. If it issues violations, we resolve them.
              </p>
              <div className="lp-agencies-banner">
                <div className="lp-agencies-track">
                  {[...Array(2)].map((_, setIdx) => (
                    <div key={setIdx} className="lp-agencies-set" aria-hidden={setIdx > 0}>
                      <img src="/logos/nyc-dob.webp" alt="NYC Department of Buildings" className="lp-agency-img" />
                      <img src="/logos/nyc-hpd.png" alt="NYC Housing Preservation & Development" className="lp-agency-img" />
                      <img src="/logos/nyc-dep.png" alt="NYC Department of Environmental Protection" className="lp-agency-img" />
                      <img src="/logos/nyc-fdny.png" alt="FDNY" className="lp-agency-img" />
                      <img src="/logos/nyc-dsny.svg" alt="NYC Department of Sanitation" className="lp-agency-img" />
                      <img src="/logos/nyc-dot.png" alt="NYC Department of Transportation" className="lp-agency-img" />
                      <img src="/logos/nyc-311.png" alt="NYC 311" className="lp-agency-img" />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ─── FEATURES ─── */}
            <FeaturesSection />

            {/* ─── WHO IT'S FOR ─── */}
            <section className="lp-personas-section lp-fade-in">
              <div className="lp-personas-inner">
                <div className="lp-personas-header">
                  <p className="lp-section-eyebrow">Who it&apos;s for</p>
                  <h2 className="lp-section-title">One platform. <span className="lp-headline-accent">Four problems solved.</span></h2>
                </div>
                <div className="lp-personas-grid">
                  <a href="/book-demo" className="lp-persona-card">
                    <h3 className="lp-persona-role">General Contractors</h3>
                    <p className="lp-persona-desc">Your crew is on site. DOB shows up. Now the job is frozen and you&apos;re holding a violation you didn&apos;t cause. We map permits before you break ground — so stop-work orders never happen.</p>
                    <span className="lp-persona-link">See how</span>
                  </a>
                  <a href="/book-demo" className="lp-persona-card">
                    <h3 className="lp-persona-role">Developers</h3>
                    <p className="lp-persona-desc">Six agencies. Twelve open filings. One missing document stalls your CO for months. We track every permit across every agency on every site — so closings stay on schedule.</p>
                    <span className="lp-persona-link">See how</span>
                  </a>
                  <a href="/book-demo" className="lp-persona-card">
                    <h3 className="lp-persona-role">Subcontractors</h3>
                    <p className="lp-persona-desc">You finished the job. Then the permit question comes. We tell you exactly which filings you need before the inspector does — so the client call is &quot;all clear,&quot; not &quot;we have a problem.&quot;</p>
                    <span className="lp-persona-link">See how</span>
                  </a>
                  <a href="/book-demo" className="lp-persona-card">
                    <h3 className="lp-persona-role">Property Owners</h3>
                    <p className="lp-persona-desc">A notice arrives. It&apos;s full of codes you&apos;ve never seen. Fines are climbing. We translate it to plain English, build your resolution plan, and tell you exactly what to do next.</p>
                    <span className="lp-persona-link">See how</span>
                  </a>
                </div>
              </div>
            </section>

            {/* ─── HOW IT WORKS ─── */}
            <section id="how" className="lp-how-section lp-fade-in">
              <div className="lp-how-inner">
                <div className="lp-how-header">
                  <p className="lp-section-eyebrow">How it works</p>
                  <h2 className="lp-section-title">Three steps. <span className="lp-headline-accent">Fully automated.</span></h2>
                </div>
                <HowItWorksProgress />
              </div>
            </section>

            {/* ─── FAQ ─── */}
            <section className="lp-faq-section lp-fade-in">
              <div className="lp-faq-inner">
                <p className="lp-section-eyebrow">FAQ</p>
                <h2 className="lp-section-title">Common questions</h2>
                <div className="lp-faq-list">
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">How does the AI read my violation?</summary>
                    <p className="lp-faq-answer">Snap a photo or upload the PDF. Our AI extracts the violation code, agency, penalty, and deadline in seconds — then cross-references public records to pull your full property history.</p>
                  </details>
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">What agencies do you cover?</summary>
                    <p className="lp-faq-answer">Every agency that can fine you. DOB, HPD, DEP, FDNY, ECB, DOT, DSNY, 311 — if it issues violations against buildings in NYC, we cover it. More cities coming soon.</p>
                  </details>
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">Why not just hire an expediter?</summary>
                    <p className="lp-faq-answer">Expediters charge $5K–$10K per violation and work on their timeline. We generate the same resolution plan instantly — permits, professionals, deadlines — across your entire portfolio at once.</p>
                  </details>
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">Can I manage multiple properties?</summary>
                    <p className="lp-faq-answer">That&apos;s the point. Every open violation, pending permit, and approaching deadline across all your properties — one dashboard, zero spreadsheets.</p>
                  </details>
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">Does it actually file the permits?</summary>
                    <p className="lp-faq-answer">We generate the complete packet — applications, checklists, required sign-offs — ready to submit. Direct agency filing is live for select portals and expanding fast.</p>
                  </details>
                  <details className="lp-faq-item">
                    <summary className="lp-faq-question">What does it cost?</summary>
                    <p className="lp-faq-answer">Less than a single expediter visit. Your first violation analysis is completely free — full resolution plan, permits, timeline. No card required.</p>
                  </details>
                </div>
              </div>
            </section>

            {/* ─── CTA ─── */}
            <section className="lp-cta-section lp-fade-in">
              <div className="lp-cta-card">
                <h2 className="lp-cta-title">Stop paying $10K per violation to <span className="lp-headline-accent">figure it out.</span></h2>
                <p className="lp-cta-text">Resolution plans in seconds, not weeks. Permits generated, deadlines tracked, professionals identified — all before the penalty doubles.</p>
                <div className="lp-cta-buttons">
                  <a href="/book-demo" className="lp-btn-primary lp-btn-large">Book a Demo</a>
                  <a href="/login" className="lp-btn-ghost">Log in</a>
                </div>
              </div>
            </section>

            {/* ─── FOOTER ─── */}
            <footer className="lp-footer">
              <div className="lp-footer-inner">
                <img src="/logo.svg" alt="CrewShift AI" className="lp-footer-logo" />
                <p className="lp-footer-copy">&copy; 2026 CrewShift AI. All rights reserved.</p>
              </div>
            </footer>
          </>
        )}

        {/* ─── ANALYZING ─── */}
        {loading && (
          <div className="lp-analyzing-fullscreen">
            <nav className="lp-nav">
              <div className="lp-nav-inner">
                <a href="/" className="lp-nav-logo">
                  <img src="/logo.svg" alt="CrewShift AI" style={{ height: '2.5rem' }} />
                </a>
                <div className="lp-nav-links">
                  <a href="/#features" className="lp-nav-link">Features</a>
                  <a href="/#how" className="lp-nav-link">How It Works</a>
                </div>
                <div className="lp-nav-right">
                  <a href="/login" className="lp-nav-link">Log in</a>
                  <a href="/book-demo" className="lp-btn-primary lp-btn-small">Book a Demo</a>
                </div>
              </div>
            </nav>
            <div className="lp-analyzing-body">
              <div className="lp-analyzing-split">
                <div className="lp-analyzing-left">
                  <div className="lp-scan-container lp-scan-container-lg">
                    {filePreview ? (
                      <img src={filePreview} alt="Uploaded document" className="lp-scan-image" />
                    ) : (
                      <div className="lp-scan-placeholder">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span>{file?.name}</span>
                      </div>
                    )}
                    <div className="lp-scan-line" />
                    <div className="lp-scan-corners">
                      <span className="lp-corner lp-corner-tl" />
                      <span className="lp-corner lp-corner-tr" />
                      <span className="lp-corner lp-corner-bl" />
                      <span className="lp-corner lp-corner-br" />
                    </div>
                  </div>
                </div>
                <div className="lp-analyzing-right">
                  <h2 className="lp-analyzing-title">Analyzing your violation<span className="lp-dots"><span>.</span><span>.</span><span>.</span></span></h2>
                  <p className="lp-analyzing-sub">Our AI is reading your document and building a resolution plan.</p>
                  <div className="lp-analysis-progress-bar">
                    <div
                      className="lp-analysis-progress-fill"
                      style={{ width: `${Math.min(((activeStep + 1) / ANALYZING_STEPS.length) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="lp-steps-list">
                    {ANALYZING_STEPS.map((step, i) => (
                      <div key={step} className={`lp-step-item ${i < activeStep ? 'done' : ''} ${i === activeStep ? 'active' : ''} ${i > activeStep ? 'pending' : ''}`}>
                        <span className="lp-step-dot">
                          {i < activeStep && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── RESULT ─── */}
        {result && (
          <section className="lp-result-section">
            <div ref={resultRef} className="lp-result">

              {/* ── Status Banner ── */}
              <div className="lp-status-banner" style={{ background: SEVERITY_CONFIG[result.violation.severity].bg, borderColor: SEVERITY_CONFIG[result.violation.severity].color }}>
                <div className="lp-status-left">
                  <span className="lp-status-dot" style={{ background: SEVERITY_CONFIG[result.violation.severity].color }} />
                  <span className="lp-status-severity" style={{ color: SEVERITY_CONFIG[result.violation.severity].color }}>
                    {SEVERITY_CONFIG[result.violation.severity].label} Violation
                  </span>
                </div>
                <span className="lp-status-urgency" style={{ color: URGENCY_CONFIG[result.assessment.urgency].color }}>
                  {URGENCY_CONFIG[result.assessment.urgency].label}
                </span>
              </div>

              {/* ── Header ── */}
              <div className="lp-result-header">
                <div className="lp-result-agency-badge">NYC {result.violation.agency}</div>
                <h2 className="lp-result-title">{result.violation.title}</h2>
                <div className="lp-result-meta">
                  {result.property.address && <span>{result.property.address}</span>}
                  {result.violation.code_section && <code className="lp-code-tag">{result.violation.code_section}</code>}
                </div>
              </div>

              {/* ── Plain English ── */}
              <div className="lp-explain-block">
                <p>{result.violation.plain_english}</p>
              </div>

              {/* ── Data Strip ── */}
              <div className="lp-data-strip">
                {result.violation.penalty_amount != null && (
                  <div className="lp-data-cell">
                    <span className="lp-data-label">Penalty</span>
                    <span className="lp-data-value lp-data-red">${result.violation.penalty_amount.toLocaleString()}</span>
                  </div>
                )}
                {result.violation.compliance_deadline && (
                  <div className="lp-data-cell">
                    <span className="lp-data-label">Deadline</span>
                    <span className="lp-data-value">{new Date(result.violation.compliance_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                )}
                {result.violation.hearing_date && (
                  <div className="lp-data-cell">
                    <span className="lp-data-label">Hearing</span>
                    <span className="lp-data-value">{new Date(result.violation.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                )}
                <div className="lp-data-cell">
                  <span className="lp-data-label">Est. Cost</span>
                  <span className="lp-data-value">{result.assessment.estimated_cost_range}</span>
                </div>
                <div className="lp-data-cell">
                  <span className="lp-data-label">Timeline</span>
                  <span className="lp-data-value">{result.assessment.estimated_timeline}</span>
                </div>
                {result.assessment.needs_licensed_professional && (
                  <div className="lp-data-cell">
                    <span className="lp-data-label">Professional</span>
                    <span className="lp-data-value lp-data-purple">Required</span>
                  </div>
                )}
              </div>

              {/* ── Two Column: Action + Warning ── */}
              <div className="lp-two-col">
                <div className="lp-action-block">
                  <div className="lp-block-icon lp-block-icon-orange">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <h3 className="lp-block-title">What needs to happen</h3>
                  <p className="lp-block-text">{result.assessment.what_needs_to_happen}</p>
                </div>

                <div className="lp-warning-block">
                  <div className="lp-block-icon lp-block-icon-red">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <h3 className="lp-block-title">If you ignore this</h3>
                  <p className="lp-block-text">{result.assessment.what_happens_if_ignored}</p>
                </div>
              </div>

              {/* ── Permits Needed ── */}
              {result.permits_likely_needed && result.permits_likely_needed.length > 0 && (
                <div className="lp-permits-section">
                  <h3 className="lp-permits-title">Permits you&apos;ll likely need to file</h3>
                  <div className="lp-permits-preview">
                    {/* Show first permit fully */}
                    <div className="lp-permit-card">
                      <div className="lp-permit-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </div>
                      <div className="lp-permit-info">
                        <span className="lp-permit-name">{result.permits_likely_needed[0].name}</span>
                        <span className="lp-permit-agency">{result.permits_likely_needed[0].agency}</span>
                        <p className="lp-permit-desc">{result.permits_likely_needed[0].description}</p>
                      </div>
                    </div>

                    {/* Faded remaining permits behind overlay */}
                    {result.permits_likely_needed.length > 1 && (
                      <div className="lp-permits-locked">
                        <div className="lp-permits-locked-cards">
                          <div className="lp-permit-card">
                            <div className="lp-permit-icon">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                              </svg>
                            </div>
                            <div className="lp-permit-info">
                              <span className="lp-permit-name">{result.permits_likely_needed[1].name}</span>
                              <span className="lp-permit-agency">{result.permits_likely_needed[1].agency}</span>
                            </div>
                          </div>
                        </div>
                        <div className="lp-permits-fade-overlay" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── CTA ── */}
              <div className="lp-result-cta">
                <h2 className="lp-result-cta-title">Want us to resolve this?</h2>
                <p className="lp-result-cta-text">This is just the preview. Book a demo and we handle the rest.</p>

                <ul className="lp-result-cta-list">
                  <li>Full step-by-step resolution pathway</li>
                  <li>Permit applications pre-filled and ready to file</li>
                  <li>Deadline and hearing date tracking with alerts</li>
                  <li>Expediting — we handle the agency back-and-forth</li>
                  <li>Licensed professional matching for your case</li>
                  <li>Portal auto-fill via Chrome extension</li>
                  <li>Portfolio dashboard across all your properties</li>
                  <li>Case tracking from violation to dismissal</li>
                </ul>

                <div className="lp-result-cta-buttons">
                  <a href="/book-demo" className="lp-btn-primary lp-btn-large">Book a Demo</a>
                  <a href="/login" className="lp-btn-ghost">Log in</a>
                </div>
              </div>

            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function FeaturesSection() {
  const [resStep, setResStep] = useState(0);

  useEffect(() => {
    const STEP_DELAY = 1200;
    const RESET_DELAY = 2000;
    const TOTAL_STEPS = 5;

    const timer = setTimeout(() => {
      setResStep(prev => {
        if (prev > TOTAL_STEPS) return 0;
        return prev + 1;
      });
    }, resStep > TOTAL_STEPS ? RESET_DELAY : resStep === 0 ? 800 : STEP_DELAY);

    return () => clearTimeout(timer);
  }, [resStep]);

  return (
    <section className="lp-features" id="features">
      <div id="features" className="lp-features-header lp-fade-in">
        <p className="lp-features-eyebrow">Features</p>
        <h2 className="lp-features-title">
          Meet your <span className="lp-headline-accent">compliance AI</span>
        </h2>
        <p className="lp-features-subtitle">
          AI-native compliance — from violation to resolution, fully automated.
        </p>
      </div>

      {/* Feature 1 */}
      <div className="lp-feature-row lp-fade-in">
        <div className="lp-feature-text">
          <h3 className="lp-feature-heading">Violation in. Resolution out.</h3>
          <p className="lp-feature-desc">
            One upload — photo, PDF, scan, anything. AI reads the code, pulls the property, maps the resolution. Every form. Every filing. Every professional. Every deadline. Instantly.
          </p>
          <ul className="lp-feature-bullets">
            <li><strong>AI extraction</strong> — violation codes, penalties, deadlines, and hearing dates pulled in seconds</li>
            <li><strong>Any format</strong> — photos, scans, PDFs, screenshots. Even blurry ones.</li>
            <li><strong>Full property pull</strong> — existing violations, permit history, building class, owner of record</li>
          </ul>
        </div>
        <div className="lp-feature-visual">
          <ProactiveScanAnimation />
        </div>
      </div>

      {/* Feature 2 */}
      <div className="lp-feature-row lp-feature-row-reverse lp-fade-in">
        <div className="lp-feature-text">
          <h3 className="lp-feature-heading">Permits, generated.</h3>
          <p className="lp-feature-desc">
            Each violation triggers the exact permits required — PW1, FISP, DEP, DOB NOW, all of it. Full packet. Checklists. Sign-off requirements. Cost estimates. Download. Submit.
          </p>
          <ul className="lp-feature-bullets">
            <li><strong>Resolution pathways</strong> — step-by-step action plans for every violation type</li>
            <li><strong>Full permit packets</strong> — documents, checklists, sign-offs, filing instructions</li>
            <li><strong>Cost estimates</strong> — realistic ranges so there are no surprises</li>
          </ul>
        </div>
        <div className="lp-feature-visual">
          <div className={`lp-feature-card-preview lp-fcp-steps ${resStep === 0 ? 'lp-fcp-resetting' : ''}`}>
            <div className="lp-fcp-step-top">
              <img src="/logo.svg" alt="CrewShift" className="lp-fcp-logo" />
              <span className={`lp-fcp-step-badge ${resStep > 5 ? 'lp-fcp-resolved' : ''}`}>{resStep > 5 ? 'Resolved' : 'Resolving...'}</span>
            </div>
            <div className="lp-fcp-step-header">Resolution Pathway</div>
            <div className="lp-fcp-step-progress">
              <div className="lp-fcp-step-progress-fill" style={{ width: `${Math.min(resStep, 5) * 20}%` }}></div>
            </div>
            {[
              'Violation identified',
              'Permits determined',
              'Obtain PW1 permit',
              'Submit correction to DOB',
              'Attend ECB hearing',
            ].map((label, i) => {
              const stepNum = i + 1;
              const isDone = resStep > stepNum;
              const isActive = resStep === stepNum;
              return (
                <div key={i} className={`lp-fcp-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''} ${resStep > 0 ? 'lp-fcp-visible' : ''}`} style={{ animationDelay: resStep > 0 ? `${i * 0.15}s` : undefined }}>
                  {isDone ? (
                    <span className="lp-fcp-step-check">&#10003;</span>
                  ) : (
                    <span className="lp-fcp-step-num">{stepNum}</span>
                  )}
                  {label}
                  {isActive && <span className="lp-fcp-step-spinner"></span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feature 3 */}
      <div className="lp-feature-row lp-fade-in">
        <div className="lp-feature-text">
          <h3 className="lp-feature-heading">Your entire portfolio. One screen.</h3>
          <p className="lp-feature-desc">
            Every open violation. Every pending permit. Every court date. Every professional assignment. Real-time. Across every property. AI surfaces what&apos;s urgent — you act on it.
          </p>
          <ul className="lp-feature-bullets">
            <li><strong>Deadline intelligence</strong> — penalties escalate, hearings approach. You&apos;ll know first.</li>
            <li><strong>AI prioritization</strong> — which violations to resolve first, which permits are ready to file</li>
            <li><strong>Portfolio-wide</strong> — every property, every agency, every deadline. One view.</li>
          </ul>
        </div>
        <div className="lp-feature-visual">
          <DashboardAnimation />
        </div>
      </div>
      {/* Feature 4 */}
      <div className="lp-feature-row lp-feature-row-reverse lp-fade-in">
        <div className="lp-feature-text">
          <h3 className="lp-feature-heading">We see what inspectors see.</h3>
          <p className="lp-feature-desc">
            Upload building photos. AI flags facade damage, signage issues, unpermitted work, sidewalk conditions — everything an inspector would write up. Each flag paired with the violation code, the penalty, and the fix.
          </p>
          <ul className="lp-feature-bullets">
            <li><strong>Proactive detection</strong> — find violations before the city does</li>
            <li><strong>Photo analysis</strong> — facades, fire escapes, signage, sidewalks, scaffolding</li>
            <li><strong>Instant remediation</strong> — each flag maps to the code, the fine, and the fix</li>
          </ul>
        </div>
        <div className="lp-feature-visual">
          <BuildingScanAnimation />
        </div>
      </div>
    </section>
  );
}

const HOW_STEPS = [
  { title: 'Upload the notice', desc: 'Photo, scan, PDF. AI reads it — violation code, agency, penalty, deadline, property record. All extracted in seconds.' },
  { title: 'Get the full plan', desc: 'Which permits to file. Which professionals to hire. What it costs. What happens if you wait. Every step, in order.' },
  { title: 'Resolve to dismissal', desc: 'Download permit packets. Track court dates. Mark off requirements. Case managed from the violation to the dismissal letter.' },
];

function HowItWorksProgress() {
  const [active, setActive] = useState(-1);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Start animation when scrolled into view
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && active === -1) {
          setActive(0);
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (active === -1) return;
    const timer = setTimeout(() => {
      if (done) {
        setDone(false);
        setActive(-1);
        // Small delay then restart
        setTimeout(() => setActive(0), 400);
      } else if (active >= 3) {
        setDone(true);
      } else {
        setActive(a => a + 1);
      }
    }, done ? 2500 : active >= 3 ? 1500 : 2400);
    return () => clearTimeout(timer);
  }, [active, done]);

  // Bar fills through each step: active=0 → 33%, active=1 → 66%, active=2 → 100%
  // Each step position: step 0 ends at 33%, step 1 ends at 66%, step 2 ends at 100%
  const progress = active === -1 ? 0 : done ? 100 : ((active + 1) / 3) * 100;

  // Green portion: steps that are fully complete (bar has passed them)
  // Step turns green when the bar has moved past it (i.e., active > i)
  const greenSteps = active === -1 ? 0 : done ? 3 : active;
  const greenPct = (greenSteps / 3) * 100;

  // The bar tip (orange) leads, green fills behind completed sections
  const gradientBg = done
    ? '#22c55e'
    : greenPct > 0 && progress > 0
      ? `linear-gradient(to bottom, #22c55e ${(greenPct / progress) * 100}%, var(--lp-orange) ${(greenPct / progress) * 100}%)`
      : 'var(--lp-orange)';

  return (
    <div className="lp-how-layout" ref={ref}>
      {/* Vertical progress bar on the left */}
      <div className="lp-how-bar">
        <div
          className="lp-how-bar-fill"
          style={{ height: `${progress}%`, background: gradientBg }}
        />
      </div>

      {/* Steps */}
      <div className="lp-how-steps">
        {HOW_STEPS.map((step, i) => {
          const isDone = (active > i && active !== -1) || done;
          const isActive = active === i;
          return (
            <div
              key={i}
              className={`lp-how-step ${isDone ? 'lp-how-step-done' : ''} ${isActive ? 'lp-how-step-active' : ''}`}
            >
              <span className="lp-how-num">{String(i + 1).padStart(2, '0')}</span>
              <div className="lp-how-content">
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SCAN_DOCUMENTS = [
  { label: 'DOB Violation Notice', rotation: -2 },
  { label: 'HPD Inspection Report', rotation: 1.5 },
  { label: 'ECB Hearing Notice', rotation: -1 },
  { label: 'DEP Compliance Order', rotation: 2 },
];

const SCAN_RESULTS = [
  { label: 'Facade deterioration', code: 'LL 11/98', penalty: '$15,000', severity: 'CRITICAL' as const, color: '#DC2626', bg: '#FEF2F2' },
  { label: 'Unpermitted signage', code: 'ZR §32-61', penalty: '$2,500', severity: 'MAJOR' as const, color: '#D97706', bg: '#FFFBEB' },
  { label: 'Fire escape deficiency', code: 'FC §504.4', penalty: '$5,000', severity: 'CRITICAL' as const, color: '#DC2626', bg: '#FEF2F2' },
  { label: 'Sidewalk damage', code: 'AC §7-210', penalty: '$1,500', severity: 'MODERATE' as const, color: '#2563EB', bg: '#EFF6FF' },
];

function ProactiveScanAnimation() {
  const [docIndex, setDocIndex] = useState(0);
  const [scanPhase, setScanPhase] = useState<'entering' | 'scanning' | 'result'>('entering');
  const [visibleResults, setVisibleResults] = useState<number[]>([]);

  useEffect(() => {
    if (scanPhase === 'entering') {
      const t = setTimeout(() => setScanPhase('scanning'), 900);
      return () => clearTimeout(t);
    }
    if (scanPhase === 'scanning') {
      const t = setTimeout(() => {
        setScanPhase('result');
        setVisibleResults(prev => {
          const next = [...prev, docIndex % SCAN_RESULTS.length];
          if (next.length > 3) next.shift();
          return next;
        });
      }, 2400);
      return () => clearTimeout(t);
    }
    if (scanPhase === 'result') {
      const t = setTimeout(() => {
        setDocIndex(i => (i + 1) % SCAN_DOCUMENTS.length);
        setScanPhase('entering');
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [scanPhase, docIndex]);

  const doc = SCAN_DOCUMENTS[docIndex];

  return (
    <div className="lp-scan">
      {/* Left: document with stack */}
      <div className="lp-scan-left">
        <div className="lp-scan-stack lp-scan-stack-2" />
        <div className="lp-scan-stack lp-scan-stack-1" />
        <div
          className={`lp-scan-doc ${scanPhase === 'entering' ? 'lp-scan-doc-enter' : ''}`}
          key={docIndex}
          style={{ transform: `rotate(${doc.rotation}deg)` }}
        >
          <img src="/violation-notice.gif" alt="Violation document" className="lp-scan-doc-img" />
          {scanPhase === 'scanning' && <div className="lp-scan-line" />}
          <div className="lp-scan-doc-label">{doc.label}</div>
        </div>
      </div>

      {/* Right: results */}
      <div className="lp-scan-right">
        {visibleResults.map((ri, i) => {
          const r = SCAN_RESULTS[ri];
          const isNew = i === visibleResults.length - 1 && scanPhase === 'result';
          return (
            <div
              key={`${ri}-${i}`}
              className={`lp-scan-chip ${isNew ? 'lp-scan-chip-new' : ''}`}
            >
              <div className="lp-scan-chip-left">
                <span
                  className="lp-scan-chip-severity"
                  style={{ color: r.color, background: r.bg }}
                >
                  {r.severity}
                </span>
                <span className="lp-scan-chip-title">{r.label}</span>
                <span className="lp-scan-chip-meta">{r.code}</span>
              </div>
              <span className="lp-scan-chip-penalty">{r.penalty}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`lp-dash-app ${visible ? 'lp-dash-active' : ''}`}>
      <div className="lp-dash-sidebar">
        <svg viewBox="0 0 198 229" fill="none" className="lp-dash-sidebar-logo">
          <path d="M197.996 114.773L197.996 190.77L132.176 228.766L66.367 190.77L197.996 114.773Z" fill="#FF751F"/>
          <path d="M0.551 152.77L0.551 76.773L132.176 0.781L175.094 25.559L197.996 38.773L66.367 114.773L66.367 190.77L0.551 152.77Z" fill="#FF751F"/>
        </svg>
        <div className="lp-dash-sidebar-dots">
          <span className="lp-dash-dot lp-dash-dot-active" />
          <span className="lp-dash-dot" />
          <span className="lp-dash-dot" />
          <span className="lp-dash-dot" />
        </div>
      </div>
      <div className="lp-dash-main">
        <div className="lp-dash-topbar">
          <span className="lp-dash-greeting">Dashboard</span>
          <span className="lp-dash-live">Live</span>
        </div>
        <div className="lp-dash-stats">
          <div className="lp-dash-stat">
            <span className="lp-dash-stat-num lp-dash-stat-red">12</span>
            <span className="lp-dash-stat-label">Violations</span>
          </div>
          <div className="lp-dash-stat">
            <span className="lp-dash-stat-num lp-dash-stat-orange">8</span>
            <span className="lp-dash-stat-label">Permits</span>
          </div>
          <div className="lp-dash-stat">
            <span className="lp-dash-stat-num">$127K</span>
            <span className="lp-dash-stat-label">Exposure</span>
          </div>
        </div>
        <div className="lp-dash-alerts">
          <div className="lp-dash-alert lp-dash-alert-red">
            <span className="lp-dash-alert-dot" />
            <span className="lp-dash-alert-text">ECB hearing in 3 days</span>
            <span className="lp-dash-alert-action">Prepare &rarr;</span>
          </div>
          <div className="lp-dash-alert lp-dash-alert-yellow">
            <span className="lp-dash-alert-dot" />
            <span className="lp-dash-alert-text">Penalty doubles in 14 days</span>
            <span className="lp-dash-alert-action">Assign &rarr;</span>
          </div>
          <div className="lp-dash-alert lp-dash-alert-green">
            <span className="lp-dash-alert-dot" />
            <span className="lp-dash-alert-text">PW1 ready to file</span>
            <span className="lp-dash-alert-action">File &rarr;</span>
          </div>
        </div>
        <div className="lp-dash-props">
          <div className="lp-dash-prop">
            <span className="lp-dash-prop-addr">123 Broadway, NY</span>
            <span className="lp-dash-prop-badge lp-dash-prop-red">3 open</span>
          </div>
          <div className="lp-dash-prop">
            <span className="lp-dash-prop-addr">456 W 42nd St, NY</span>
            <span className="lp-dash-prop-badge lp-dash-prop-green">Resolved</span>
          </div>
          <div className="lp-dash-prop">
            <span className="lp-dash-prop-addr">789 Park Ave, NY</span>
            <span className="lp-dash-prop-badge lp-dash-prop-orange">1 open</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const BUILDING_SCANS = [
  {
    img: '/scan-flood.webp',
    issue: 'Hallway Flooding',
    code: 'HPD §27-2005',
    severity: 'CRITICAL',
    color: '#DC2626',
    bg: '#FEF2F2',
    exposure: '$10,000–$25,000',
    steps: ['Emergency plumber dispatch', 'Water shutoff & remediation', 'HPD complaint response filing'],
  },
  {
    img: '/scan-ceiling.webp',
    issue: 'Ceiling Collapse & Water Damage',
    code: 'HPD Class C',
    severity: 'CRITICAL',
    color: '#DC2626',
    bg: '#FEF2F2',
    exposure: '$5,000–$15,000',
    steps: ['Licensed plumber leak repair', 'Ceiling & wall restoration', 'Lead paint abatement if pre-1978'],
  },
  {
    img: '/scan-watermain.jpg',
    issue: 'Water Main Leak',
    code: 'DEP §24-524',
    severity: 'CRITICAL',
    color: '#DC2626',
    bg: '#FEF2F2',
    exposure: '$15,000–$50,000',
    steps: ['DEP emergency notification', 'Licensed plumber main repair', 'DEP inspection & sign-off'],
  },
  {
    img: '/scan-pipes.webp',
    issue: 'Exposed Piping & Makeshift Repairs',
    code: 'DOB §28-105.1',
    severity: 'MAJOR',
    color: '#D97706',
    bg: '#FFFBEB',
    exposure: '$5,000–$25,000',
    steps: ['Licensed plumber replumb', 'PW1 permit application', 'DOB inspection & sign-off'],
  },
];

function BuildingScanAnimation() {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [phase, setPhase] = useState<'photo' | 'scanning' | 'result'>('photo');

  useEffect(() => {
    if (phase === 'photo') {
      const t = setTimeout(() => setPhase('scanning'), 700);
      return () => clearTimeout(t);
    }
    if (phase === 'scanning') {
      const t = setTimeout(() => setPhase('result'), 1800);
      return () => clearTimeout(t);
    }
    if (phase === 'result') {
      const t = setTimeout(() => {
        setPhotoIndex(i => (i + 1) % BUILDING_SCANS.length);
        setPhase('photo');
      }, 2800);
      return () => clearTimeout(t);
    }
  }, [phase, photoIndex]);

  const scan = BUILDING_SCANS[photoIndex];

  return (
    <div className="lp-bscan" key={photoIndex}>
      {/* Photo */}
      <div className="lp-bscan-photo-wrap">
        <img
          src={scan.img}
          alt={scan.issue}
          className={`lp-bscan-photo ${phase === 'photo' ? 'lp-bscan-photo-enter' : ''}`}
        />
        {/* Scan line */}
        {phase === 'scanning' && <div className="lp-bscan-scanline" />}
        {/* Scanning badge */}
        {phase === 'scanning' && (
          <div className="lp-bscan-scanning-badge">
            <div className="lp-bscan-scanning-dot" />
            Analyzing...
          </div>
        )}
      </div>

      {/* Result overlay — top right */}
      {phase === 'result' && (
        <div className="lp-bscan-result">
          <div className="lp-bscan-result-header">
            <svg viewBox="0 0 198 229" fill="none" className="lp-bscan-result-logo">
              <path d="M197.996 114.773L197.996 190.77L132.176 228.766L66.367 190.77L197.996 114.773Z" fill="#FF751F"/>
              <path d="M0.551 152.77L0.551 76.773L132.176 0.781L175.094 25.559L197.996 38.773L66.367 114.773L66.367 190.77L0.551 152.77Z" fill="#FF751F"/>
            </svg>
            <span className="lp-bscan-result-badge" style={{ color: scan.color, background: scan.bg }}>
              {scan.severity}
            </span>
          </div>
          <div className="lp-bscan-result-issue">{scan.issue}</div>
          <div className="lp-bscan-result-code">{scan.code}</div>
          <div className="lp-bscan-result-exposure">
            <span className="lp-bscan-result-exposure-label">Exposure</span>
            <span className="lp-bscan-result-exposure-val">{scan.exposure}</span>
          </div>
          <div className="lp-bscan-result-steps">
            {scan.steps.map((step, i) => (
              <div key={i} className="lp-bscan-result-step" style={{ animationDelay: `${i * 200}ms` }}>
                <span className="lp-bscan-step-num">{i + 1}</span>
                <span className="lp-bscan-step-text">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const VIOLATION_CARDS = [
  { severity: 'CRITICAL', badge: 'CRITICAL', color: '#DC2626', bg: '#FEF2F2', title: 'Work Without Permit', code: 'DOB \u00b7 \u00a728-105.1', penalty: '$10,000', deadline: 'Apr 15' },
  { severity: 'MAJOR', badge: 'MAJOR', color: '#D97706', bg: '#FFFBEB', title: 'No Hot Water', code: 'HPD \u00b7 Class C', penalty: '$5,000', deadline: 'Apr 30' },
  { severity: 'MODERATE', badge: 'MODERATE', color: '#2563EB', bg: '#EFF6FF', title: 'Backflow Prevention', code: 'DEP \u00b7 \u00a7BF-01', penalty: '$10,000', deadline: 'May 15' },
  { severity: 'CRITICAL', badge: 'CRITICAL', color: '#DC2626', bg: '#FEF2F2', title: 'Fire Alarm Deficiency', code: 'FDNY \u00b7 \u00a7FC 901', penalty: '$15,000', deadline: 'Mar 28' },
];

function ViolationMachine() {
  const [phase, setPhase] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const timings = [1800, 1000, 600, 2600, 500];
    const timer = setTimeout(() => {
      if (phase === 4) {
        setCardIndex(prev => (prev + 1) % VIOLATION_CARDS.length);
        setKey(k => k + 1);
        setPhase(0);
      } else {
        setPhase(p => p + 1);
      }
    }, timings[phase]);
    return () => clearTimeout(timer);
  }, [phase]);

  const card = VIOLATION_CARDS[cardIndex];

  return (
    <div className="lp-vm" key={key}>
      {/* Document falls toward logo */}
      <div className={`lp-vm-doc ${phase === 0 ? 'lp-vm-doc-fall' : ''}`}>
        <svg viewBox="0 0 497.186 497.186" fill="currentColor"><g><path d="M409.595,0H197.651c-22.646,0-41.048,18.415-41.048,41.044v13.968h-13.979c-22.63,0-41.064,18.398-41.064,41.043v14.016H87.613c-22.63,0-41.064,18.418-41.064,41.045v305.022c0,22.629,18.435,41.049,41.064,41.049h211.929c22.646,0,41.06-18.42,41.06-41.049v-13.979h13.968c22.63,0,41.059-18.417,41.059-41.063v-13.961h13.968c22.63,0,41.043-18.419,41.043-41.049V41.044C450.638,18.415,432.225,0,409.595,0z M307.832,456.138c0,4.569-3.727,8.278-8.29,8.278H87.613c-4.567,0-8.294-3.709-8.294-8.278V151.115c0-4.564,3.727-8.275,8.294-8.275h211.929c4.564,0,8.29,3.711,8.29,8.275V456.138z"/><path d="M137.842,228.396h85.237c9.042,0,16.398-7.334,16.398-16.393c0-9.051-7.356-16.376-16.398-16.376h-85.237c-9.036,0-16.394,7.325-16.394,16.376C121.449,221.063,128.806,228.396,137.842,228.396z"/><path d="M249.308,261.205H137.842c-9.036,0-16.394,7.336-16.394,16.391c0,9.054,7.357,16.379,16.394,16.379h111.466c9.058,0,16.377-7.325,16.377-16.379C265.685,268.541,258.366,261.205,249.308,261.205z"/><path d="M249.308,326.775H137.842c-9.036,0-16.394,7.319-16.394,16.377c0,9.053,7.357,16.377,16.394,16.377h111.466c9.058,0,16.377-7.324,16.377-16.377C265.685,334.095,258.366,326.775,249.308,326.775z"/><path d="M249.308,392.332H137.842c-9.036,0-16.394,7.318-16.394,16.375c0,9.054,7.357,16.394,16.394,16.394h111.466c9.058,0,16.377-7.34,16.377-16.394C265.685,399.65,258.366,392.332,249.308,392.332z"/></g></svg>
      </div>

      {/* Logo with spinning ring */}
      <div className={`lp-vm-center ${phase === 1 ? 'lp-vm-center-absorb' : ''}`}>
        <div className="lp-vm-ring" />
        <div className="lp-vm-glow" />
        <svg viewBox="0 0 198 229" fill="none" className="lp-vm-icon">
          <path d="M197.996 114.773L197.996 190.77L132.176 228.766L66.367 190.77L197.996 114.773Z" fill="#FF751F"/>
          <path d="M0.551 152.77L0.551 76.773L132.176 0.781L175.094 25.559L197.996 38.773L66.367 114.773L66.367 190.77L0.551 152.77Z" fill="#FF751F"/>
        </svg>
      </div>

      {/* Result card */}
      <div className={`lp-vm-out ${phase >= 2 && phase <= 3 ? 'lp-vm-out-show' : ''}`}>
        <div className="lp-vm-out-left">
          <span className="lp-vm-out-severity" style={{ color: card.color, background: card.bg }}>{card.badge}</span>
          <span className="lp-vm-out-title">{card.title}</span>
          <span className="lp-vm-out-meta">{card.code}</span>
        </div>
        <span className="lp-vm-out-penalty">{card.penalty}</span>
      </div>
    </div>
  );
}

function Nav({ mobileMenuOpen, setMobileMenuOpen }: { mobileMenuOpen: boolean; setMobileMenuOpen: (v: boolean) => void }) {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <a href="/" className="lp-nav-logo">
          <img src="/logo.svg" alt="CrewShift AI" style={{ height: '2.5rem' }} />
        </a>
        <div className="lp-nav-links">
          <a href="#features" className="lp-nav-link">Features</a>
          <a href="#how" className="lp-nav-link">How It Works</a>
        </div>
        <div className="lp-nav-right">
          <a href="/login" className="lp-nav-link">Log in</a>
          <a href="/book-demo" className="lp-btn-primary lp-btn-small">Book a Demo</a>
        </div>
        <button className="lp-hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
          <span className={`lp-hamburger-line ${mobileMenuOpen ? 'open' : ''}`} />
          <span className={`lp-hamburger-line ${mobileMenuOpen ? 'open' : ''}`} />
          <span className={`lp-hamburger-line ${mobileMenuOpen ? 'open' : ''}`} />
        </button>
      </div>
      {mobileMenuOpen && (
        <div className="lp-mobile-menu">
          <a href="#features" className="lp-mobile-link" onClick={() => setMobileMenuOpen(false)}>Features</a>
          <a href="#how" className="lp-mobile-link" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
          <a href="/login" className="lp-mobile-link" onClick={() => setMobileMenuOpen(false)}>Log in</a>
          <a href="/book-demo" className="lp-btn-primary" style={{ width: '100%', textAlign: 'center' }} onClick={() => setMobileMenuOpen(false)}>Book a Demo</a>
        </div>
      )}
    </nav>
  );
}
