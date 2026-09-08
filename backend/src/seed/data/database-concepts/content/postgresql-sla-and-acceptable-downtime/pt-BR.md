---
version: 1.0
updatedAt: 2026-07-30
title: "Design de SLA no PostgreSQL: Definindo Downtime Aceitável"
summary: Como traduzir "quem usa o banco de dados e o que vai tolerar" em uma meta concreta de uptime expressa em noves, e como a checklist ad-hoc de SLA do livro mapeia para o vocabulário formal de hoje de SLI/SLO/SLA/error-budget e os benchmarks publicados de SLA de Postgres gerenciado (AWS RDS, Google Cloud SQL).
---
## Objective

Toda decisão de arquitetura coberta até agora (contagem de nós, quorum, indireção, fencing) responde "como sobrevivemos a uma falha". Nenhuma delas diz quanto downtime é de fato aceitável em primeiro lugar. Esse número não vem da equipe de banco de dados; vem de perguntar quem usa o sistema, o que vão tolerar, e transformar a resposta em uma meta concreta de uptime, expressa como uma porcentagem de "noves", contra a qual toda decisão de arquitetura posterior é medida.

## Use Cases

- Decidir se uma janela de manutenção precisa acontecer às 2 da manhã ou pode acontecer durante o horário comercial, com base em qual categoria de usuário está ativa naquele horário.
- Justificar um investimento em HA (um nó witness, um segundo data center, uma stack de failover automatizado) apontando para um orçamento de downtime específico que ele precisa atingir, em vez de "mais disponibilidade é sempre melhor".
- Alinhar expectativas com stakeholders *antes* de uma indisponibilidade acontecer, para que uma janela de manutenção de 20 minutos não seja tratada como uma crise por usuários que nunca foram avisados de que deveriam esperar por ela.

## Deep Dive

### Usuários são categorias, não contas

A checklist do livro começa identificando categorias de usuários, não contas individuais, e perguntando, para cada categoria: quando eles acessam o banco de dados, que timeout de consulta vão tolerar, eles perdem dinheiro durante uma indisponibilidade, é provável que voltem depois, deveriam ser incluídos em notificações de manutenção ou emergência. Um departamento de QA e 10.000 compradores de fim de ano são categorias diferentes com tolerância completamente diferente para exatamente a mesma indisponibilidade.

### O que um "nove" de fato custa em downtime

"Porcentagem de uptime" só se torna acionável quando traduzida em um orçamento de tempo concreto por ano:

| Uptime | Downtime / ano |
|---|---|
| 99% (dois noves) | ~3,65 dias |
| 99,9% (três noves) | ~8,76 horas |
| 99,99% (quatro noves) | ~52,6 minutos |
| 99,999% (cinco noves) | ~5,3 minutos |

Cada nove adicional é aproximadamente uma redução de 10x no downtime tolerado, o que também é, aproximadamente, um salto de 10x no esforço de engenharia necessário para garantir isso. Se a manutenção planejada conta contra esse orçamento ou é descontada separadamente é uma decisão de escopo que o SLA precisa declarar explicitamente; os dois enquadramentos produzem metas efetivas bem diferentes a partir da mesma porcentagem de destaque.

### Janelas de manutenção seguem a atividade do usuário, não o calendário

A regra operacional do livro: não tire um nó crítico do ar enquanto mais de 5% dos usuários ativos estão na plataforma, e agende manutenção depois do fechamento do horário comercial oficial. Nós de disaster recovery, standbys e cópias de QA/dev têm mais margem; eles não são o que os usuários dependem diretamente, então mexer neles carrega menos risco, mesmo que ainda valha a pena mantê-los disponíveis para seus próprios consumidores (desenvolvedores, equipe de QA, ou um evento de failover de verdade).

### O SLA como contrato, não só como meta

