---
version: 1.0
updatedAt: 2026-11-21
---
# Migrando para a AWS: estratégias, Cloud Adoption Framework e serviços de migração

> Domínio do exame: **Conceitos de nuvem (24%)**, objetivo 1.3 *Entender os benefícios e as estratégias de migração para a Nuvem AWS*.

---

## Por que migrar

O guia do exame pede os benefícios da migração, o **AWS Cloud Adoption Framework (AWS CAF)** e as **estratégias de migração** adequadas (o exemplo dele é a replicação de banco de dados). A AWS cita estes benefícios de migrar:

- Custos menores: substituir o gasto de capital inicial por custos variáveis baixos e otimizar os custos de licenças e de computação.
- Nenhuma necessidade de adquirir servidores com semanas ou meses de antecedência.
- Menos dívida técnica por meio da modernização.
- Maior tempo de atividade e maior eficiência.

---

## Estratégias de migração: os Rs

O AWS Prescriptive Guidance lista **sete** estratégias. Escolha uma por aplicação perguntando o que você está disposto a mudar.

| Estratégia | Apelido | O que você faz | Pista no cenário |
|------------|---------|----------------|------------------|
| **Rehost** | Lift and shift | Mover o servidor como está, sem mudanças na aplicação | "Mover 200 VMs para o EC2 sem alterações" |
| **Replatform** | Lift, tinker and shift | Mover com uma pequena otimização, sem mudança no núcleo | "SQL Server autogerenciado para o Amazon RDS for SQL Server" |
| **Repurchase** | Drop and shop | Substituir por um produto diferente, geralmente SaaS | "Substituir o CRM interno por um CRM SaaS" |
| **Refactor** (re-architect) | Redesenhar | Mudar a arquitetura para usar recursos nativos da nuvem. A mais complexa e a mais cara | "Dividir o monolito em serviços sem servidor (serverless)" |
| **Relocate** | Mover sem reescrever | Mover servidores ou objetos para a versão em nuvem da plataforma, ou para outra VPC, Região ou conta | "Mover uma instância do RDS para outra conta" |
| **Retain** | Manter | Deixar onde está, ainda não pronto para migrar | "Ainda não está pronto, rever no ano que vem" |
| **Retire** | Desativar | Desligar ou arquivar | "Aplicação que ninguém usa" |

- Candidatos a retire incluem **aplicações zumbi** (uso médio de CPU e de memória abaixo de 5 por cento) e aplicações ociosas (5 a 20 por cento em 90 dias), ou aplicações sem conexões de entrada por 90 dias.
- Em migrações grandes, as escolhas mais comuns são rehost, replatform, relocate e retire. Refactor não é recomendado durante uma migração grande por causa de seu custo e de sua complexidade.
- O guia do exame não cita os Rs. Espere um cenário e a pergunta "qual estratégia se encaixa?", não uma contagem.

> Material de estudo antigo diz que existem seis Rs (rehost, replatform, repurchase, refactor, retire, retain). O AWS Prescriptive Guidance atual lista **sete**, com a adição de relocate. Se uma questão de prática oferecer seis, as seis continuam sendo estratégias válidas.

---

## AWS Cloud Adoption Framework (AWS CAF)

O AWS CAF usa a experiência e as melhores práticas da AWS para ajudar você a fazer a transformação digital e alcançar resultados de negócios. Use-o para encontrar e priorizar oportunidades, avaliar e melhorar a prontidão para a nuvem e evoluir um roteiro de transformação.

| Componente | Itens |
|------------|-------|
| **Resultados de negócios** (os exemplos do guia) | **Reduzir o risco do negócio** (melhor confiabilidade, performance, segurança), **melhorar o desempenho ESG** (ambiental, social, governança), **aumentar a receita** (novos produtos, clientes, segmentos de mercado), **aumentar a eficiência operacional** (menor custo operacional, maior produtividade, melhor experiência de funcionários e clientes) |
| **Seis perspectivas** | **Negócios**, **Pessoas**, **Governança** (lado do negócio), **Plataforma**, **Segurança**, **Operações** (lado técnico) |
| **Quatro domínios de transformação** | Tecnologia, Processo, Organização, Produto |
| **Quatro fases iterativas** | Envision, Align, Launch, Scale |

| Perspectiva | Foco em uma linha |
|-------------|-------------------|
| Negócios | Os investimentos em nuvem aceleram a transformação digital e os resultados de negócios (CEO, CFO, CIO) |
| Pessoas | A ponte entre tecnologia e negócios: cultura, estrutura organizacional, liderança, força de trabalho |
| Governança | Orquestrar as iniciativas de nuvem, maximizar os benefícios e minimizar o risco da transformação |
| Plataforma | Uma plataforma de nuvem híbrida escalável, workloads modernizados, soluções nativas da nuvem |
| Segurança | Confidencialidade, integridade e disponibilidade de dados e workloads |
| Operações | Entregar serviços de nuvem no nível que o negócio precisa |

> Não declarado pela AWS nas páginas que lemos: o que cada fase faz em detalhe. Aprenda somente os quatro nomes das fases.

---

## Serviços de migração

