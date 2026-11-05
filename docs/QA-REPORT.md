# Resguardo RC8 · QA

- Compilação executada a partir do repositório GitHub em sandbox: 40/40 testes aprovados, build estático concluído.
- Suite: 25 testes de jornada e dados temporais, 9 de isolamento de conta/backup e 6 de API de notificação.
- Testes anteriores em Chromium RC7: jornada, ocorrências, anexos com bytes idênticos, exportação/restauração, offline IndexedDB, responsividade, isolamento local A/B e renovação única de token.
- PostgreSQL RLS exercitado em transações com ROLLBACK; sem registros persistidos.
- Supabase cron RPC migrado com escopo mínimo. Credencial do backend ainda não provisionada; Web Push não habilitado.
- Pendente para stable: confirmação de login por e-mail, sincronização entre aparelhos com duas contas, push entregue em Android fechado e CI remoto do GitHub.

Não chamar stable até conclusão das verificações.
