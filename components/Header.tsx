import { DICTIONARIES, LANG_LABELS, LANGS, type Lang } from '@/lib/i18n/dictionaries';
import { setLang } from '@/lib/i18n/actions';

export function Header({ lang }: { lang: Lang }) {
  const dict = DICTIONARIES[lang];
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{dict.appName}</h1>
          <p className="text-sm text-zinc-500">{dict.tagline}</p>
        </div>
        <nav aria-label={dict.language} className="flex gap-1">
          {LANGS.map((l) => (
            <form key={l} action={setLang.bind(null, l)}>
              <button
                type="submit"
                aria-pressed={l === lang}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  l === lang ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                {LANG_LABELS[l]}
              </button>
            </form>
          ))}
        </nav>
      </div>
    </header>
  );
}
