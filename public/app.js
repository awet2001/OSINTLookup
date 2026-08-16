const form = document.querySelector('#lookup-form');
const phoneInput = document.querySelector('#phone');
const countryInput = document.querySelector('#country');
const scopeInput = document.querySelector('#scope');
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

function emptyState(root, message) {
  const empty = document.createElement('p');
  empty.textContent = message;
  root.append(empty);
}

function renderFindings(findings) {
  const root = document.querySelector('#findings');
  root.replaceChildren();

  if (!findings.length) {
    emptyState(root, 'No metadata or legacy findings were returned.');
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

function renderEntities(graph) {
  const root = document.querySelector('#entities');
  root.replaceChildren();
  const entities = graph?.entities || [];

  if (!entities.length) {
    emptyState(root, 'No resolved entities were returned. Configure a licensed provider to enrich the query.');
    return;
  }

  for (const entity of entities) {
    const card = document.createElement('article');
    card.className = 'finding';

    const body = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = entity.kind;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = entity.displayValue;
    body.append(heading, value);

    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    confidence.textContent = `${Math.round(entity.confidence * 100)}% evidence`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const sourceNames = (entity.sources || []).map((source) => source.name).join(', ');
    meta.textContent = `${entity.observationIds.length} observation(s) · ${sourceNames || 'unknown source'}`;

    card.append(body, confidence, meta);
    root.append(card);
  }
}

function renderRelationships(graph) {
  const root = document.querySelector('#relationships');
  root.replaceChildren();
  const entities = new Map((graph?.entities || []).map((entity) => [entity.id, entity]));
  const relationships = graph?.relationships || [];

  if (!relationships.length) {
    emptyState(root, 'No evidence-backed relationships were returned.');
    return;
  }

  for (const relationship of relationships) {
    const from = entities.get(relationship.fromEntityId);
    const to = entities.get(relationship.toEntityId);
    const card = document.createElement('article');
    card.className = 'finding';

    const body = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = relationship.type;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = `${from?.displayValue || relationship.fromEntityId} → ${to?.displayValue || relationship.toEntityId}`;
    body.append(heading, value);

    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    confidence.textContent = `${Math.round(relationship.confidence * 100)}% evidence`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${relationship.evidenceObservationIds.length} supporting observation(s)`;
    card.append(body, confidence, meta);
    root.append(card);
  }
}

function renderProviderDetails(providers) {
  const root = document.querySelector('#provider-details');
  root.replaceChildren();
  const statuses = providers?.statuses || [];
  if (!providers?.configured) {
    emptyState(root, 'No licensed enrichment provider is configured.');
    return;
  }
  if (!statuses.length) {
    emptyState(root, 'Provider configuration was detected, but no valid provider entries were loaded.');
    return;
  }

  for (const status of statuses) {
    const card = document.createElement('article');
    card.className = 'finding';
    const body = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = status.name;
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = status.ok ? 'Connected' : 'Provider error';
    body.append(heading, value);
    card.append(body);
    if (status.error) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = status.error;
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
    providerStatus.textContent = status.providerConfigured ? 'Enrichment providers configured' : 'Metadata-only mode';
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
        lookupScope: scopeInput.value,
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

    renderEntities(payload.graph);
    renderRelationships(payload.graph);
    renderFindings(payload.findings || []);
    renderProviderDetails(payload.providers);
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
