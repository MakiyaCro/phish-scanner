document.addEventListener('DOMContentLoaded', () => {
  const scanBtn    = document.getElementById('scanBtn');
  const clearBtn   = document.getElementById('clearBtn');
  const outputDiv  = document.getElementById('outputDiv');
  const statusText = document.getElementById('statusText');
  const riskBadge  = document.getElementById('riskBadge');
  const lineCount  = document.getElementById('lineCount');

  // --- Logging helpers ---
  function log(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-line log-${type}`;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    el.textContent = `[${ts}] ${text}`;
    outputDiv.appendChild(el);
    outputDiv.scrollTop = outputDiv.scrollHeight;
    lineCount.textContent = `(${outputDiv.children.length} lines)`;
  }

  function logDivider() {
    log('─'.repeat(42), 'divider');
  }

  function setStatus(text, cls) {
    statusText.textContent = text;
    statusText.className = 'status-value ' + cls;
  }

  // --- Clear button ---
  clearBtn.addEventListener('click', () => {
    outputDiv.innerHTML = '';
    lineCount.textContent = '';
    riskBadge.textContent = '';
    riskBadge.className = 'risk-badge';
    setStatus('READY', 'status-ready');
  });

  // --- Scan button ---
  scanBtn.addEventListener('click', async () => {
    outputDiv.innerHTML = '';
    lineCount.textContent = '';
    riskBadge.textContent = '';
    riskBadge.className = 'risk-badge';
    setStatus('SCANNING...', 'status-scanning glitch');
    scanBtn.disabled = true;

    try {
      // 1. Get the active tab — this is the Gmail page, NOT the popup
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      log('>> Checking active tab...', 'info');

      if (!tab || !tab.url) {
        log('❌ Cannot read tab URL', 'error');
        log('   Reload the extension and try again', 'error');
        setStatus('ERROR', 'status-error');
        scanBtn.disabled = false;
        return;
      }

      // 2. Confirm we're on Gmail
      if (!tab.url.includes('mail.google.com')) {
        log('❌ Not on Gmail.com', 'error');
        log(`   Current tab: ${tab.url.substring(0, 60)}...`, 'error');
        log('   Navigate to mail.google.com and open an email', 'error');
        setStatus('WRONG TAB', 'status-error');
        scanBtn.disabled = false;
        return;
      }

      log(`>> Gmail tab detected ✓`, 'info');
      log(`>> Injecting content scanner...`, 'info');
      logDivider();

      // 3. Send message to content script running inside the Gmail tab
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });
      } catch (msgErr) {
        log('❌ Content script unreachable', 'error');
        log('   Try: refresh Gmail, then reopen this panel', 'error');
        log(`   Detail: ${msgErr.message}`, 'error');
        setStatus('ERROR', 'status-error');
        scanBtn.disabled = false;
        return;
      }

      if (!response || response.error) {
        log(`❌ ${response?.error || 'No data returned from Gmail'}`, 'error');
        log('   Make sure an email is open (not just the inbox list)', 'error');
        setStatus('NO EMAIL OPEN', 'status-error');
        scanBtn.disabled = false;
        return;
      }

      // 4. Display extracted data
      log('EXTRACTED DATA:', 'header');
      log(`  SUBJECT : ${response.subject || '(none)'}`, 'data');
      log(`  FROM    : ${response.from    || '(none)'}`, 'data');
      log(`  LINKS   : ${response.links.length} found`, 'data');
      log(`  BODY    : ${response.body.length} chars`, 'data');
      logDivider();

      // 5. Phishing analysis
      log('THREAT ANALYSIS:', 'header');
      const { indicators, score } = analyzeEmail(response);

      indicators.forEach(ind => log(`  ${ind.flag} ${ind.message}`, ind.type));

      logDivider();

      // 6. Verdict
      let verdictText, verdictClass, badgeClass;
      if (score >= 4) {
        verdictText  = 'HIGH RISK — LIKELY PHISHING';
        verdictClass = 'status-danger';
        badgeClass   = 'log-danger';
      } else if (score >= 2) {
        verdictText  = 'MEDIUM RISK — REVIEW CAREFULLY';
        verdictClass = 'status-warning';
        badgeClass   = 'log-warning';
      } else {
        verdictText  = 'LOW RISK — APPEARS SAFE';
        verdictClass = 'status-safe';
        badgeClass   = 'log-safe';
      }

      log(`VERDICT: ${verdictText}`, score >= 4 ? 'danger' : score >= 2 ? 'warning' : 'safe');
      setStatus(verdictText, verdictClass);
      riskBadge.textContent = `SCORE: ${score}`;
      riskBadge.className   = `risk-badge ${badgeClass}`;

    } catch (err) {
      log(`❌ UNEXPECTED ERROR: ${err.message}`, 'error');
      setStatus('ERROR', 'status-error');
    }

    scanBtn.disabled = false;
  });

  // --- Phishing analysis logic ---
  function analyzeEmail({ subject = '', from = '', body = '', links = [] }) {
    const indicators = [];
    let score = 0;

    const sub  = subject.toLowerCase();
    const bod  = body.toLowerCase();
    const frm  = from.toLowerCase();

    // --- Urgent / threatening language ---
    const urgentWords = [
      'urgent', 'immediately', 'action required', 'act now',
      'verify your', 'confirm your', 'update your', 'validate',
      'suspended', 'compromised', 'unusual activity', 'unauthorized',
      'limited time', 'expires soon', 'account locked', 'security alert',
      'click here', 'login now', 'sign in now',
    ];
    const hitWords = urgentWords.filter(w => sub.includes(w) || bod.includes(w));
    if (hitWords.length > 0) {
      const pts = Math.min(hitWords.length, 2);
      score += pts;
      indicators.push({
        flag: '⚠',
        message: `Urgency/manipulation language: ${hitWords.slice(0, 3).join(', ')}`,
        type: 'warning',
      });
    }

    // --- Sensitive data requests ---
    const sensitiveWords = ['password', 'credit card', 'social security', 'ssn', 'bank account', 'bitcoin', 'wire transfer'];
    const hitSensitive = sensitiveWords.filter(w => sub.includes(w) || bod.includes(w));
    if (hitSensitive.length > 0) {
      score += 2;
      indicators.push({
        flag: '🔴',
        message: `Requests sensitive info: ${hitSensitive.slice(0, 2).join(', ')}`,
        type: 'danger',
      });
    }

    // --- Link analysis ---
    const trustedDomains = [
      'google.com', 'gmail.com', 'youtube.com', 'microsoft.com',
      'apple.com', 'amazon.com', 'paypal.com', 'github.com',
      'linkedin.com', 'twitter.com', 'x.com', 'instagram.com',
    ];

    const urlShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'short.link'];

    links.forEach(({ url, text }) => {
      try {
        const parsed   = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        // IP address as hostname
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
          score += 3;
          indicators.push({ flag: '🔴', message: `IP-address link: ${hostname}`, type: 'danger' });
          return;
        }

        // Known URL shortener
        if (urlShorteners.some(s => hostname === s || hostname.endsWith('.' + s))) {
          score += 2;
          indicators.push({ flag: '⚠', message: `URL shortener hides destination: ${hostname}`, type: 'warning' });
          return;
        }

        // Check if it mimics a trusted domain (typosquat)
        const isTrusted = trustedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
        if (!isTrusted) {
          const looksLike = trustedDomains.find(d => {
            const base = d.split('.')[0];
            return hostname.includes(base) && hostname !== d;
          });
          if (looksLike) {
            score += 3;
            indicators.push({
              flag: '🔴',
              message: `Possible typosquat of ${looksLike}: ${hostname}`,
              type: 'danger',
            });
          }
        }

        // Mismatched link text vs actual URL
        if (text && text.startsWith('http')) {
          try {
            const displayedHost = new URL(text).hostname.toLowerCase();
            if (displayedHost !== hostname) {
              score += 2;
              indicators.push({
                flag: '⚠',
                message: `Link text/URL mismatch: shows "${displayedHost}" → goes to "${hostname}"`,
                type: 'warning',
              });
            }
          } catch { /* text wasn't a valid URL */ }
        }
      } catch { /* invalid URL, skip */ }
    });

    // --- Suspicious sender domain ---
    const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
    const senderDomain = frm.match(/@([\w.-]+)/)?.[1] || '';
    if (senderDomain && !freeDomains.includes(senderDomain)) {
      // Check if sender mimics a trusted brand
      const mimic = trustedDomains.find(d => {
        const base = d.split('.')[0];
        return senderDomain.includes(base) && senderDomain !== d;
      });
      if (mimic) {
        score += 3;
        indicators.push({
          flag: '🔴',
          message: `Sender domain spoofs "${mimic}": ${senderDomain}`,
          type: 'danger',
        });
      }
    }

    // No indicators found
    if (indicators.length === 0) {
      indicators.push({ flag: '✓', message: 'No phishing indicators detected', type: 'safe' });
    }

    return { indicators, score };
  }
});
