import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import type { ResolvedEntity } from './model';

export class LookupInputError extends Error {}

export type PhoneIntelligence = {
  e164: string;
  international: string;
  national: string;
  countryCode?: string;
  countryName?: string;
  callingCode: string;
  nationalNumber: string;
  possible: boolean;
  valid: boolean;
  type?: string;
};

export type ResearchCategory = 'broad' | 'documents' | 'profiles' | 'business' | 'messaging' | 'pivot';

export type ResearchLink = {
  id: string;
  category: ResearchCategory;
  label: string;
  engine: 'Google' | 'Bing' | 'Direct';
  url: string;
  note: string;
  query?: string;
};

export function inspectPhone(raw: string, defaultCountry?: string): PhoneIntelligence {
  const input = raw.trim();
  if (!input || input.length > 64) throw new LookupInputError('Enter a phone number.');

  const country = defaultCountry?.trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw new LookupInputError('Default country must be a two-letter ISO country code.');
  }

  const parsed = parsePhoneNumberFromString(input, country as CountryCode | undefined);
  if (!parsed) throw new LookupInputError('The phone number could not be parsed.');

  const countryCode = parsed.country;
  const countryName = countryCode
    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode)
    : undefined;
  const lineType = parsed.getType();

  return {
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    ...(countryCode ? { countryCode } : {}),
    ...(countryName ? { countryName } : {}),
    callingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
    possible: parsed.isPossible(),
    valid: parsed.isValid(),
    ...(lineType ? { type: lineType } : {}),
  };
}

const quoted = (value: string): string => `\"${value.replaceAll('"', '')}\"`;

const unique = (values: string[]): string[] =>
  values.filter((value, index, all) => value && all.indexOf(value) === index);

const googleUrl = (query: string): string => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
const bingUrl = (query: string): string => `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

function phoneVariants(phone: PhoneIntelligence): string[] {
  return unique([
    phone.e164,
    phone.e164.replace(/^\+/, ''),
    phone.international,
    phone.national,
    phone.national.replace(/\D/g, ''),
    `00${phone.callingCode}${phone.nationalNumber}`,
  ]).slice(0, 6);
}

function queryLinks(
  id: string,
  category: ResearchCategory,
  label: string,
  query: string,
  note: string,
): ResearchLink[] {
  return [
    {
      id: `${id}-google`,
      category,
      label: `${label} · Google`,
      engine: 'Google',
      query,
      url: googleUrl(query),
      note,
    },
    {
      id: `${id}-bing`,
      category,
      label: `${label} · Bing`,
      engine: 'Bing',
      query,
      url: bingUrl(query),
      note,
    },
  ];
}

function buildEntityPivots(phone: PhoneIntelligence, entities: ResolvedEntity[]): ResearchLink[] {
  const phoneAnchor = `(${quoted(phone.e164)} OR ${quoted(phone.national)})`;
  const pivots: ResearchLink[] = [];
  const candidates = entities
    .filter((entity) => entity.kind !== 'phone' && entity.confidence >= 0.7)
    .slice(0, 8);

  for (const entity of candidates) {
    if (entity.kind === 'person') {
      const query = `${quoted(entity.displayValue)} ${phoneAnchor}`;
      pivots.push(...queryLinks(
        `pivot-person-${pivots.length}`,
        'pivot',
        `Correlate person: ${entity.displayValue}`,
        query,
        'Uses a high-confidence resolved person as a second search key. Verify that search results refer to the same person before relying on them.',
      ));
      continue;
    }

    if (entity.kind === 'email') {
      const query = quoted(entity.displayValue);
      pivots.push(...queryLinks(
        `pivot-email-${pivots.length}`,
        'pivot',
        `Search email: ${entity.displayValue}`,
        query,
        'Searches the exact resolved email address for public mentions. The value is sent only when you open a link.',
      ));
      continue;
    }

    if (entity.kind === 'organization') {
      const query = `${quoted(entity.displayValue)} ${phoneAnchor}`;
      pivots.push(...queryLinks(
        `pivot-org-${pivots.length}`,
        'pivot',
        `Correlate organization: ${entity.displayValue}`,
        query,
        'Combines the resolved organization with the phone number to reduce unrelated matches.',
      ));
      continue;
    }

    if (entity.kind === 'domain') {
      const domain = entity.displayValue.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
      if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        const query = `site:${domain} ${phoneAnchor}`;
        pivots.push(...queryLinks(
          `pivot-domain-${pivots.length}`,
          'pivot',
          `Search resolved domain: ${domain}`,
          query,
          'Restricts the search to a high-confidence resolved domain.',
        ));
      }
      continue;
    }

    if (entity.kind === 'profile') {
      try {
        const profileUrl = new URL(entity.displayValue);
        if (profileUrl.protocol === 'https:' || profileUrl.protocol === 'http:') {
          pivots.push({
            id: `pivot-profile-${pivots.length}`,
            category: 'pivot',
            label: `Open resolved profile: ${profileUrl.hostname}`,
            engine: 'Direct',
            url: profileUrl.toString(),
            note: 'Directly opens the public profile URL returned by a configured source. Verify the profile before treating it as the same identity.',
          });
        }
      } catch {
        // Ignore malformed profile values rather than generating an unsafe link.
      }
    }
  }

  return pivots.slice(0, 12);
}

export function buildResearchLinks(phone: PhoneIntelligence, entities: ResolvedEntity[] = []): ResearchLink[] {
  const variants = phoneVariants(phone);
  const exact = variants.map(quoted).join(' OR ');
  const exactGroup = `(${exact})`;
  const countryContext = phone.countryName ? ` ${quoted(phone.countryName)}` : '';

  const links: ResearchLink[] = [
    ...queryLinks(
      'phone-exact',
      'broad',
      'Exact phone mentions',
      exactGroup,
      'Searches several exact formatting variants. The number is sent to the search engine only when you open a link.',
    ),
    ...queryLinks(
      'phone-documents',
      'documents',
      'Public PDF documents',
      `${exactGroup} filetype:pdf`,
      'Targets indexed PDF documents such as public contact sheets, reports, brochures, notices, and archived publications.',
    ),
    ...queryLinks(
      'phone-data-files',
      'documents',
      'Public office/data files',
      `${exactGroup} (filetype:xls OR filetype:xlsx OR filetype:csv OR filetype:doc OR filetype:docx)`,
      'Looks for the exact phone number in indexed public spreadsheets and office documents.',
    ),
    ...queryLinks(
      'phone-profiles',
      'profiles',
      'Public profile mentions',
      `${exactGroup} (site:linkedin.com OR site:facebook.com OR site:instagram.com OR site:tiktok.com OR site:x.com OR site:github.com)`,
      'Restricts results toward common public profile platforms. A result is only a lead; verify identity before linking it to the number.',
    ),
    ...queryLinks(
      'phone-business',
      'business',
      'Business and contact pages',
      `${exactGroup}${countryContext} (\"contact\" OR \"phone\" OR \"telephone\" OR \"mobile\" OR \"company\" OR \"business\")`,
      'Looks for public business/contact pages and adds country context when available.',
    ),
    ...queryLinks(
      'phone-messaging',
      'messaging',
      'Public messaging/contact mentions',
      `${exactGroup} (\"WhatsApp\" OR \"Telegram\" OR \"Signal\")`,
      'Looks only for publicly indexed pages that explicitly mention the number alongside common messaging/contact terms.',
    ),
    ...buildEntityPivots(phone, entities),
  ];

  return links.slice(0, 24);
}
