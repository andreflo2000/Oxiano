'use client'
import { useLang } from '@/lib/LangContext'

const CONTENT = {
  ro: {
    lang: 'RO',
    other: 'EN',
    updated: 'Ultima actualizare: 9 Aprilie 2026',
    title: 'Termeni și Condiții',
    subtitle: 'Oxiano · Sports Analytics SaaS',
    disclaimer_title: 'Disclaimer Important',
    disclaimer_body: 'Oxiano este o platformă de analiză statistică sportivă și business intelligence. Toate probabilitățile, indicatorii și analizele generate sunt produse matematice cu scop exclusiv educațional și informativ. Nu reprezintă sfat de pariere, recomandare financiară sau îndemn la pariuri sportive.',
    sections: [
      {
        n: '1',
        title: 'Acceptarea Termenilor',
        body: `Prin accesarea, descărcarea sau utilizarea platformei Oxiano (website, aplicație mobilă, API sau orice alt produs asociat), confirmi că ai citit, înțeles și ești de acord cu acești Termeni și Condiții ("Termenii") și cu Politica de Confidențialitate incorporată prin referință.

Dacă nu ești de acord cu oricare dintre prevederi, te rugăm să încetezi imediat utilizarea platformei. Continuarea utilizării după modificarea Termenilor constituie acceptul noilor versiuni.

Oxiano își rezervă dreptul de a modifica acești Termeni oricând, cu notificare prealabilă prin actualizarea datei de mai sus sau prin comunicare directă către utilizatorii înregistrați.`,
      },
      {
        n: '2',
        title: 'Descrierea Serviciului',
        body: `Oxiano oferă o platformă de analiză cantitativă a sportului, în prezent cu focus pe fotbalul european, incluzând:

• Modele probabilistice bazate pe XGBoost, ratinguri Elo dinamice și distribuții Poisson, antrenate pe 225.000+ meciuri din ligile europene (2005–2026)
• Indicatori statistici: confidence, edge față de piața bookmaker, valoare așteptată (EV), Criteriu Kelly
• Instrumente de gestiune a portofoliului de predicții (Combo Analyzer, Track Record)
• Clasamente live, date de meci și statistici sportive furnizate de terți (football-data.org, API-Football)
• Notificări prin e-mail și Telegram cu picks zilnice recalculate automat
• Rapoarte săptămânale și manual de interpretare parametri

Serviciul este furnizat "ca atare" (as-is). Ne rezervăm dreptul de a adăuga, modifica sau elimina funcționalități fără preaviz.`,
      },
      {
        n: '3',
        title: 'Limitarea Răspunderii',
        body: `În măsura maximă permisă de legea aplicabilă, Oxiano, directorii, angajații, agenții și furnizorii săi nu sunt responsabili pentru:

• Pierderi financiare directe, indirecte, incidentale, consecutive sau punitive rezultate din utilizarea platformei
• Decizii de pariere, investiție sau orice altă decizie financiară luate pe baza conținutului platformei
• Inexactitățile sau întârzierile datelor sportive furnizate de terți
• Întreruperi, erori sau indisponibilitatea temporară a serviciului
• Accesul neautorizat la contul tău ca urmare a neglijenței tale în protejarea credențialelor

Acuratețea modelului, măsurată exclusiv pe date out-of-sample (meciuri nevăzute de model), variază între 72% și 86% în funcție de ligă și prag de confidence. Performanțele istorice nu garantează rezultate viitoare.

Răspunderea totală maximă a Oxiano față de tine, pentru orice tip de cerere, nu va depăși suma plătită de tine pentru serviciu în ultimele 12 luni sau 50 EUR, oricare este mai mică.`,
      },
      {
        n: '4',
        title: 'Vârsta Minimă și Eligibilitate',
        body: `Platforma este destinată exclusiv utilizatorilor cu vârsta de minimum 18 ani. Prin utilizarea platformei, declari și garantezi că:

• Ai împlinit vârsta de 18 ani
• Ai capacitatea juridică de a încheia un contract obligatoriu
• Nu ești rezident al unei jurisdicții în care accesul la astfel de servicii este interzis prin lege
• Utilizezi platforma în scopuri legale și personale

Nu colectăm în mod intenționat date personale de la persoane cu vârsta sub 18 ani. Dacă devenim conștienți că am colectat astfel de date, le vom șterge imediat.`,
      },
      {
        n: '5',
        title: 'Utilizare Permisă și Interzisă',
        body: `Utilizare permisă:
• Accesarea și utilizarea platformei în scop personal și educațional
• Partajarea și citarea analizelor cu menționarea explicită a sursei (Oxiano — oxiano.com)
• Utilizarea API-ului Oxiano în propriile proiecte de analiză, în limitele planului de abonament

Utilizare interzisă (inclusiv, fără a fi limitativ la):
• Reproducerea, vânzarea sau sublicențierea conținutului platformei fără acordul scris prealabil
• Scraping automat, crawling sau extragerea în masă a datelor fără acord contractual
• Prezentarea predicțiilor Oxiano ca „certitudini", „garanții" sau „sfaturi de pariere" în orice canal public
• Utilizarea platformei pentru a înșela, manipula sau induce în eroare terți
• Orice activitate care violează legile aplicabile, inclusiv cele privind jocurile de noroc, protecția datelor sau dreptul de autor
• Tentative de acces neautorizat la sistemele, conturile sau datele altor utilizatori

Încălcarea acestor prevederi poate duce la suspendarea imediată a contului și la acțiuni legale.`,
      },
      {
        n: '6',
        title: 'Proprietate Intelectuală',
        body: `Toate elementele platformei — incluzând, fără limitare, modelele de machine learning, algoritmii, codul sursă, design-ul, textele, graficele, marca "Oxiano" și logo-ul asociat — sunt proprietatea exclusivă a Oxiano și sunt protejate prin drepturi de autor, mărci comerciale și alte legi de proprietate intelectuală aplicabile.

Datele sportive brute sunt furnizate de terți (football-data.org, API-Football, Kaggle datasets) sub licențele lor proprii; Oxiano nu revendică proprietatea asupra datelor brute.

Îți acordăm o licență limitată, neexclusivă, necomercială și revocabilă de a utiliza platforma exclusiv în scopurile permise descrise în Secțiunea 5.`,
      },
      {
        n: '7',
        title: 'Conturi, Abonamente și Plăți',
        body: `Conturi:
• Crearea unui cont este opțională; anumite funcționalități premium necesită un abonament activ
• Ești singurul responsabil pentru confidențialitatea credențialelor tale și pentru toate activitățile desfășurate sub contul tău
• Notifică-ne imediat la contact@oxiano.com în cazul oricărui acces neautorizat

Abonamente:
• Abonamentele plătite (Analyst, Pro) sunt procesate prin Gumroad, un merchant of record înregistrat fiscal
• Prețurile sunt afișate în RON sau EUR și includ TVA unde aplicabil
• Abonamentele sunt recurente lunar; poți anula oricând din panoul de cont
• Rambursările sunt disponibile în termen de 7 zile de la prima achiziție, dacă serviciul nu a fost utilizat semnificativ — contactează contact@oxiano.com

Suspendare:
• Ne rezervăm dreptul de a suspenda sau șterge conturi care încalcă acești Termeni, fără rambursare în cazul încălcărilor dovedite.`,
      },
      {
        n: '8',
        title: 'Confidențialitate și Protecția Datelor',
        body: `Colectarea și prelucrarea datelor tale personale este guvernată de Politica noastră de Confidențialitate, disponibilă la oxiano.com/privacy, care face parte integrantă din acești Termeni.

Prelucrăm datele tale în conformitate cu Regulamentul (UE) 2016/679 (GDPR) și Legea nr. 190/2018 privind protecția datelor în România. Ai dreptul de acces, rectificare, ștergere, restricționare a prelucrării, portabilitate și opoziție, exercitabile prin contact@oxiano.com.`,
      },
      {
        n: '9',
        title: 'Legea Aplicabilă și Soluționarea Disputelor',
        body: `Acești Termeni sunt guvernați și interpretați în conformitate cu legislația română și reglementările Uniunii Europene aplicabile, inclusiv GDPR și Directiva privind serviciile digitale (DSA).

Orice dispută, controversă sau pretenție izvorâtă din sau în legătură cu acești Termeni va fi soluționată, în primă instanță, pe cale amiabilă în termen de 30 de zile de la notificarea scrisă. În absența unui acord amiabil, disputele vor fi supuse jurisdicției exclusive a instanțelor competente din România.

Dacă ești rezident UE, ai de asemenea dreptul de a formula o plângere la autoritatea de supraveghere competentă din statul tău membru (în România: ANSPDCP — www.dataprotection.ro).

Dacă orice prevedere a acestor Termeni este declarată nulă sau inaplicabilă, restul prevederilor rămân în vigoare.`,
      },
      {
        n: '10',
        title: 'Modificări ale Serviciului și Termenilor',
        body: `Oxiano poate, în orice moment:
• Modifica, suspenda sau întrerupe orice parte a serviciului
• Actualiza acești Termeni pentru a reflecta schimbări legale, tehnice sau comerciale

Modificările semnificative vor fi comunicate cu cel puțin 14 zile înainte prin e-mail (dacă ai un cont înregistrat) sau prin notificare vizibilă pe platformă. Continuarea utilizării după intrarea în vigoare a modificărilor constituie acceptarea acestora.`,
      },
      {
        n: '11',
        title: 'Contact',
        body: `Pentru orice întrebare, solicitare sau notificare legată de acești Termeni, ne poți contacta la:

contact@oxiano.com
Oxiano · România
oxiano.com

Timp de răspuns estimat: 2–5 zile lucrătoare.`,
      },
    ],
  },
  en: {
    lang: 'EN',
    other: 'RO',
    updated: 'Last updated: April 9, 2026',
    title: 'Terms & Conditions',
    subtitle: 'Oxiano · Sports Analytics SaaS',
    disclaimer_title: 'Important Disclaimer',
    disclaimer_body: 'Oxiano is a sports statistical analysis and business intelligence platform. All probabilities, indicators, and analyses generated are mathematical outputs intended solely for educational and informational purposes. They do not constitute betting advice, financial recommendation, or any inducement to place sports bets.',
    sections: [
      {
        n: '1',
        title: 'Acceptance of Terms',
        body: `By accessing, downloading, or using the Oxiano platform (website, mobile application, API, or any associated product), you confirm that you have read, understood, and agree to these Terms & Conditions ("Terms") and to the Privacy Policy incorporated herein by reference.

If you do not agree with any provision, please immediately cease using the platform. Continued use after the Terms are modified constitutes acceptance of the new version.

Oxiano reserves the right to amend these Terms at any time, with prior notice by updating the date above or by direct communication to registered users.`,
      },
      {
        n: '2',
        title: 'Description of Service',
        body: `Oxiano provides a quantitative sports analytics platform, currently focused on European football, including:

• Probabilistic models based on XGBoost, dynamic Elo ratings, and Poisson distributions, trained on 225,000+ matches from European leagues (2005–2026)
• Statistical indicators: confidence, market edge vs. bookmakers, expected value (EV), Kelly Criterion
• Portfolio management tools (Combo Analyzer, Track Record)
• Live standings, match data, and sports statistics provided by third parties (football-data.org, API-Football)
• Email and Telegram notifications with daily auto-recalculated picks
• Weekly reports and parameter interpretation guide

The service is provided "as is." We reserve the right to add, modify, or remove features without prior notice.`,
      },
      {
        n: '3',
        title: 'Limitation of Liability',
        body: `To the maximum extent permitted by applicable law, Oxiano, its directors, employees, agents, and suppliers shall not be liable for:

• Direct, indirect, incidental, consequential, or punitive financial losses resulting from use of the platform
• Betting, investment, or any other financial decisions made based on platform content
• Inaccuracies or delays in sports data provided by third parties
• Service interruptions, errors, or temporary unavailability
• Unauthorized access to your account resulting from your failure to protect your credentials

Model accuracy, measured exclusively on out-of-sample data (matches unseen during training), ranges from 72% to 86% depending on league and confidence threshold. Past performance does not guarantee future results.

Oxiano's total maximum liability to you for any claim shall not exceed the amount paid by you for the service in the preceding 12 months, or EUR 50, whichever is lower.`,
      },
      {
        n: '4',
        title: 'Minimum Age and Eligibility',
        body: `The platform is intended exclusively for users aged 18 years or older. By using the platform, you represent and warrant that:

• You are at least 18 years of age
• You have the legal capacity to enter into a binding agreement
• You are not a resident of a jurisdiction where access to such services is prohibited by law
• You are using the platform for lawful and personal purposes

We do not knowingly collect personal data from individuals under 18. If we become aware of such data having been collected, it will be promptly deleted.`,
      },
      {
        n: '5',
        title: 'Permitted and Prohibited Use',
        body: `Permitted use:
• Accessing and using the platform for personal and educational purposes
• Sharing and citing analyses with explicit source attribution (Oxiano — oxiano.com)
• Using the Oxiano API in your own analytical projects, within the limits of your subscription plan

Prohibited use (including but not limited to):
• Reproducing, selling, or sublicensing platform content without prior written consent
• Automated scraping, crawling, or mass extraction of data without a contractual agreement
• Presenting Oxiano predictions as "certainties," "guarantees," or "betting tips" on any public channel
• Using the platform to deceive, manipulate, or mislead third parties
• Any activity that violates applicable laws, including those relating to gambling, data protection, or copyright
• Attempts to gain unauthorized access to other users' systems, accounts, or data

Violations may result in immediate account suspension and legal action.`,
      },
      {
        n: '6',
        title: 'Intellectual Property',
        body: `All elements of the platform — including, without limitation, machine learning models, algorithms, source code, design, texts, graphics, the "Oxiano" trademark, and associated logo — are the exclusive property of Oxiano and are protected by copyright, trademark, and other applicable intellectual property laws.

Raw sports data is provided by third parties (football-data.org, API-Football, Kaggle datasets) under their own licenses; Oxiano does not claim ownership of raw data.

We grant you a limited, non-exclusive, non-commercial, and revocable license to use the platform solely for the permitted purposes described in Section 5.`,
      },
      {
        n: '7',
        title: 'Accounts, Subscriptions and Payments',
        body: `Accounts:
• Account creation is optional; certain premium features require an active subscription
• You are solely responsible for the confidentiality of your credentials and for all activities conducted under your account
• Notify us immediately at contact@oxiano.com in the event of any unauthorized access

Subscriptions:
• Paid subscriptions (Analyst, Pro) are processed via Gumroad, a registered fiscal merchant of record
• Prices are displayed in RON or EUR and include VAT where applicable
• Subscriptions renew monthly; you may cancel at any time from your account panel
• Refunds are available within 7 days of initial purchase if the service has not been significantly used — contact contact@oxiano.com

Suspension:
• We reserve the right to suspend or delete accounts that violate these Terms, without refund in cases of proven violations.`,
      },
      {
        n: '8',
        title: 'Privacy and Data Protection',
        body: `The collection and processing of your personal data is governed by our Privacy Policy, available at oxiano.com/privacy, which forms an integral part of these Terms.

We process your data in accordance with Regulation (EU) 2016/679 (GDPR) and applicable Romanian data protection legislation. You have the rights of access, rectification, erasure, restriction, portability, and objection, exercisable via contact@oxiano.com.`,
      },
      {
        n: '9',
        title: 'Governing Law and Dispute Resolution',
        body: `These Terms are governed by and construed in accordance with Romanian law and applicable European Union regulations, including the GDPR and the Digital Services Act (DSA).

Any dispute, controversy, or claim arising from or in connection with these Terms shall be resolved, in the first instance, amicably within 30 days of written notice. In the absence of an amicable resolution, disputes shall be submitted to the exclusive jurisdiction of the competent courts in Romania.

If you are an EU resident, you also have the right to lodge a complaint with the competent supervisory authority in your member state (in Romania: ANSPDCP — www.dataprotection.ro).

If any provision of these Terms is found to be null or unenforceable, the remaining provisions shall remain in full force and effect.`,
      },
      {
        n: '10',
        title: 'Changes to Service and Terms',
        body: `Oxiano may, at any time:
• Modify, suspend, or discontinue any part of the service
• Update these Terms to reflect legal, technical, or commercial changes

Material changes will be communicated at least 14 days in advance via email (if you have a registered account) or through a prominent notice on the platform. Continued use after the changes take effect constitutes acceptance of the updated Terms.`,
      },
      {
        n: '11',
        title: 'Contact',
        body: `For any questions, requests, or notices related to these Terms, you may contact us at:

contact@oxiano.com
Oxiano · Romania
oxiano.com

Estimated response time: 2–5 business days.`,
      },
    ],
  },
}

