---
version: 1.0
updatedAt: 2026-11-21
---
# Faturamento, orçamentos e gerenciamento de custos: Budgets, Cost Explorer, CUR, tags, Pricing Calculator e Organizations

> Domínio do exame: **Faturamento, Preços e Suporte (12%)**, objetivo 4.2 *Entender os recursos de faturamento, orçamento e gerenciamento de custos*.

---

## O que o exame cobra

O guia lista **suporte e informações de faturamento**, **informações de preços dos serviços**, **AWS Organizations**, **tags de alocação de custos** e as habilidades para usar o **AWS Budgets**, o **AWS Cost Explorer**, o **AWS Pricing Calculator**, o **faturamento consolidado e a alocação de custos**, e os **tipos de tags de alocação de custos e sua relação com relatórios de faturamento**, como o **AWS Cost and Usage Report**. As questões são quase todas do tipo "qual ferramenta faz este trabalho", então a tabela de decisão abaixo é o núcleo da lição.

---

## Qual ferramenta de custos responde a qual pergunta

| Pergunta que você recebe | Ferramenta | Quando no ciclo de vida |
|--------------------------|------------|-------------------------|
| "Quanto este design vai custar por mês antes de construirmos?" | **AWS Pricing Calculator** | Antes da implantação |
| "Avise-me quando o gasto real ou previsto passar de um limite" | **AWS Budgets** | Durante a execução, antes da fatura |
| "Quais serviços causaram o aumento do último trimestre? Qual é a previsão do próximo mês?" | **AWS Cost Explorer** | Depois do fato, análise visual |
| "Quero cada item de linha, por hora, por recurso e tag, para minhas próprias consultas" | **AWS Cost and Usage Report (CUR)** | Depois do fato, dados brutos no S3 |
| "Quanto gastamos até agora neste mês?" | **Página inicial do Billing and Cost Management** | De relance |
| "Divida a fatura por projeto ou departamento" | **Tags de alocação de custos** (ativadas) | Alimentam o Cost Explorer e o CUR |
| "Quais instâncias estão superdimensionadas ou ociosas?" | **AWS Compute Optimizer** (também as verificações de custo do Trusted Advisor) | Durante a execução |

O AWS Cost Anomaly Detection (não citado no guia do exame) usa machine learning para alertar sobre gastos incomuns.

---

## Página inicial do Billing and Cost Management

A página inicial do console mostra widgets como **Cost summary** (custo do mês até agora, o mesmo período do mês passado e o total previsto para este mês), Cost monitor, Cost breakdown (últimos seis meses por serviço, Região, conta-membro ou tag), Recommended actions e Savings opportunities. É a resposta mais rápida para "quanto gastamos até agora neste mês". Seus dados vêm do Cost Explorer.

---

## AWS Budgets

- Seis tipos de orçamento: **custo**, **uso**, **utilização de RIs**, **cobertura de RIs**, **utilização de Savings Plans** e **cobertura de Savings Plans**.
- Alertas sobre valores **reais** ou **previstos**, enviados por **e-mail**, por um **tópico do Amazon SNS**, ou ambos. Os orçamentos de utilização e de cobertura alertam quando você fica **abaixo** de uma meta.
- As **ações de orçamento** podem responder automaticamente, por exemplo aplicando uma política do IAM ou uma SCP que nega o lançamento de mais recursos.
- Os dados do orçamento são atualizados até três vezes por dia, então um alerta pode chegar depois que o limite já foi ultrapassado.
- Os orçamentos de monitoramento são gratuitos; os orçamentos com ações, além dos dois primeiros por mês, têm um pequeno custo diário (em 21/11/2026).

```json
{
  "BudgetName": "team-data-monthly",
  "BudgetType": "COST",
  "TimeUnit": "MONTHLY",
  "BudgetLimit": { "Amount": "4000", "Unit": "USD" }
}
```

---

## AWS Cost Explorer

- Visualiza e filtra custos e uso por serviço, conta, Região, tag e mais.
- Mostra até os **últimos 13 meses**, o mês atual e uma **previsão dos próximos 18 meses** (em 21/11/2026; uma página de configuração ainda diz 12 meses).
- Os dados são atualizados pelo menos uma vez a cada 24 horas.
- Dá **recomendações de reservas e de Savings Plans** com base no seu uso sob demanda recente (7, 30 ou 60 dias).
- Você o habilita abrindo-o no console; depois de habilitado, não pode ser desabilitado. O uso pelo console é gratuito.

---

## AWS Cost and Usage Report (CUR)

- Os dados de custo e uso **mais abrangentes** que a AWS fornece.
- Entregue como arquivos em um **bucket do Amazon S3 que você possui**, com granularidade por hora, por dia ou por mês, por produto, recurso e **suas tags**.
- Atualizado pelo menos uma vez por dia. Consulte-o com o **Amazon Athena**, carregue-o no **Amazon Redshift** ou visualize-o com o **Amazon Quick**.

> Material de estudo antigo diz para visualizar os dados do CUR com o Amazon QuickSight; a documentação oficial atual chama o serviço de **Amazon Quick**.

---

## Tags de alocação de custos

