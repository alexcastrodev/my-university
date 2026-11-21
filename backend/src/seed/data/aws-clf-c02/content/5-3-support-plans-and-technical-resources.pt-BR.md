---
version: 1.0
updatedAt: 2026-11-21
---
# Planos do AWS Support e recursos técnicos: Trusted Advisor, Health Dashboard, parceiros e onde buscar ajuda

> Domínio do exame: **Faturamento, Preços e Suporte (12%)**, objetivo 4.3 *Identificar os recursos técnicos da AWS e as opções do AWS Support*.

---

## O que o exame cobra

O guia lista os **planos do AWS Support** (Basic Support, AWS Business Support+, AWS Enterprise Support, AWS Unified Operations), a **AWS Support Center**, o **AWS Trusted Advisor**, o **AWS Health Dashboard** e a **AWS Health API**, a **equipe AWS Trust and Safety**, a **AWS Partner Network**, o **AWS Marketplace**, o **AWS Professional Services**, os **arquitetos de soluções da AWS** e recursos de autoatendimento como documentação, whitepapers, blogs, **AWS Prescriptive Guidance**, **AWS Knowledge Center** e **AWS re:Post**. As questões de suporte comparam planos: qual é o menor plano que oferece um recurso.

---

## Os quatro planos de Support atuais (em 21/11/2026)

Cada plano pago se baseia no plano abaixo dele.

| Recurso | Basic | Business Support+ | Enterprise Support | Unified Operations |
|---------|-------|-------------------|--------------------|--------------------|
| Preço | Gratuito, incluído | Pago | Pago | Pago, nível mais alto |
| Ajuda com conta e faturamento, solicitações de cota de serviço | Sim, 24x7 | Sim | Sim | Sim, com um Senior Billing and Account Specialist |
| Casos de suporte técnico | Não | Sim, 24x7 por telefone, web e chat, casos ilimitados | Sim | Sim |
| Trusted Advisor | Verificações principais | Verificações completas | Verificações completas mais o **Trusted Advisor Priority** | Verificações completas mais o Trusted Advisor Priority |
| AWS Health API, AWS Support API | Não | Sim | Sim | Sim |
| Suporte a software de terceiros | Não | Sim | Sim | Sim |
| **Technical Account Manager (TAM) designado** | Não | Não | **Sim** | **Sim**, mais um Domain Specialist Engineer |
| Programas proativos | Não | Não | Revisões estratégicas de negócios, AWS Countdown | Monitoramento de workloads 24/7, Infrastructure Event Management, revisões de workloads críticos |

Lembre-se da escada: o Basic **não tem casos técnicos**, o Business Support+ é o **menor plano com suporte técnico e Trusted Advisor completo**, o Enterprise Support é o **menor plano com um TAM designado**, e o Unified Operations é o plano que a AWS recomenda para **workloads de missão crítica**.

### Metas de primeira resposta (em 21/11/2026)

| Severidade do caso | Business Support+ | Enterprise Support | Unified Operations |
|--------------------|-------------------|--------------------|--------------------|
| Orientação geral | 24 horas | 24 horas | 24 horas |
| Sistema com desempenho comprometido | 12 horas | 12 horas | 12 horas |
| Sistema de produção com desempenho comprometido | 4 horas | 4 horas | 4 horas |
| Sistema de produção fora do ar | 1 hora | 1 hora | 1 hora |
| Sistema crítico para o negócio fora do ar | menos de 30 minutos | menos de 15 minutos | 5 minutos |

A AWS faz "todo esforço razoável" para cumprir essas metas; elas não são um SLA garantido. O exame cobra a ordem (Unified Operations mais rápido, depois Enterprise Support, depois Business Support+), não os minutos.

### Como funciona a tarifa (em 21/11/2026)

Os planos pagos cobram o maior valor entre um mínimo mensal ou uma porcentagem das suas cobranças mensais da AWS, com taxas **escalonadas**: cada porcentagem se aplica somente à sua faixa de gasto. Mínimos atuais: Business Support+ USD 29, Enterprise Support USD 5.000, Unified Operations USD 50.000 por mês. As tarifas são calculadas por conta em uma organização.

