const form = document.querySelector('#lookup-form');
const phoneInput = document.querySelector('#phone');
const countryInput = document.querySelector('#country');
const purposeInput = document.querySelector('#purpose');
const submitButton = document.querySelector('#submit');
const errorBox = document.querySelector('#error');
const results = document.querySelector('#results');
const providerStatus = document.querySelector('#provider-status');

const text = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
};

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

function renderFindings(findings) {
  const root = document.querySelector('#findings');
  root.replaceChildren();

  if (!findings.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No findings were returned.';
    root.append(empty);
    return;
  }

  for (const finding of findings) {
    const card = document.createElement('article');
    card.className = 'finding';

    const body = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = finding.label;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = finding.value;
    body.append(heading, value);

    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    confidence.textContent = `${Math.round(finding.confidence * 100)}% confidence`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Source: ${finding.source.name} · ${finding.category}`;

    card.append(body, confidence, meta);

    if (finding.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = finding.note;
      card.append(note);
    }

    root.append(card);
  }
}

function renderResearchLinks(links) {
  const root = document.querySelector('#research-links');
  root.replaceChildren();

  for (const item of links) {
    const anchor = document.createElement('a');
    anchor.className = 'research-link';
    anchor.href = item.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    const title = document.createElement('strong');
    title.textContent = item.label;
    const note = document.createElement('span');
    note.textContent = item.note;
    anchor.append(title, note);
    root.append(anchor);
  }
}

async function loadStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const status = await response.json();
    providerStatus.textContent = status.providerConfigured ? 'Licensed provider connected' : 'Metadata-only mode';
    providerStatus.classList.toggle('live', Boolean(status.providerConfigured));
  } catch {
    providerStatus.textContent = 'Status unavailable';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  submitButton.disabled = true;
  submitButton.textContent = 'Looking up…';

  try {
    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: phoneInput.value,
        defaultCountry: countryInput.value.trim().toUpperCase(),
        purposeAccepted: purposeInput.checked,
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Lookup failed.');

    text('#normalized', payload.phone.e164);
    text('#formatted', payload.phone.international);
    text('#country-result', payload.phone.countryName || payload.phone.countryCode || 'Unknown');
    text('#calling-code', `Calling code +${payload.phone.callingCode}`);
    text('#validity', payload.phone.valid ? 'Valid numbering pattern' : payload.phone.possible ? 'Possible pattern' : 'Not possible');
    text('#line-type', payload.phone.type ? `Type: ${payload.phone.type}` : 'Line type unavailable');

    renderFindings(payload.findings || []);
    renderResearchLinks(payload.researchLinks || []);
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Lookup failed.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Run lookup';
  }
});

loadStatus();
