import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

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

export function buildResearchLinks(phone: PhoneIntelligence) {
  const variants = [phone.e164, phone.international, phone.national]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 3);

  const exact = variants.map((value) => `\"${value}\"`).join(' OR ');
  const encoded = encodeURIComponent(exact);

  return [
    {
      label: 'Search the public web (Google)',
      url: `https://www.google.com/search?q=${encoded}`,
      note: 'Opens a third-party search engine. The number is sent only when you click this link.',
    },
    {
      label: 'Search the public web (Bing)',
      url: `https://www.bing.com/search?q=${encoded}`,
      note: 'Opens a third-party search engine. The number is sent only when you click this link.',
    },
  ];
}
