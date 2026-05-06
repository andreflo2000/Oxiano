'use client'
import { createContext, useContext, useState, useEffect } from 'react'

export type Lang = 'ro' | 'en' | 'de' | 'es' | 'pt'

const VALID_LANGS: Lang[] = ['ro', 'en', 'de', 'es', 'pt']

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'ro',
  setLang: () => {},
})

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('oxiano_lang') as Lang
      if (VALID_LANGS.includes(saved)) setLangState(saved)
      else {
        // Auto-detect din browser
        const bl = navigator.language?.toLowerCase() || ''
        if (bl.startsWith('ro')) setLangState('ro')
        else if (bl.startsWith('de')) setLangState('de')
        else if (bl.startsWith('es')) setLangState('es')
        else if (bl.startsWith('pt')) setLangState('pt')
        else setLangState('en')
      }
    } catch {}
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    try { localStorage.setItem('oxiano_lang', l) } catch {}
  }

  // Helper: pentru paginile cu ternary-uri inline (lang === 'en' ? ... : ...)
  // Noile limbi (de/es/pt) afiseaza engleza ca fallback


  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
}

export function useLang() {
  return useContext(LangContext)
}