> Material de estudo antigo diz que há cinco planos: Basic, Developer, Business, Enterprise On-Ramp e Enterprise. A documentação oficial atual diz que o Developer Support e o Business Support deixaram de aceitar novas assinaturas em 2 de dezembro de 2025, e que Developer, Business e Enterprise On-Ramp serão descontinuados em 1º de janeiro de 2027. Os planos atuais são Basic, Business Support+, Enterprise Support e Unified Operations. Onde uma questão antiga responde "Business", a resposta de hoje é Business Support+.

---

## AWS Trusted Advisor

O Trusted Advisor inspeciona sua conta e recomenda como economizar dinheiro, melhorar a performance e a disponibilidade e fechar lacunas de segurança. Hoje são seis categorias de verificação:

| Categoria | Exemplo do que ela sinaliza |
|-----------|-----------------------------|
| **Otimização de custos** | Recursos ociosos ou subutilizados pelos quais você ainda paga |
| **Performance** | Recursos que limitam a vazão |
| **Segurança** | Conta-raiz sem MFA, portas irrestritas em grupos de segurança, permissões públicas em S3 ou em snapshots |
| **Tolerância a falhas** | Falta de redundância ou de backups |
| **Limites de serviço** | Uso próximo de uma cota de serviço |
| **Excelência operacional** | Lacunas nas boas práticas operacionais |

- O **Basic** recebe as verificações principais: todas as verificações de **Limites de serviço** mais algumas verificações selecionadas de Segurança e de Tolerância a falhas (como MFA na conta-raiz, permissões de bucket do S3 e snapshots públicos de EBS ou RDS).
- O **Business Support+, o Enterprise Support e o Unified Operations** liberam o conjunto completo de verificações e a API do Trusted Advisor.
- O **Trusted Advisor Priority** exige o Enterprise Support ou o Unified Operations.

> Material de estudo antigo diz que o Trusted Advisor tem cinco categorias; a documentação oficial atual lista seis, com a adição de **Excelência operacional**.

---

## AWS Health Dashboard e AWS Health API

- O **AWS Health Dashboard** é gratuito para todos os clientes. Ele tem duas visões:
  - **Service health**: status público dos serviços da AWS em todas as Regiões, sem necessidade de login.
  - **Your account health**: eventos que afetam **os seus** recursos, como manutenção programada nas suas instâncias.
- Os eventos do Health chegam ao **Amazon EventBridge** sem custo para todos os clientes, para que você possa automatizar reações.
- A **AWS Health API** exige o Business Support+, o Enterprise Support ou o Unified Operations.

> Material de estudo antigo diz "Personal Health Dashboard" e "Service Health Dashboard"; o nome oficial atual é AWS Health Dashboard, com as visões Service health e Your account health.

---

## Quem ajuda: quem faz o quê

| Necessidade | Recurso |
|-------------|---------|
| Abrir um caso de suporte, solicitar um aumento de cota, fazer uma pergunta de faturamento | **AWS Support Center** |
| Um contato nomeado na AWS que conhece seu ambiente e coordena orientações proativas | **Technical Account Manager** (Enterprise Support, Unified Operations) |
| Especialistas da própria AWS para projetar, construir, migrar ou gerenciar um workload junto com sua equipe | **AWS Professional Services** |
| Consultores terceirizados, integradores de sistemas ou provedores de serviços gerenciados | **AWS Partner Network (APN)**, parceiros de Services |
| Software de terceiros (ISVs), comprado e cobrado pela AWS | **AWS Marketplace** |
| Orientação de arquitetura durante o design (citada no guia do exame como assistência técnica) | **Arquitetos de soluções da AWS** |
| Denunciar recursos da AWS usados para abuso ou outras violações da Política de Uso Aceitável | **Equipe AWS Trust and Safety**, pelo formulário de denúncia de abuso |

