# Resguardo · Gates de lançamento e handoff

Data da revisão: 5 de novembro de 2026. Aplicativo publicado: https://resguardo-pessoal.vercel.app.

## Verificações executadas

| Gate | Resultado | Evidência |
|---|---|---|
| Unitários de domínio, identidade e API | PASS · 40 | GitHub Actions |
| Chromium, interface móvel, desktop e IndexedDB offline | PASS · 15 | `npm run qa:e2e` |
| Sincronização simulada em dois aparelhos, conflito, evidências | PASS · 10 | `npm run qa:sync` |
| GitHub Actions Ubuntu 24.04 | PASS | [Workflow run 42017804534](https://github.com/vhonorato02/resguardo/actions/runs/42017804534) |
| PostgreSQL RLS, versão e auditoria | PASS em transação revertida | version=2, audit_entries=2, foreign_writes=0 |
| Vercel compilação e domínio de produção | PASS | Alias `resguardo-pessoal.vercel.app` |
| Supabase Storage com duas contas reais | Não testado | Teste simulado cobre apenas o código cliente |
| Confirmação e recuperação por e-mail de usuário real | Não testado | Requer acesso legítimo a caixa de entrada |
| Web Push com navegador/Android fechado | Não configurado / não testado | `/api/push-config` retorna `enabled:false` |
| GitHub → Vercel em push automático | Não configurado | Projeto Vercel não tem Git repository link |
| Repositório privado no GitHub | Não | Atualmente público, embora sem credenciais |
| Supabase Auth leaked-password protection | Aviso pendente | Auditor de segurança do Supabase |

## Infraestrutura

- Vercel team: `team_43xSvVJZ9lHuy6K7NNxlMhXG`, projeto: `prj_G039pJCHhLhY0W5E6GSHEvKDpQfx`.
- Supabase projeto: `epxvhikxfotnwbpmzzix`. Seis migrações estão versionadas exatamente conforme o histórico aplicado.
- Repositório: https://github.com/vhonorato02/resguardo, branch principal `main`.
- A conexão de CI GitHub está funcional, mas **não há webhooks automáticos do GitHub para o projeto Vercel atual**. Releases podem ser publicadas explicitamente pela API Vercel a partir de um commit aprovado.
- O cron do Vercel está protegido por `CRON_SECRET` e tem funções de menor privilégio no Supabase; falta provisionar a credencial restrita `RESGUARDO_CRON_RPC_TOKEN` em ambos os lados. Não substituir por token público ou incorporar segredo no código.

## Requisitos para `stable`

1. Configurar ligação GitHub → projeto Vercel existente: https://vercel.com/jose-victors-projects-5cc9abbe/resguardo-pessoal/settings/git. Selecionar `vhonorato02/resguardo` e branch `main`. Não criar outro projeto nem mover o domínio.
2. Configurar a credencial restrita para o cron na Vercel e apenas seu hash no esquema privado Supabase. Não copiar segredos para arquivos do repositório. Testar `/api/push-config` e envio real a uma assinatura própria com app fechado. A migração está em `supabase/migrations/`.
3. Validar login, recuperação de senha e sincronização real em dois navegadores com identidades distintas. Não usar senhas reais dentro de scripts ou logs de QA.
4. Resolver alertas de autenticação e privacidade pendentes; conferir planos, custos e distribuição das notificações.
5. Somente após todos os gates, criar tag `v1.0.0` e registrar o deployment e commit exatos.

## Referências

- [GitHub Actions do Resguardo](https://github.com/vhonorato02/resguardo/actions)
- [Vercel: conectar repositório existente](https://vercel.com/docs/git/vercel-for-github)
- [Supabase: URLs de redirecionamento](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: senhas comprometidas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