export default function TermsPage() {
  const { lang, setLang } = useLang()
  const t = CONTENT[(lang === 'ro' ? 'ro' : 'en') as 'ro' | 'en']

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #051F14 0%, #0A1128 100%)', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '48px 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
            {(['ro', 'en'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                style={{
                  padding: '6px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  fontFamily: 'monospace', letterSpacing: '0.1em', cursor: 'pointer',
                  background: lang === l ? '#22d3ee' : 'transparent',
                  color: lang === l ? '#000' : '#6b7280',
                  border: lang === l ? '1px solid #22d3ee' : '1px solid #374151',
                  transition: 'all 0.15s',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            {t.title}
          </h1>
          <div style={{ fontSize: 11, color: '#22d3ee', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 4 }}>
            {t.subtitle}
          </div>
          <div style={{ fontSize: 11, color: '#4b5563', fontFamily: 'monospace' }}>{t.updated}</div>
        </div>

        {/* Disclaimer */}
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 14, padding: '20px 24px', marginBottom: 32 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 10 }}>
            {t.disclaimer_title}
          </div>
          <p style={{ fontSize: 14, color: '#d1d5db', lineHeight: 1.7, margin: 0 }}>
            {t.disclaimer_body}
          </p>
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {t.sections.map(s => (
            <div key={s.n} style={{ background: '#0f1f35', border: '1px solid #1e3a5f', borderRadius: 14, padding: '24px 28px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 12 }}>
                {s.n}. {s.title}
              </div>
              <div style={{ fontSize: 14, color: '#9ca3af', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: '#374151', fontFamily: 'monospace' }}>
          © 2026 Oxiano · All rights reserved ·{' '}
          <a href="/privacy" style={{ color: '#4b5563' }}>Privacy Policy</a>
        </div>

      </main>

      <footer style={{ borderTop: '1px solid #1f2937', padding: '24px', textAlign: 'center', color: '#4b5563', fontSize: 12 }}>
        Oxiano — Statistical analysis for educational purposes · Not betting advice
      </footer>
    </div>
  )
}
