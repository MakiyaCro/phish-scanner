// Content script — runs inside the Gmail tab
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'extractData') return;

  try {
    // --- SUBJECT ---
    // Gmail renders subject in an h2 with class "hP"
    const subjectEl = document.querySelector('h2.hP');
    const subject = subjectEl ? subjectEl.textContent.trim() : '';

    // --- SENDER ---
    // .gD has an "email" attribute and displays the sender address
    const senderEl = document.querySelector('span.gD');
    const from = senderEl
      ? (senderEl.getAttribute('email') || senderEl.textContent).trim()
      : '';

    // --- EMAIL BODY ---
    // .a3s.aiL is Gmail's unquoted message body container
    const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt .a3s');
    let body = '';
    bodyEls.forEach(el => { body += el.innerText + '\n'; });
    body = body.trim().substring(0, 3000);

    // --- LINKS (only from inside the email body) ---
    const links = [];
    const linkEls = document.querySelectorAll('.a3s a[href], .ii.gt a[href]');
    linkEls.forEach(a => {
      const href = a.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        links.push({ text: a.textContent.trim().substring(0, 80), url: href });
      }
    });

    // Confirm we actually got something — if subject is empty the email may not be open
    if (!subject && !from && !body) {
      sendResponse({ error: 'Email content not found — make sure an email is open' });
      return;
    }

    sendResponse({ subject, from, body, links });
  } catch (err) {
    sendResponse({ error: err.message });
  }

  return true; // keep channel open for async
});
