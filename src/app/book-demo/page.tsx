'use client';

import { useState, useEffect } from 'react';
import '../landing.css';

const COMPANY_SIZES = [
  '1–5 technicians',
  '6–15 technicians',
  '16–50 technicians',
  '50+ technicians',
];

const PROJECT_VOLUMES = [
  '1–10 projects/month',
  '11–50 projects/month',
  '51–200 projects/month',
  '200+ projects/month',
];

export default function BookDemoPage() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    companySize: '',
    projectVolume: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(t);
  }, []);

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isValid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.phone.trim() &&
    form.company.trim() &&
    form.companySize &&
    form.projectVolume;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    // TODO: send to API / CRM
    await new Promise((r) => setTimeout(r, 800));
    setSubmitted(true);
    setSubmitting(false);
  };

  return (
    <div className="lp-demo-page">
      {/* Navbar */}
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
            <a href="/book-demo" className="lp-btn-primary lp-btn-small" style={{ opacity: 0.6, pointerEvents: 'none' }}>Book a Demo</a>
          </div>
        </div>
      </nav>

      <main className={`lp-demo-main ${loaded ? 'lp-demo-loaded' : ''}`} style={{ opacity: 0, transform: 'translateY(16px)', transition: 'opacity 0.6s ease, transform 0.6s ease' }}>
        {/* Left column */}
        <div className="lp-demo-left">
          <span className="lp-demo-badge">Limited Early Access</span>
          <h1 className="lp-demo-title">Book a Demo</h1>
          <p className="lp-demo-subtitle">
            Be among the first property teams to automate violation resolution with AI.
            We&apos;re launching soon and early access is limited.
          </p>

          <div className="lp-demo-perks">
            <div className="lp-demo-perk">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z"/></svg>
              <span>Early access to the platform</span>
            </div>
            <div className="lp-demo-perk">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>Priority onboarding support</span>
            </div>
            <div className="lp-demo-perk">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              <span>Founding member pricing</span>
            </div>
            <div className="lp-demo-perk">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M12 8v8m-4-4h8"/></svg>
              <span>Shape the product roadmap</span>
            </div>
          </div>
        </div>

        {/* Right column — form */}
        <div className="lp-demo-right">
          {submitted ? (
            <div className="lp-demo-success">
              <div className="lp-demo-success-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111', marginBottom: '0.5rem' }}>You&apos;re on the list!</h2>
              <p style={{ color: '#6B7280', lineHeight: 1.6 }}>
                We&apos;ll reach out shortly to schedule your demo. Keep an eye on your inbox.
              </p>
              <a href="/" className="lp-btn-primary" style={{ marginTop: '1.5rem', display: 'inline-block' }}>Back to Home</a>
            </div>
          ) : (
            <form className="lp-demo-form" onSubmit={handleSubmit}>
              <div className="lp-demo-row">
                <div className="lp-demo-field">
                  <label htmlFor="firstName">First Name</label>
                  <input
                    id="firstName"
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => update('firstName', e.target.value)}
                    placeholder="John"
                  />
                </div>
                <div className="lp-demo-field">
                  <label htmlFor="lastName">Last Name</label>
                  <input
                    id="lastName"
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => update('lastName', e.target.value)}
                    placeholder="Smith"
                  />
                </div>
              </div>

              <div className="lp-demo-field">
                <label htmlFor="email">Work Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="john@company.com"
                />
              </div>

              <div className="lp-demo-field">
                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="lp-demo-field">
                <label htmlFor="company">Company Name</label>
                <input
                  id="company"
                  type="text"
                  required
                  value={form.company}
                  onChange={(e) => update('company', e.target.value)}
                  placeholder="Acme Property Management"
                />
              </div>

              <div className="lp-demo-row">
                <div className="lp-demo-field">
                  <label htmlFor="companySize">Company Size</label>
                  <select
                    id="companySize"
                    required
                    value={form.companySize}
                    onChange={(e) => update('companySize', e.target.value)}
                  >
                    <option value="" disabled>Select range</option>
                    {COMPANY_SIZES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="lp-demo-field">
                  <label htmlFor="projectVolume">Projects per Month</label>
                  <select
                    id="projectVolume"
                    required
                    value={form.projectVolume}
                    onChange={(e) => update('projectVolume', e.target.value)}
                  >
                    <option value="" disabled>Select range</option>
                    {PROJECT_VOLUMES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="lp-demo-submit"
                disabled={!isValid || submitting}
              >
                {submitting ? 'Submitting...' : 'Book a Demo  \u2192'}
              </button>

              <p className="lp-demo-disclaimer">
                By signing up, you agree to receive updates about CrewShift AI.
                We respect your privacy and won&apos;t share your information.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
