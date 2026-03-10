import type { Contact, ContactType } from "@/types/finance";

const NAME_STOP_WORDS = new Set(["DE", "DEL", "LA", "LOS", "LAS", "Y"]);

function normalizeComparableText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeComparableText(value: string | null | undefined): string[] {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !NAME_STOP_WORDS.has(token));
}

function contactCandidateNames(contact: Contact): string[] {
  return [contact.name, contact.business_name || ""].filter(Boolean);
}

interface FindContactMatchParams {
  contacts: Contact[];
  preferredTypes: ContactType[];
  candidates: Array<string | null | undefined>;
}

export function findBestContactMatchId({
  contacts,
  preferredTypes,
  candidates,
}: FindContactMatchParams): string | null {
  const filteredContacts = contacts.filter((contact) =>
    preferredTypes.includes(contact.type)
  );
  if (!filteredContacts.length) {
    return null;
  }

  const normalizedCandidates = candidates
    .map((value) => normalizeComparableText(value))
    .filter(Boolean);

  if (!normalizedCandidates.length) {
    return null;
  }

  const candidateSet = new Set(normalizedCandidates);

  for (const contact of filteredContacts) {
    for (const name of contactCandidateNames(contact)) {
      const normalizedName = normalizeComparableText(name);
      if (normalizedName && candidateSet.has(normalizedName)) {
        return contact.id;
      }
    }
  }

  const targetTokenSet = new Set(
    normalizedCandidates.flatMap((candidate) => tokenizeComparableText(candidate))
  );
  if (targetTokenSet.size === 0) {
    return null;
  }

  let bestMatch: { id: string; score: number; overlap: number } | null = null;

  for (const contact of filteredContacts) {
    const contactTokenSet = new Set(
      contactCandidateNames(contact).flatMap((name) => tokenizeComparableText(name))
    );

    if (contactTokenSet.size === 0) {
      continue;
    }

    const overlap = Array.from(contactTokenSet).reduce((count, token) => {
      return targetTokenSet.has(token) ? count + 1 : count;
    }, 0);

    const score = overlap / contactTokenSet.size;
    const isStrongMatch = overlap >= 2 || score >= 0.7;
    if (!isStrongMatch) {
      continue;
    }

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score && overlap > bestMatch.overlap)
    ) {
      bestMatch = {
        id: contact.id,
        score,
        overlap,
      };
    }
  }

  return bestMatch?.id || null;
}
