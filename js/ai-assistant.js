// Basic, rule-based AI helper for the student portal. No external AI calls.
// Two jobs:
//   1. getAIResponse(question)      -> FAQ-style answers
//   2. checkEntryForFlags(text, past) -> simple heuristics that flag a new
//      logbook entry as possibly copy-pasted/falsified, for both the
//      student (soft warning) and the supervisor (a badge on review).

(function () {

  // ---- FAQ ----
  const FAQS = [
    { keywords: ['submit', 'logbook', 'entry', 'add entry', 'log book'],
      answer: 'Go to the Logbook tab, fill in the date and a description of what you worked on, then click "Submit entry". Your supervisor will review it and can leave a remark underneath.' },
    { keywords: ['chat', 'message', 'talk to', 'contact my supervisor'],
      answer: 'Use the Chat tab to message your assigned supervisor directly.' },
    { keywords: ['no supervisor', 'not assigned', 'don\u2019t have a supervisor', 'dont have a supervisor'],
      answer: 'That\u2019s normal early on \u2014 supervisors are sometimes assigned partway through the placement. Keep submitting your logbook entries in the meantime; your supervisor will see them once assigned.' },
    { keywords: ['flagged', 'flag', 'similar entry', 'falsification', 'duplicate'],
      answer: 'An entry gets flagged when it looks very close to something you already submitted. It\u2019s just a reminder to describe each day\u2019s actual work \u2014 it doesn\u2019t block your submission.' },
    { keywords: ['deadline', 'due', 'how often'],
      answer: 'There\u2019s no fixed deadline built into the portal \u2014 check with your SIWES coordinator or supervisor for how often they expect entries (usually weekly).' },
    { keywords: ['password', 'login', 'log in', 'forgot', 'sign in'],
      answer: 'If you\u2019re having trouble signing in, double-check your email and password. Self-service password reset isn\u2019t available \u2014 contact your administrator.' },
    { keywords: ['review', 'remark', 'comment', 'reviewed'],
      answer: 'Once your supervisor reviews an entry, their remark and a "Reviewed" badge will appear underneath it in your Logbook tab.' },
    { keywords: ['what is siwes', 'siwes mean', 'about siwes'],
      answer: 'SIWES (Student Industrial Work Experience Scheme) places students in industry for hands-on experience during their studies, coordinated through the Industrial Training Fund (ITF).' },
    { keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
      answer: 'Hi! Ask me about submitting your logbook, messaging your supervisor, or how entry flagging works.' },
  ];

  const FALLBACK = 'I can only help with common questions right now \u2014 try asking about submitting your logbook, messaging your supervisor, or entry flagging. For anything else, please contact your supervisor or SIWES coordinator.';

  function getAIResponse(question) {
    const q = question.toLowerCase();
    for (const faq of FAQS) {
      if (faq.keywords.some(k => q.includes(k))) return faq.answer;
    }
    return FALLBACK;
  }

  // ---- basic falsification heuristic ----
  // Normalizes text and compares word sets (Jaccard similarity) against the
  // student's own past entries. This is intentionally simple: it's a
  // classroom-project-level sanity check, not real plagiarism detection.
  function normalize(text) {
    return (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  }

  function jaccardSimilarity(wordsA, wordsB) {
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    setA.forEach(w => { if (setB.has(w)) intersection++; });
    const union = setA.size + setB.size - intersection;
    return union ? intersection / union : 0;
  }

  // pastEntries: [{ date, activities }]
  // returns null if nothing suspicious, otherwise a short reason string.
  function checkEntryForFlags(newText, pastEntries) {
    const trimmed = (newText || '').trim();

    if (trimmed.length > 0 && trimmed.length < 15) {
      return 'This entry is very short \u2014 consider adding more detail about what you actually did.';
    }

    const newWords = normalize(trimmed);
    if (!newWords.length) return null;

    for (const entry of (pastEntries || [])) {
      const pastWords = normalize(entry.activities);
      if (!pastWords.length) continue;
      const sim = jaccardSimilarity(newWords, pastWords);
      if (sim >= 0.85) {
        return `This looks very similar to your entry from ${entry.date || 'a previous day'} \u2014 please make sure it reflects that day's actual work.`;
      }
    }
    return null;
  }

  window.SiwesAI = { getAIResponse, checkEntryForFlags };

  // Wires up a simple chat-style Q&A UI. { logEl, inputEl, buttonEl }
  window.initAIAssistant = function ({ logEl, inputEl, buttonEl }) {
    if (!logEl || !inputEl || !buttonEl) return;
    if (logEl.dataset.initialized === 'true') return;
    logEl.dataset.initialized = 'true';

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function addBubble(text, mine) {
      const row = document.createElement('div');
      row.style.cssText = `align-self:${mine ? 'flex-end' : 'flex-start'};max-width:80%;`;
      row.innerHTML = `<div style="background:${mine ? 'var(--accent)' : '#f1f5f9'};color:${mine ? '#fff' : 'var(--text)'};padding:9px 14px;border-radius:14px;font-size:13.5px;line-height:1.5;">${escapeHtml(text)}</div>`;
      logEl.appendChild(row);
      logEl.scrollTop = logEl.scrollHeight;
    }

    addBubble('Hi! I\u2019m the SIWES helper bot. Ask me a question about the portal.', false);

    function handleAsk() {
      const val = inputEl.value.trim();
      if (!val) return;
      addBubble(val, true);
      inputEl.value = '';
      setTimeout(() => addBubble(getAIResponse(val), false), 250);
    }

    buttonEl.addEventListener('click', handleAsk);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleAsk(); } });
  };

})();
