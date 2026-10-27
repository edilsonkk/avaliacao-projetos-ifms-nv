# 0010. Front-end no Firebase Hosting; backend continua no Supabase

- **Status**: Aceito
- **Data**: 2026-10-27

## Contexto

O deploy usava GitHub Pages. O repositório é privado, e o Pages publicaria o app em um subcaminho
(`/sistemadeavaliacao/`), o que quebra o carregamento dos arquivos e devolve 404 ao recarregar rotas como `/admin`.
O mantenedor tem conta Firebase com cobrança por uso. Também foi avaliado migrar o backend para o Firebase.

## Decisão

- Hospedar o front-end no **Firebase Hosting** (`sistema-de-avaliacao-ifms-nv`), com rewrite de todas as rotas
  para `index.html`.
- **Manter o backend no Supabase.** Migrar para o Firestore exigiria reescrever o modelo relacional, o sorteio
  transacional, as funções SQL, as views e a RLS.

## Consequências

- Rotas da SPA e raiz do domínio funcionam sem ajuste no Vite.
- O deploy depende do secret `FIREBASE_SERVICE_ACCOUNT`.
- Com o volume esperado (cerca de 120 usuários por evento, ~500 KB por acesso), o custo fica dentro da cota
  gratuita do Hosting.
- Para facilitar qualquer troca futura de backend, as chamadas ao Supabase devem ser isoladas em hooks/serviços por
  feature.
