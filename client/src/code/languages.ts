import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/** Stored as a file's language to turn syntax highlighting off (null means "detect from the file name"). */
export const PLAIN_TEXT = 'Normal text';

export const LANGUAGES: readonly LanguageDescription[] = [...languages].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
);

export const detectLanguage = (fileName: string): LanguageDescription | null => LanguageDescription.matchFilename(languages, fileName);

export const findLanguage = (name: string): LanguageDescription | null => LanguageDescription.matchLanguageName(languages, name, false);

/** The language a file is shown in: the one chosen for it, or else the one its name suggests. */
export function resolveLanguage(language: string | null, fileName: string): LanguageDescription | null {
  if (language === PLAIN_TEXT) return null;
  return (language && findLanguage(language)) || detectLanguage(fileName);
}

/** Languages grouped by first letter, like Notepad++'s Language menu. */
export function languageGroups(): [string, LanguageDescription[]][] {
  const groups = new Map<string, LanguageDescription[]>();
  for (const description of LANGUAGES) {
    const first = description.name[0]!.toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    groups.set(letter, [...(groups.get(letter) ?? []), description]);
  }
  return [...groups];
}
