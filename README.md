# Resguardo

Aplicativo pessoal, privado no uso dos dados, para registrar jornada de trabalho, pausas, atividades extraordinárias e ocorrências com evidências. PWA offline-first em português, IndexedDB local e sincronização opcional via Supabase com RLS e Storage privado.

**Produção:** https://resguardo-pessoal.vercel.app

## Organização

- `public/`: interface, manifest e Service Worker.
- `src/`: domínio, armazenamento local, autenticação, exportações e sincronização.
- `api/`: configuração Web Push e cron protegido.
- `tests/`: 40 testes unitários e duas suítes reais de navegador.
- `supabase/migrations/`: seis migrações efetivamente aplicadas no banco.

## Executar

Com Node.js 22 ou 24 e npm:

```bash
npm ci --no-audit --no-fund
npm run check
npx playwright install chromium
npm run qa:e2e
npm run qa:sync
```

Os testes de navegador usam servidor temporário local, dados sintéticos e perfis isolados. `qa:e2e` verifica jornada, ocorrências, backup, download de evidência, offline e desktop. `qa:sync` usa um servidor remoto **simulado** para testar upload/pull, revisões concorrentes, isolamento entre contas, conflito preservado e arquivos originais. Nenhuma credencial do Supabase é necessária para esses testes.

O GitHub Actions executa as três suítes em Ubuntu 24.04 a cada push no `main`. Veja [QA e critérios de release](docs/RELEASE-GATES.md).

## Produção e segurança

Hospedagem: Vercel, projeto `resguardo-pessoal`. Banco: Supabase `epxvhikxfotnwbpmzzix`. O build só injeta a URL e a chave publicável do Supabase. Tokens do cron, chaves administrativas e VAPID privado **nunca** pertencem ao frontend ou ao GitHub.

O cron do servidor só é considerado operacional se a integração Vercel → Supabase for configurada com autorização de privilégio mínimo e o recebimento real da notificação for comprovado com o aplicativo fechado.

**Status: release candidate 1.0.0-rc.8.** Não há autorização para anunciar stable enquanto persistirem gates não comprovados.