| Tipo | Prefixo | Criada por |
|------|---------|------------|
| **Geradas pela AWS** | `aws:` (por exemplo `aws:createdBy`) | AWS |
| **Definidas pelo usuário** | `user:` | Você |

- Os dois tipos precisam ser **ativados** no console de Billing antes de aparecerem no Cost Explorer e nos relatórios de faturamento. Uma tag recém-ativada pode levar até 24 horas para aparecer.
- Somente a **conta de gerenciamento** de uma organização (ou uma conta independente) pode ativá-las.
- As tags são rótulos. Elas não param recursos e não mudam preços; permitem que o Cost Explorer e o CUR detalhem os custos por projeto, equipe ou ambiente.
- As **Cost Categories** agrupam custos com regras (contas, tags, serviços) quando as tags sozinhas não bastam.

---

## AWS Pricing Calculator

- Uma ferramenta de planejamento gratuita, baseada na web (calculator.aws), para **estimar** o custo de uma arquitetura planejada; não é preciso experiência com a AWS.
- As estimativas podem ser agrupadas, compartilhadas por link e exportadas em **CSV ou PDF**.
- O resultado é uma **estimativa, não uma cotação**: exclui impostos e, se diferir da página de preços de um serviço, a página de preços prevalece.

---

## AWS Organizations e faturamento consolidado

```text
            Management account  (pays the whole bill, the payer)
             /         |          \
   OU: Prod       OU: Dev       OU: Sandbox
   member accts   member accts  member accts
```

- Toda organização tem uma **conta de gerenciamento**, que exerce o papel de **conta pagadora** e paga as cobranças de todas as contas-membro. Ela não pode ser trocada por outra conta.
- Benefícios do **faturamento consolidado**: uma única fatura, acompanhamento por conta, **uso combinado** para as faixas de preço por volume e **descontos compartilhados de RIs e Savings Plans**, sem custo adicional.
- Conjuntos de recursos: **Todos os recursos** (o padrão, com políticas como as SCPs) ou apenas **Faturamento consolidado**.
- As tarifas do AWS Support são calculadas **por conta-membro**. Comprar um plano pago em uma conta não cobre a organização inteira.
- O faturamento consolidado mostra o custo **por conta**. Para dividir o custo **dentro** de uma conta por projeto, use tags de alocação de custos.

---

## Informações de preços e o AWS Marketplace na fatura

- Cada serviço tem uma **página de preços** pública; o Pricing Calculator usa a mesma lista de preços.
- As compras no **AWS Marketplace** (software de terceiros, SaaS, AMIs, produtos de dados) são cobradas na sua **fatura da AWS**, então aparecem nas suas ferramentas de custos. Os vendedores podem oferecer testes gratuitos, preços por hora, mensais, anuais ou plurianuais, BYOL e ofertas privadas com condições personalizadas.
- O **AWS License Manager** acompanha licenças de software (incluindo BYOL e licenças compradas no Marketplace) entre contas e pode impor limites.

---

## Atenção

- **O Budgets alerta e pode agir; ele não desliga recursos, a menos que você configure uma ação de orçamento.** O Cost Explorer e o CUR nunca agem.
- **Antes vs depois:** o Pricing Calculator estima antes de você construir; o Cost Explorer e o CUR olham para trás; o Budgets observa o futuro em relação a um limite.
- **O Pricing Calculator é uma estimativa,** não um preço vinculante, e exclui impostos.
- **Conta de gerenciamento, não "conta master".** A conta de gerenciamento é a pagadora. "Faturamento consolidado" é um conjunto de recursos do Organizations, não um nome antigo dele.
- **As tags precisam ser ativadas** antes de aparecerem nos relatórios de faturamento, e somente a conta de gerenciamento pode fazer isso.
- **O faturamento consolidado não faz upgrade do suporte** das contas-membro, não aumenta as cotas de serviço e não divide o custo por projeto.
- **As metas de utilização ou de cobertura de RIs e Savings Plans** são tipos do AWS Budgets. Elas alertam quando você fica abaixo da meta, não acima.

---

## Verificação rápida

1. O financeiro quer um e-mail quando o custo mensal **previsto** de uma equipe for ultrapassar USD 8.000. **AWS Budgets, orçamento de custo com alerta de valor previsto.**
2. Os analistas querem dados de custo por item de linha, por hora, no S3 para consultar com o Athena. **AWS Cost and Usage Report.**
3. Os custos de EC2 e S3 em uma conta precisam ser divididos por departamento. **Ativar tags de alocação de custos definidas pelo usuário e agrupar por tag.**
4. Três contas pagam separadamente e uma tem instâncias reservadas não usadas. O que reduz o custo sem nova arquitetura? **Reuni-las em uma organização do AWS Organizations com faturamento consolidado.**
5. Até quanto tempo atrás o Cost Explorer pode mostrar custos? **Até 13 meses, mais o mês atual.**

---

## Documentação oficial

- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [AWS Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [AWS Cost and Usage Report](https://docs.aws.amazon.com/cur/latest/userguide/what-is-cur.html)
- [Cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
- [AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)
- [Consolidated billing for AWS Organizations](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/consolidated-billing.html)
- [AWS Organizations terminology and concepts](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html)
- [Billing and Cost Management home page](https://docs.aws.amazon.com/cost-management/latest/userguide/view-billing-dashboard.html)