A **APN** é a comunidade global de empresas que constroem na AWS: os parceiros de **Software** (ISVs) criam produtos, os parceiros de **Services** entregam serviços de consultoria, profissionais e gerenciados. Os parceiros recebem da AWS treinamento e certificação, eventos e programas. O **AWS Marketplace** é um catálogo selecionado de software, dados e serviços de terceiros com preços flexíveis, ofertas privadas e cobranças na fatura da AWS; com o AWS License Manager, ele oferece suporte à governança dos direitos de uso.

---

## Recursos técnicos de autoatendimento

| Você quer | Vá para |
|-----------|---------|
| Guias oficiais de serviços e referências de API | **Documentação da AWS** (docs.aws.amazon.com) |
| Artigos aprofundados, escritos pelo fornecedor, sobre arquitetura e boas práticas | **Whitepapers da AWS** e os blogs da AWS |
| Guias comprovados e padrões passo a passo para migração e modernização | **AWS Prescriptive Guidance** |
| Respostas para as perguntas técnicas e de conta mais comuns | **AWS Knowledge Center** |
| Uma comunidade de perguntas e respostas sobre a AWS | **AWS re:Post** (os planos pagos recebem respostas priorizadas) |

---

## Atenção

- **O Basic não pode abrir casos técnicos**, mas pode abrir casos de conta, faturamento e cota de serviço.
- **O menor plano com um TAM designado é o Enterprise Support.** O Business Support+ não tem TAM.
- **O Trusted Advisor completo começa no Business Support+.** O Basic recebe apenas as verificações principais.
- **Resposta para casos críticos para o negócio:** o Unified Operations é o mais rápido, depois o Enterprise Support, depois o Business Support+. Para "workloads de missão crítica com monitoramento 24/7", a resposta é o Unified Operations.
- **Service health vs account health:** uma interrupção regional geral está no Service health; a manutenção nas suas próprias instâncias está no Your account health.
- **Professional Services vs APN:** funcionários da AWS vs empresas parceiras terceirizadas. O **Marketplace** vende software; não é onde você contrata equipe da AWS.
- **Um plano pago se aplica por conta.** Ele não cobre automaticamente todas as contas de uma organização.
- AWS Activate, AWS IQ e AWS Managed Services estão fora do escopo do exame.

---

## Verificação rápida

1. Qual é o menor plano que permite aos desenvolvedores abrir casos técnicos 24x7 e ver o conjunto completo de verificações do Trusted Advisor? **AWS Business Support+.**
2. Quais planos incluem um Technical Account Manager designado? **AWS Enterprise Support e AWS Unified Operations.**
3. Qual categoria do Trusted Advisor avisa que você está perto de uma cota? **Limites de serviço.**
4. Onde você vê que a AWS fará manutenção em uma de suas próprias instâncias na semana que vem? **AWS Health Dashboard, Your account health.**
5. Uma instância EC2 que não é sua está sendo usada para abusar dos seus servidores. A quem você denuncia? **À equipe AWS Trust and Safety, pelo formulário de denúncia de abuso.**

---

## Documentação oficial

- [AWS Support plans](https://docs.aws.amazon.com/awssupport/latest/user/aws-support-plans.html)
- [Support plans end of support](https://docs.aws.amazon.com/awssupport/latest/user/support-plans-eos.html)
- [Case management and response times](https://docs.aws.amazon.com/awssupport/latest/user/case-management.html)
- [AWS Trusted Advisor check reference](https://docs.aws.amazon.com/awssupport/latest/user/trusted-advisor-check-reference.html)
- [What is AWS Health?](https://docs.aws.amazon.com/health/latest/ug/what-is-aws-health.html)
- [AWS Partner Network](https://aws.amazon.com/partners/)
- [AWS Professional Services](https://aws.amazon.com/professional-services/)
- [What is AWS Marketplace?](https://docs.aws.amazon.com/marketplace/latest/buyerguide/what-is-marketplace.html)
