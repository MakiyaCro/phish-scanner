// Content script — runs inside the Gmail tab

// Field length caps — prevents unbounded data being sent to the popup
const MAX_SUBJECT_LEN = 500;
const MAX_FROM_LEN    = 200;
const MAX_BODY_LEN    = 3000;
const MAX_LINK_TEXT   = 100;
const MAX_LINK_URL    = 2000;
const MAX_LINKS       = 30;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return;
  // Only handle the one action we expect
  if (typeof request !== 'object' || request.action !== 'extractData') return;

  // Use async IIFE so we can await inside the listener
  (async () => {
    try {
      // --- SUBJECT ---
      const subjectEl = document.querySelector('h2.hP');
      const subject   = (subjectEl ? subjectEl.textContent.trim() : '').substring(0, MAX_SUBJECT_LEN);

      // --- SENDER ---
      const senderEl = document.querySelector('span.gD');
      const from     = (senderEl
        ? (senderEl.getAttribute('email') || senderEl.textContent).trim()
        : '').substring(0, MAX_FROM_LEN);

      // --- EMAIL BODY ---
      const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt .a3s');
      let body = '';
      bodyEls.forEach(el => { body += el.innerText + '\n'; });
      body = body.trim().substring(0, MAX_BODY_LEN);

      // --- LINKS (only from inside the email body, capped) ---
      const links = [];
      document.querySelectorAll('.a3s a[href], .ii.gt a[href]').forEach(a => {
        if (links.length >= MAX_LINKS) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // Only accept http/https URLs — drop javascript:, data:, etc.
        if (!href.startsWith('http://') && !href.startsWith('https://')) return;
        // Validate the URL is actually parseable before storing it
        try { new URL(href); } catch { return; }
        links.push({
          text: a.textContent.trim().substring(0, MAX_LINK_TEXT),
          url:  href.substring(0, MAX_LINK_URL),
        });
      });

      if (!subject && !from && !body) {
        sendResponse({ error: 'Email content not found — make sure an email is open' });
        return;
      }

      // --- AUTH SIGNALS ---
      const authSignals = await extractAuthSignals();

      sendResponse({ subject, from, body, links, authSignals });
    } catch (err) {
      // Never send raw error stack to popup — only the message
      sendResponse({ error: String(err.message).substring(0, 200) });
    }
  })();

  return true; // keep channel open for async
});


async function extractAuthSignals() {
  const signals = {
    gmailWarning: null,   // text of Gmail's own phishing/suspicious banner
    mailedBy:    null,    // mailed-by domain from expanded header
    signedBy:    null,    // signed-by domain from expanded header
    encryption:  null,    // TLS / standard encryption label
    senderVia:   null,    // "via domain.com" shown next to sender name
  };

  try {
    // 1. Gmail phishing / suspicious warning banner
    //    Gmail adds a prominent red/yellow bar when it suspects phishing.
    //    We validate the text contains actual warning language to avoid
    //    false positives from unrelated UI elements (e.g. "to me" labels).
    const WARNING_KEYWORDS = [
      'careful', 'phish', 'suspicious', 'dangerous', 'spam',
      'malware', 'fake', 'scam', 'warn', 'threat', 'blocked',
      'deceptive', 'reported', 'harmful',
    ];
    const warningSelectors = [
      '.h7 .aef',              // red "Be careful" banner text
      '.TN.cL .aef',           // alternate warning container
      '[data-message-id] .xD', // spoofing notice
    ];
    for (const sel of warningSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.textContent.trim();
      const isRealWarning = WARNING_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
      if (isRealWarning) {
        signals.gmailWarning = text.substring(0, 200);
        break;
      }
    }

    // 2. "via domain.com" label that Gmail renders inline next to the sender
    //    This appears in the collapsed header without any clicking needed.
    const headerRow = document.querySelector('.hb, .gE.iv.gt, .gs .gE');
    if (headerRow) {
      const viaMatch = headerRow.textContent.match(/via\s+([\w.-]+\.[a-z]{2,})/i);
      if (viaMatch) signals.senderVia = viaMatch[1].toLowerCase();
    }

    // 3. Expand the sender details panel to get mailed-by / signed-by / encryption.
    //    Gmail shows these only after clicking the "Show details" toggle (▼).
    const showDetailsBtn = document.querySelector('[aria-label="Show details"]');
    if (showDetailsBtn) {
      showDetailsBtn.click();

      // Wait for the panel to render
      await new Promise(r => setTimeout(r, 450));

      // The expanded details live in a div that contains label spans
      // Gmail uses "aV3" class for the label column (e.g. "mailed-by:")
      const detailsContainer = document.querySelector('.adn, .ads');
      if (detailsContainer) {
        // Flatten text and look for key: value patterns
        const detailText = detailsContainer.innerText || detailsContainer.textContent;

        const mailedMatch  = detailText.match(/mailed-by[:\s]+([\w.-]+)/i);
        const signedMatch  = detailText.match(/signed-by[:\s]+([\w.-]+)/i);
        const encryptMatch = detailText.match(/security[:\s]+([^\n\r]{1,80})/i);

        if (mailedMatch)  signals.mailedBy   = mailedMatch[1].trim().toLowerCase();
        if (signedMatch)  signals.signedBy   = signedMatch[1].trim().toLowerCase();
        if (encryptMatch) signals.encryption = encryptMatch[1].trim();
      }

      // Collapse the panel again to leave Gmail's UI unchanged
      const hideBtn = document.querySelector('[aria-label="Hide details"]');
      if (hideBtn) hideBtn.click();
    }
  } catch {
    // Auth signal extraction is best-effort — never block the main response
  }

  return signals;
}