```text
 Discover      Plan / business case     Convert schema     Move data / servers
 --------      --------------------     --------------     -------------------
 Application   Migration Evaluator      AWS SCT            AWS DMS (databases)
 Discovery     AWS Migration Hub        (DMS Schema        AWS Application
 Service                                 Conversion)        Migration Service
```

| Serviço | Use para | Não serve para |
|---------|----------|----------------|
| **AWS Application Migration Service** | Fazer rehost de servidores físicos, virtuais ou na nuvem no Amazon EC2 com replicação contínua em nível de bloco, conversão automatizada e cutover orquestrado, para que o tempo de inatividade seja pequeno | Mover o esquema de um banco de dados entre mecanismos |
| **AWS Database Migration Service (DMS)** | Migrar bancos de dados relacionais, data warehouses e armazenamentos NoSQL, como uma migração única ou como **replicação contínua** das alterações. Funciona para migrações entre o mesmo mecanismo e entre mecanismos diferentes | Converter o código do esquema |
| **AWS Schema Conversion Tool (SCT)** | **Converter um esquema** de um mecanismo de banco de dados para outro (por exemplo, do Oracle para o Aurora PostgreSQL) e converter o SQL no código da aplicação | Mover os dados em si |
| **Migration Evaluator** | Montar um **business case** orientado por dados: custo projetado na nuvem por cenário, dimensionamento correto (right-sizing) de servidores superprovisionados, análise de licenças (BYOL versus License Included) | Executar a migração |
| **AWS Application Discovery Service** | Coletar dados de uso e de configuração sobre servidores e bancos de dados no local (on-premises) | Estimar preços |
| **AWS Migration Hub** | Um único lugar para descobrir servidores, planejar migrações e acompanhar o status entre ferramentas | Mover dados |

Regra prática para questões do exame: **"converter o esquema entre mecanismos diferentes" significa SCT; "mover ou continuar replicando os dados com o mínimo de tempo de inatividade" significa DMS.** O DMS agora também oferece um recurso "DMS Schema Conversion", então uma questão que não tenha opção com o SCT pode usá-lo. Os dispositivos físicos para mover dados pertencem à família Snow, e o DataSync move dados pela rede (domínio 3).

> Nomes em transição. O guia do exame (versão 1.3) ainda imprime "AWS Application Migration Service", e a página do produto na AWS agora o mostra como "AWS Transform MGN" (anteriormente AWS Application Migration Service). O Application Discovery Service e o AWS Migration Hub estão "fechados para novos clientes" (o Migration Hub desde 07/11/2025) e apontam para o AWS Transform, mas o guia do exame ainda os lista. Aprenda a finalidade deles e use os nomes do guia nas respostas.

---

## Atenção

- **Rehost, replatform e refactor diferem pelo quanto você muda.** Nenhuma mudança significa rehost, uma pequena troca por um serviço gerenciado significa replatform, um redesenho para nativo da nuvem significa refactor.
- **Repurchase é um produto diferente, não o mesmo software movido.** Substituir um sistema interno por SaaS é repurchase.
- **Retire trata de aplicações de que ninguém precisa.** Retain trata de aplicações em que você não está pronto para mexer.
- **O SCT converte o esquema, o DMS move os dados.** Uma questão sobre replicação com o mínimo de tempo de inatividade é DMS, embora o SCT possa criar tarefas do DMS.
- **O Migration Evaluator monta o business case, o Application Migration Service executa a migração dos servidores.** Não troque planejar por executar.
- **Os resultados do CAF no guia são quatro: risco, ESG, receita, eficiência operacional.** Associe cada cenário ao resultado correspondente.
- **Seis perspectivas, quatro de todo o resto.** Não invente uma perspectiva de "Custo" ou de "Conformidade".

## Verificação rápida

1. Mover um servidor para o EC2 sem mudanças. **Rehost.**
2. Substituir um sistema de RH interno por um produto SaaS. **Repurchase.**
3. Converter um esquema Oracle para o Aurora PostgreSQL e depois replicar os dados. **SCT para o esquema, DMS para os dados.**
4. Qual ferramenta monta um business case de migração com right-sizing e análise de licenças? **Migration Evaluator.**
5. Cite as seis perspectivas do CAF. **Negócios, Pessoas, Governança, Plataforma, Segurança, Operações.**

## Documentação oficial

- [About the migration strategies](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html)
- [AWS Cloud Adoption Framework](https://aws.amazon.com/cloud-adoption-framework/)
- [AWS CAF perspectives](https://docs.aws.amazon.com/whitepapers/latest/overview-aws-cloud-adoption-framework/foundational-capabilities.html)
- [AWS Application Migration Service](https://aws.amazon.com/application-migration-service/)
- [What is AWS Database Migration Service](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [What is the AWS Schema Conversion Tool](https://docs.aws.amazon.com/SchemaConversionTool/latest/userguide/CHAP_Welcome.html)
- [Migration Evaluator](https://aws.amazon.com/migration-evaluator/)
- [What is AWS Migration Hub](https://docs.aws.amazon.com/migrationhub/latest/ug/whatishub.html)
