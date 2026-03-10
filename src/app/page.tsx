'use client';

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import './landing.css';

function WaitlistForm({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const [form, setForm] = useState({ name: '', businessName: '', email: '', phone: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const url = process.env.NEXT_PUBLIC_WAITLIST_URL;
    if (url) {
      try {
        await fetch(url, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify(form),
        });
      } catch {
        // silent fail — still show success
      }
    } else {
      await new Promise((r) => setTimeout(r, 800));
    }
    setSubmitted(true);
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div className="form-success" style={variant === 'dark' ? { color: '#fff' } : {}}>
        <h3 style={variant === 'dark' ? { color: '#fff' } : {}}>You&apos;re on the list.</h3>
        <p style={variant === 'dark' ? { color: 'rgba(255,255,255,.5)' } : {}}>We&apos;ll be in touch soon.</p>
      </div>
    );
  }

  const cls = variant === 'dark' ? 'waitlist-form dark' : 'waitlist-form';
  return (
    <form onSubmit={handleSubmit} className={cls}>
      <div className="wf-grid">
        <div className="wf-field">
          <input name="name" type="text" required value={form.name} onChange={handleChange} placeholder="Your name" />
        </div>
        <div className="wf-field">
          <input name="businessName" type="text" required value={form.businessName} onChange={handleChange} placeholder="Business name" />
        </div>
        <div className="wf-field">
          <input name="email" type="email" required value={form.email} onChange={handleChange} placeholder="Email address" />
        </div>
        <div className="wf-field">
          <input name="phone" type="tel" required value={form.phone} onChange={handleChange} placeholder="Phone number" />
        </div>
      </div>
      <div className="wf-submit">
        <button type="submit" disabled={submitting}>{submitting ? 'Joining...' : 'Get Early Access'}</button>
      </div>
    </form>
  );
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [showLogo, setShowLogo] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [fading, setFading] = useState(false);
  const fullText = 'WELCOME TO CREWSHIFT';
  const chars = fullText.split('');
  const crewshiftStart = fullText.indexOf('CREWSHIFT');

  useEffect(() => {
    const logoTimer = setTimeout(() => setShowLogo(true), 100);

    let i = 0;
    const revealTimer = setTimeout(() => {
      const interval = setInterval(() => {
        i++;
        setVisibleCount(i);
        if (i >= chars.length) {
          clearInterval(interval);
          setTimeout(() => setFading(true), 800);
          setTimeout(onDone, 1300);
        }
      }, 80);
      return () => clearInterval(interval);
    }, 500);

    return () => {
      clearTimeout(logoTimer);
      clearTimeout(revealTimer);
    };
  }, [onDone, chars.length]);

  return (
    <div className={`splash-screen${fading ? ' splash-fade' : ''}`}>
      <div className="splash-content">
        <svg
          className={`splash-logo${showLogo ? ' splash-logo-visible' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 198 230.25"
          preserveAspectRatio="xMidYMid meet"
        >
          <path fill="#ff751f" d="M 197.539062 114.640625 L 197.539062 190.546875 L 131.796875 228.503906 L 66.0625 190.546875 Z" />
          <path fill="#ff751f" d="M 0.320312 152.589844 L 0.320312 76.6875 L 131.796875 0.78125 L 174.664062 25.527344 L 197.539062 38.730469 L 66.0625 114.640625 L 66.0625 190.546875 Z" />
        </svg>
        <span className="splash-text">
          {chars.map((char, i) => (
            <span
              key={i}
              className={`splash-char${i >= crewshiftStart ? ' splash-orange' : ''}${i < visibleCount ? ' splash-char-visible' : ''}`}
            >
              {char === ' ' ? '\u00A0' : char}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    // Scroll-triggered fade-in animations
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.animate-on-scroll').forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, []);

  const faqs = [
    { q: 'What trades is this built for?', a: 'Plumbing, HVAC, electrical, roofing, general contracting. If you have techs in the field and an office that\'s drowning in admin, this is for you.' },
    { q: 'Do I have to switch off Jobber / ServiceTitan / QuickBooks?', a: 'No. CrewShift connects to all of them. It doesn\'t replace anything — it just makes everything you already have actually work together.' },
    { q: 'What does "AI agents" actually mean?', a: 'Think of them like back-office employees that never clock out. One handles invoices. One chases payments. One builds estimates. One manages your schedule. They run inside CrewShift and take action on your behalf.' },
    { q: 'Can it do stuff without asking me first?', a: 'Only if you let it. Every action goes through a review queue by default. You can approve one at a time, or flip specific agents to full auto once you trust them.' },
    { q: 'What does the waitlist get me?', a: 'First access when we launch, locked-in pricing that won\'t go up, and free hands-on setup from our team. No cost to join.' },
  ];

  const tools = [
    { name: 'Jobber', file: 'jobber.png' },
    { name: 'ServiceTitan', file: 'servicetitan.png' },
    { name: 'QuickBooks', file: 'quickbooks.svg' },
    { name: 'Housecall Pro', file: 'housecall-pro.png' },
    { name: 'Stripe', file: 'stripe.svg' },
    { name: 'Procore', file: 'procore.png' },
    { name: 'Xero', file: 'xero.svg' },
    { name: 'Salesforce', file: 'salesforce.svg' },
    { name: 'Square', file: 'square.svg' },
  ];

  return (
    <>
      {loading && <SplashScreen onDone={() => setLoading(false)} />}
      <Head>
        <title>CrewShift — AI Agents for Trade Businesses</title>
        <meta name="description" content="AI agents that handle invoicing, estimates, collections, and scheduling for HVAC, plumbing, electrical, and roofing companies." />
      </Head>

      <div className="page-wrapper">
        {/* ─── NAVBAR ─── */}
        <div className="navbar-component" role="banner">
          <div className="navbar-container">
            <a href="/" className="navbar-logo-link">
              <img src="/logo.svg" alt="CrewShift" className="navbar-logo" style={{ height: '2.25rem' }} />
            </a>
            <nav className="navbar-menu">
              <a href="#features" className="navbar-link">Features</a>
              <a href="#how-it-works" className="navbar-link">How It Works</a>
              <a href="#faq" className="navbar-link">FAQs</a>
            </nav>
            <div className="navbar-button-wrapper">
              <a href="#cta" className="button hide-mobile-portrait">Get Early Access</a>
            </div>
          </div>
        </div>

        <main className="main-wrapper">
          {/* ─── HERO ─── */}
          <header className="section-home-header">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-large">
                  <div className="home-header-component">
                    <div className="margin-bottom margin-xlarge">
                      <div className="text-align-center">
                        <div className="max-width-xlarge align-center">
                          <div className="hero-tag animate-on-scroll">
                            HVAC &middot; Plumbing &middot; Electrical &middot; Roofing &middot; GC
                          </div>
                          <div className="margin-bottom margin-small animate-on-scroll">
                            <h1>The back office that <span className="text-color-primary">runs without you</span></h1>
                          </div>
                          <p className="text-size-medium max-width-medium animate-on-scroll delay-1">You didn&apos;t start a trade business to chase invoices and babysit schedules. CrewShift handles invoicing, estimates, collections, and dispatch — automatically — while you focus on the work that pays.</p>

                          <div className="margin-top margin-medium animate-on-scroll delay-2">
                            <WaitlistForm variant="light" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="header-image-wrapper animate-on-scroll delay-3">
                      <img src="/hero-dashboard.svg" alt="CrewShift Dashboard" className="header-image" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* ─── FEATURE 1: AI AGENTS ─── */}
          <section id="features" className="section-home-feature">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-large">
                  <div className="w-layout-grid feature-component">
                    <div className="feature-content-wrapper animate-on-scroll">
                      <div className="margin-bottom margin-small">
                        <h2>Not another dashboard. An actual team.</h2>
                      </div>
                      <div className="margin-bottom margin-medium">
                        <p className="text-size-medium">Most software shows you what&apos;s happening. CrewShift does something about it. It invoices the moment a job closes, chases the payments you&apos;d forget, and builds quotes while you&apos;re still shaking the customer&apos;s hand.</p>
                      </div>
                      <div className="feature-keypoint-list">
                        {[
                          ['Invoicing', 'Tech marks a job done — invoice goes out and hits QuickBooks. You never opened a tab.'],
                          ['Estimates', 'Pulls your past pricing, factors in scope and materials, sends the quote same day.'],
                          ['Collections', 'Chases late payments with the right message at the right time. You stay out of it.'],
                        ].map(([title, desc]) => (
                          <div key={title} className="feature-keypoint-list-item">
                            <div className="check-circle">
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <div style={{ marginLeft: '.75rem' }}>
                              <strong>{title}</strong>
                              <span className="text-size-medium" style={{ display: 'block', marginTop: '.15rem' }}>{desc}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="feature-image-wrapper animate-on-scroll delay-1">
                      <img src="/feature-agents.svg" alt="CrewShift AI Agents" className="feature-image" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ─── FEATURE 2: DASHBOARD ─── */}
          <section className="section-home-feature">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-large">
                  <div className="w-layout-grid feature-component">
                    <div className="feature-image-wrapper animate-on-scroll">
                      <img src="/hero-dashboard.svg" alt="CrewShift Dashboard" className="feature-image is-left" />
                    </div>
                    <div className="feature-content-wrapper animate-on-scroll delay-1">
                      <div className="margin-bottom margin-small">
                        <h2>Stop flipping between six tabs</h2>
                      </div>
                      <div className="margin-bottom margin-medium">
                        <p className="text-size-medium">Quotes, jobs, invoices, customer calls, tech schedules, revenue — it&apos;s all on one screen. No more Jobber in one tab, QuickBooks in another, and your email in a third.</p>
                      </div>
                      <div className="w-layout-grid feature-list">
                        <div className="feature-item">
                          <div className="feature-item-icon-wrapper">
                            <div className="check-circle">
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                          <div className="feature-item-content-wrapper">
                            <div className="margin-bottom margin-xsmall">
                              <h3 className="heading-style-h5">It tells you what to do next</h3>
                            </div>
                            <p className="text-size-medium">Three quotes expiring this week. An invoice 45 days overdue. A scheduling conflict tomorrow morning. CrewShift surfaces it and can act on it with one click.</p>
                          </div>
                        </div>
                        <div className="feature-item">
                          <div className="feature-item-icon-wrapper">
                            <div className="check-circle">
                              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                          <div className="feature-item-content-wrapper">
                            <div className="margin-bottom margin-xsmall">
                              <h3 className="heading-style-h5">See everything the agents are doing</h3>
                            </div>
                            <p className="text-size-medium">A live feed of every invoice sent, every reminder delivered, every schedule change made. You see it all without doing any of it.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ─── INTEGRATIONS ─── */}
          <section className="section-home-tools">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-medium">
                  <div className="text-align-center">
                    <div className="margin-bottom margin-small">
                      <h2>Works with what you&apos;ve already got</h2>
                    </div>
                    <div className="margin-bottom margin-medium">
                      <p className="text-size-medium max-width-medium" style={{ margin: '0 auto' }}>You&apos;re not ripping anything out. CrewShift connects to Jobber, ServiceTitan, QuickBooks, Stripe, and 100+ other tools — then runs your whole operation across all of them.</p>
                    </div>
                  </div>
                  <div className="marquee-wrapper">
                    <div className="marquee-track">
                      {[...tools, ...tools].map((logo, i) => (
                        <div key={`${logo.name}-${i}`} className="marquee-item">
                          <img src={`/logos/${logo.file}`} alt={logo.name} className="marquee-logo" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-align-center" style={{ marginTop: '2.5rem' }}>
                    <a href="#cta" className="button">Get Early Access</a>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ─── HOW IT WORKS / BENEFITS ─── */}
          <section id="how-it-works" className="section-home-benefits">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-large">
                  <div className="margin-bottom margin-large">
                    <div className="align-center">
                      <div className="max-width-large">
                        <div className="margin-bottom margin-xsmall">
                          <div className="subheading"><div>How It Works</div></div>
                        </div>
                        <div className="text-align-center">
                          <h2>What changes when you turn it on</h2>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="w-layout-grid benefits-component animate-on-scroll">
                    {[
                      { title: 'Invoices go out the second a job closes', desc: 'Your tech marks it done. The invoice gets generated, sent to the customer, and synced to QuickBooks. Nobody touched it.' },
                      { title: 'Overdue payments get chased for you', desc: 'The right message, the right time. Lien deadlines tracked automatically. You stop being the bad guy asking for money.' },
                      { title: 'Schedule blows up? Already handled.', desc: 'Tech calls out sick at 7 AM. CrewShift has the afternoon rerouted before your coffee\'s cold.' },
                      { title: 'Quotes go out while you\'re still on-site', desc: 'Pulls your pricing history, factors in materials, builds the estimate. Customer gets it same day instead of next week.' },
                      { title: 'It learns how you run things', desc: 'Your markup preferences, your busy season, which customers pay slow. CrewShift picks up on all of it.' },
                      { title: 'Nothing happens without your say-so', desc: 'Every action sits in a review queue. Approve one by one, or let the agents you trust run on their own.' },
                    ].map((b) => (
                      <div key={b.title} className="benefits-item">
                        <div className="margin-bottom margin-xsmall">
                          <h3>{b.title}</h3>
                        </div>
                        <p>{b.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ─── FAQ ─── */}
          <section id="faq" className="section-home-faq">
            <div className="padding-global">
              <div className="container-small">
                <div className="padding-section-large">
                  <div className="margin-bottom margin-large">
                    <div className="text-align-center">
                      <div className="max-width-large">
                        <div className="margin-bottom margin-xsmall">
                          <div className="subheading"><div>FAQs</div></div>
                        </div>
                        <div className="margin-bottom margin-small">
                          <h2>Common questions</h2>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="faq-collection-list">
                    {faqs.map((item, i) => (
                      <div key={i} className="faq-collection-item">
                        <div className="faq-accordion">
                          <div className="faq-question" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                            <div className="heading-style-h6">{item.q}</div>
                            <svg
                              className={`faq-icon${faqOpen === i ? ' is-open' : ''}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                          </div>
                          <div className={`faq-answer faq-answer-content${faqOpen === i ? ' is-open' : ''}`}>
                            <div className="margin-bottom margin-small">
                              <p>{item.a}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ─── CTA ─── */}
          <section id="cta" className="section-home-cta">
            <div className="padding-global">
              <div className="container-large">
                <div className="padding-section-large">
                  <div className="home-cta-component animate-on-scroll">
                    <div className="text-align-center">
                      <div className="max-width-xlarge">
                        <div className="cta-accent" />
                        <div className="margin-bottom margin-small">
                          <h2 className="text-color-white">Your back office shouldn&apos;t need you.</h2>
                        </div>
                        <p className="text-size-medium" style={{ color: 'rgba(255,255,255,.5)', maxWidth: '32rem', margin: '0 auto' }}>Founding members get first access, locked-in pricing, and free white-glove setup. We&apos;re launching soon.</p>
                      </div>
                    </div>
                    <div className="margin-top margin-medium">
                      <WaitlistForm variant="dark" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* ─── FOOTER ─── */}
        <footer className="footer">
          <div className="padding-global">
            <div className="container-large">
              <div className="footer-component">
                <div className="padding-section-medium">
                  <div className="padding-bottom padding-xlarge" style={{ display: 'flex', justifyContent: 'center' }}>
                    <a href="/" className="footer-logo-link">
                      <img src="/logo.svg" alt="CrewShift" className="footer-logo" />
                    </a>
                  </div>
                  <div className="footer-bottom-wrapper">
                    <div className="footer-credit">&copy; 2026 CrewShift AI</div>
                    <a href="#" className="footer-legal-link">Privacy Policy</a>
                    <a href="#" className="footer-legal-link">Terms of Service</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
