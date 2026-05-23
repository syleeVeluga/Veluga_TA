import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enTranslations from './locales/en.json';
import koTranslations from './locales/ko.json';

function syncAppLanguage(language: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalizedLanguage = language.startsWith('en') ? 'en' : 'ko';
  window.electronAPI?.config?.save({ language: normalizedLanguage }).catch(() => {
    /* ignore */
  });
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: {
        translation: koTranslations,
      },
      en: {
        translation: enTranslations,
      },
    },
    fallbackLng: 'ko',
    supportedLngs: ['ko', 'en'],
    interpolation: {
      escapeValue: false,
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  })
  .then(() => syncAppLanguage(i18n.language))
  .catch(() => {
    /* ignore */
  });

i18n.on('languageChanged', syncAppLanguage);

export default i18n;
