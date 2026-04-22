export const LANGS = [
  { id: "en", name: "English"  },
  { id: "fr", name: "French"   },
  { id: "ja", name: "Japanese" },
  { id: "zh", name: "Chinese"  },
  { id: "ru", name: "Russian"  },
  { id: "ar", name: "Arabic"   },
];

export const UI_STRINGS: Record<string, { welcome: string; error: string }> = {
  en: {
    welcome: "Hello! I'm your Astra Docs assistant. Ask me anything about the documentation.",
    error: "Sorry, I encountered an error. Please try again.",
  },
  fr: {
    welcome: "Bonjour\u00a0! Je suis votre assistant Astra Docs. Posez-moi vos questions sur la documentation.",
    error: "Désolé, une erreur s'est produite. Veuillez réessayer.",
  },
  ar: {
    welcome: "مرحباً! أنا مساعد Astra Docs. اسألني أي شيء عن الوثائق.",
    error: "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.",
  },
  ja: {
    welcome: "こんにちは！Astra Docsのアシスタントです。ドキュメントについて何でもお聞きください。",
    error: "エラーが発生しました。もう一度お試しください。",
  },
  zh: {
    welcome: "您好！我是 Astra Docs 助手。请随时向我询问有关文档的问题。",
    error: "抱歉，发生了错误。请再试一次。",
  },
  ru: {
    welcome: "Здравствуйте! Я ваш ассистент Astra Docs. Задайте мне любой вопрос по документации.",
    error: "Извините, произошла ошибка. Пожалуйста, попробуйте ещё раз.",
  },
};

export const ADMIN_EMAILS  = ["alexandre.grigoriev@gmail.com", "alexandre.grigoriev@horiba.com"];
export const TRUSTED_USERS: string[] = [];

// ── Context limit ─────────────────────────────────────────────────────────────
// Maximum estimated tokens allowed in a single chat context.
// Override by setting VITE_CONTEXT_LIMIT_TOKENS in your .env file.
export const CONTEXT_LIMIT_TOKENS = Number(import.meta.env.VITE_CONTEXT_LIMIT_TOKENS ?? 16_000);
// Warn at 87.5 % of the limit (14 000 by default).
export const CONTEXT_WARN_TOKENS  = Math.round(CONTEXT_LIMIT_TOKENS * 0.875);
