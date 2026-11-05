# Resguardo

PWA privado e offline-first para registro pessoal de jornada, ocorrências e anexos, com exportação, histórico de revisões e sincronização opcional no Supabase.

**Produção:** https://resguardo-pessoal.vercel.app

**Status:** release candidate em auditoria. Não anunciar como estável antes da validação ponta a ponta de autenticação, notificações e recuperação entre dispositivos.

## Desenvolvimento
Node.js 22+. Para testes e build, `npm install` e `npm run check`. Segredos administrativos não devem entrar neste repositório nem nas respostas públicas da API.

## Segurança
A aplicação utiliza Supabase Auth, políticas RLS com proprietário, Storage privado e IndexedDB local. Configurações de backend devem ficar em variáveis de ambiente na Vercel.
