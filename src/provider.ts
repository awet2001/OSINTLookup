export type Finding = {
  id: string;
  category: string;
  label: string;
  value: string;
  confidence: number;
  source: {
    name: string;
    kind: 'local-metadata' | 'licensed-provider';
    url?: string;
  };
  note?: string;
};

type ProviderPayload = {
  findings?: unknown;
};

type RawFinding = {
  category?: unknown;
  label?: unknown;
  value?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  note?: unknown;
};

const clean = (value: unknown, max = 300): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

export async function queryLicensedProvider(e164: string): Promise<{
  configured: boolean;
  providerName?: string;
  findings: Finding[];
  error?: string;
}> {
  const template = process.env.LICENSED_PROVIDER_URL?.trim();
  if (!template) return { configured: false, findings: [] };
  if (!template.includes('{phone}')) {
    return { configured: true, findings: [], error: 'LICENSED_PROVIDER_URL must contain {phone}.' };
  }

  const providerName = process.env.LICENSED_PROVIDER_NAME?.trim() || 'Licensed data provider';
  const url = template.replaceAll('{phone}', encodeURIComponent(e164));
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = process.env.LICENSED_PROVIDER_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(6000),
      redirect: 'error',
    });
    if (!response.ok) {
      return { configured: true, providerName, findings: [], error: `Provider returned HTTP ${response.status}.` };
    }

    const body = (await response.json()) as ProviderPayload;
    if (!Array.isArray(body.findings)) {
      return { configured: true, providerName, findings: [], error: 'Provider response did not contain a findings array.' };
    }

    const findings = (body.findings as RawFinding[]).slice(0, 25).flatMap((item, index) => {
      const label = clean(item.label, 100);
      const value = clean(item.value, 500);
      if (!label || !value) return [];
      const category = clean(item.category, 60) || 'identity';
      const confidenceValue = typeof item.confidence === 'number' ? item.confidence : 0.5;
      const confidence = Math.max(0, Math.min(1, confidenceValue));
      const sourceUrl = clean(item.sourceUrl, 500);
      const note = clean(item.note, 300);

      const finding: Finding = {
        id: `provider-${index + 1}`,
        category,
        label,
        value,
        confidence,
        source: {
          name: providerName,
          kind: 'licensed-provider',
          ...(sourceUrl ? { url: sourceUrl } : {}),
        },
        ...(note ? { note } : {}),
      };
      return [finding];
    });

    return { configured: true, providerName, findings };
  } catch {
    return { configured: true, providerName, findings: [], error: 'Provider request failed or timed out.' };
  }
}