Transformar tudo isso em um SLA assinado com clientes faz duas coisas ao mesmo tempo: define expectativas explícitas e acordadas (para que uma janela de manutenção não seja lida como quebra de confiança), e age como uma fronteira legal que limita responsabilidade caso uma indisponibilidade de fato aconteça. A checklist (porcentagem de uptime, regras de notificação, cadência de manutenção, o que conta como emergência) é o que de fato vai para esse contrato.

### Livro vs. hoje: a mesma ideia, formalizada como SLO e error budget

O livro usa apenas "SLA" e nunca o distingue da própria meta. A disciplina de SRE do Google, que se tornou o vocabulário padrão da indústria desde então, divide isso em três camadas: um **SLI** (Service Level Indicator, a métrica de fato medida, por exemplo, taxa de consultas bem-sucedidas), um **SLO** (Service Level Objective, a meta interna, por exemplo, 99,95%), e um **SLA** (a promessa externa, muitas vezes contratual, geralmente definida com mais folga do que o SLO para deixar margem). O **error budget** é simplesmente `1 − SLO`: uma quantidade concreta e gastável de indisponibilidade permitida, da qual tanto manutenção planejada quanto indisponibilidades não planejadas saem do mesmo poço; exatamente a pergunta do livro sobre "a manutenção planejada conta contra o número", só que com um nome e um modelo de contabilidade formal.

Equipes também não precisam mais escolher um número de uptime do nada: PostgreSQL gerenciado hoje vem com um SLA publicado para servir de referência: o AWS RDS for PostgreSQL (Multi-AZ) publica **99,95%**, e o Google Cloud SQL for PostgreSQL publica **99,95%** em sua edição Enterprise (regional/HA) ou **99,99%** na Enterprise Plus. Nenhum dos dois números é um teto que um cluster autogerenciado precisa aceitar, mas ambos são um ponto de partida concreto e validado externamente para "qual porcentagem de uptime é esperada?", que o livro só conseguia responder perguntando por aí.

A heurística de "não tire um nó do ar enquanto mais de 5% dos usuários ativos estão nele" também foi parcialmente automatizada: o AWS RDS Multi-AZ ainda usa uma janela de manutenção semanal agendada (um descendente direto de "depois do horário comercial"), mas patches agora se aplicam primeiro ao standby, e então um failover automático, tipicamente bem abaixo de um minuto, o promove, em vez de um humano checando contagens de usuários ao vivo antes de mexer no primário.

## Trade-offs

- **Cada nove adicional custa aproximadamente uma ordem de magnitude a mais de esforço, por um orçamento absoluto de tempo proporcionalmente menor**: ir de três noves (8,76 horas/ano) para quatro noves (52,6 minutos/ano) exige aproximadamente o mesmo investimento relativo de engenharia que ir de quatro noves para cinco (5,3 minutos/ano), mesmo que o segundo salto recompre bem menos minutos reais.
- **Se a manutenção conta contra o SLA muda o que "atingir a meta" sequer significa**: um SLA que exclui manutenção planejada pode parecer idêntico no papel a um que a inclui, enquanto representa uma confiabilidade real bem diferente para o usuário final; isso precisa ser declarado explicitamente, não deixado implícito na porcentagem de destaque.
- **Um SLA assinado reduz exposição legal ao custo de flexibilidade operacional**: uma vez que a cadência de manutenção e as regras de notificação são contratuais, renegociá-las depois (um novo pipeline de deploy que quer uma janela diferente, digamos) exige reabrir o acordo, não só uma mudança de processo interno.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 3, "Minimizing Downtime", recipe "Determining acceptable losses", p. 88-90] - doc
- [Google SRE Book: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) - doc
- [Google SRE Workbook: Implementing SLOs (error budgets)](https://sre.google/workbook/implementing-slos/) - doc
- [AWS: Amazon RDS Service Level Agreement](https://aws.amazon.com/rds/sla/) - doc
- [Google Cloud: Cloud SQL Service Level Agreement](https://cloud.google.com/sql/sla) - doc
- [AWS Documentation: Maintaining a DB instance (Multi-AZ standby-first patching + automatic failover)](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html) - doc
