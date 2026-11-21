---
version: 1.0
updatedAt: 2026-11-21
---
# Economia da nuvem: custo fixo vs variável, licenciamento e rightsizing

> Domínio do exame: **Conceitos de nuvem (24%)**, objetivo 1.4 *Entender os conceitos de economia da nuvem*.

---

## O que o exame quer

O guia lista: **custos fixos versus variáveis**, **custos associados a ambientes no local (on-premises)**, **estratégias de licenciamento** (Bring Your Own License comparado a licenças incluídas), **rightsizing**, **benefícios da automação** e **economias de escala**. A mecânica de faturamento (Budgets, Cost Explorer, faturamento consolidado, planos de suporte) pertence ao domínio 4. Esta lição é o modelo de "por que a nuvem é mais barata e como mantê-la barata".

---

## Despesa fixa versus despesa variável

| | No local (on-premises) | AWS |
|--|------------------------|-----|
| Quando você paga | Antes de usar: você compra servidores e constrói data centers para o pico | Enquanto usa: você paga quando consome, pelo quanto consome |
| Formato do custo | Grande investimento inicial, depois fixo | Variável, acompanha o uso |
| Risco | Comprar demais (servidores ociosos) ou de menos (indisponibilidade no pico) | A capacidade acompanha a demanda |

- A direção é sempre **capital inicial (fixo) para baseado em uso (variável)**. "Trocar operacional por capital" é o contrário.
- Você continua pagando pelo que deixa em execução. O custo variável só ajuda se você desligar ou reduzir o que não usa (por exemplo, um ambiente de desenvolvimento e teste usado cerca de 40 das 168 horas semanais pode reduzir seu custo em aproximadamente 75 por cento se for parado quando ocioso).

### Custos associados a ambientes no local (on-premises)

A AWS enfatiza os itens pelos quais você deixa de pagar: comprar e operar o hardware do data center, **montar, empilhar e alimentar servidores**, e a capacidade que você estimou alta demais. Pense no **custo total de propriedade (TCO)** completo de um ambiente no local como hardware, instalações, energia, rede, segurança e as pessoas que os operam, comparado ao custo da nuvem baseado em uso.

> Não declarado pela AWS nas páginas que lemos: uma regra formal sobre o que pertence a um TCO (por exemplo, "a segurança das instalações conta, um salário que continua não conta"). É raciocínio contábil de livros mais antigos, útil para pensar, não uma frase da AWS.

A AWS também apresenta o valor da nuvem como mais do que o TCO. Seu **Cloud Value Framework** tem cinco áreas: economia de custos, produtividade da equipe, resiliência operacional, agilidade do negócio e sustentabilidade.

---

## Economias de escala

A AWS agrega o uso de um número muito grande de clientes, alcança economias de escala maiores e repassa preços menores de pagamento conforme o uso. Esse é o motivo pelo qual os preços podem cair. O pagamento conforme o uso em si, a infraestrutura global e o preço de instâncias reservadas são coisas diferentes.

---

## Estimar e montar o business case

| Necessidade | Use |
|-------------|-----|
| Estimar o custo de uma arquitetura que **você pretende construir** | **AWS Pricing Calculator**, uma ferramenta web gratuita: modele soluções antes de construir, explore pontos de preço, revise cálculos, exporte para CSV ou PDF |
| Montar um business case para **migrar servidores existentes**: custo projetado na nuvem, right-sizing, licenças | **Migration Evaluator** (lição 1-3) |

Detalhes do Pricing Calculator: suas estimativas incluem custos iniciais, mensais e anuais, ele não considera os preços do Nível gratuito (Free Tier) e usa 730 horas por mês.

> Material de estudo antigo diz para usar a "Simple Monthly Calculator" ou uma "TCO Calculator". A Simple Monthly Calculator foi desativada e substituída pelo AWS Pricing Calculator. As páginas da AWS que lemos não mencionam uma "TCO Calculator", então use o Pricing Calculator para estimativas e o Migration Evaluator para o business case de migração.

---

## Rightsizing

**Rightsizing** é ajustar o tipo e o tamanho dos recursos ao uso real, para deixar de pagar por capacidade ociosa. Uma frota com média de 8 por cento de CPU em instâncias grandes é candidata a rightsizing: mude para tipos menores.

| Ferramenta | O que ela informa |
|------------|-------------------|
| **AWS Compute Optimizer** | Sinaliza recursos superprovisionados e subprovisionados e sugere configurações melhores: instâncias EC2, grupos do Auto Scaling, RDS, volumes do EBS não anexados (não é uma lista completa) |
| **Recomendações de rightsizing do Cost Explorer** | Economia ao reduzir ou encerrar instâncias EC2 subutilizadas; a AWS agora aponta para o Cost Optimization Hub para oportunidades |

Rightsizing é uma ação de custo. Agilidade (velocidade de provisionamento) e elasticidade (acompanhar a demanda) são vantagens diferentes.

---

## Licenciamento: BYOL versus License Included

| Modelo | Significado | Onde se encaixa |
|--------|-------------|-----------------|
| **Bring Your Own License (BYOL)** | Você reutiliza uma licença que já possui, dentro dos termos dela | Licenças por soquete, por núcleo ou por VM: use **Dedicated Hosts**, que oferecem suporte abrangente a BYOL |
| **License Included** | A licença (por exemplo, Windows Server ou SQL Server) faz parte do preço, sem compra separada | Você não tem licença e quer o custo incorporado à tarifa por hora. Disponível no EC2 e no RDS |

- O **Dedicated Host** é a resposta para licenças de software por soquete ou por núcleo. As **Dedicated Instances** rodam em hardware dedicado, mas oferecem apenas suporte parcial a BYOL, então não são a resposta usual.
- O **AWS License Manager** acompanha o uso de licenças em relação às suas regras e pode ajudar a converter entre BYOL e License Included.
- Atualmente, o RDS for Oracle oferece License Included somente para a Standard Edition 2, enquanto a Enterprise Edition e a Standard Edition 2 podem usar BYOL.
- O Migration Evaluator compara BYOL com License Included como parte de um business case.

---

## Automação e serviços gerenciados

- A **automação** (infraestrutura como código com o AWS CloudFormation ou o AWS CDK) traz repetibilidade, consistência e controle de versão. Menos etapas manuais significa menos erros e menor custo de mão de obra.
- Os **serviços gerenciados** reduzem o custo operacional ao transferir para a AWS o trabalho indiferenciado. O Amazon RDS automatiza provisionamento, configuração, backups e aplicação de patches, o que, segundo a página, seria demorado, complexo e caro de executar por conta própria. O preço por hora de um serviço gerenciado pode ser maior, enquanto o custo total, incluindo a mão de obra, é menor. A AWS não publica essa comparação por hora, então mantenha-a como raciocínio de TCO.

---

## Atenção

- **Direção da mudança:** de custo fixo ou de capital para custo variável ou operacional, nunca o contrário.
- **Economias de escala explicam a queda de preços**, não o pagamento conforme o uso e nem os descontos de instâncias reservadas.
- **Rightsizing é custo, agilidade é velocidade.** Redimensionar uma frota superdimensionada não é agilidade.
- **Licença por soquete significa Dedicated Host**, não Dedicated Instance e não a tenancy padrão.
- **O Pricing Calculator estima um plano, o Migration Evaluator justifica uma migração.** Nenhum dos dois mostra sua fatura real (isso é o Cost Explorer, domínio 4).
- **O Pricing Calculator ignora o Nível gratuito (Free Tier).** Seus números podem ser maiores do que o que uma conta nova paga.
- **Nomes antigos de calculadoras são armadilhas.** A Simple Monthly Calculator foi desativada.

## Verificação rápida

1. Uma empresa troca a compra de um data center por pagamento por uso. **A despesa fixa (de capital) vira despesa variável.**
2. Onde você estima o custo de uma arquitetura antes de construí-la? **AWS Pricing Calculator.**
3. As instâncias têm média de 8 por cento de CPU. **Fazer rightsizing para tipos menores, orientado pelo Compute Optimizer.**
4. Um fornecedor licencia o software por soquete físico e você possui as licenças. **BYOL em um Dedicated Host.**
5. Quais benefícios a infraestrutura como código acrescenta? **Repetibilidade, consistência, controle de versão.**

## Documentação oficial

- [Six advantages of cloud computing](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/six-advantages-of-cloud-computing.html)
- [AWS Cloud Economics](https://aws.amazon.com/economics/)
- [What is the AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)
- [Rightsizing recommendations in Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-rightsizing.html)
- [AWS Compute Optimizer](https://aws.amazon.com/compute-optimizer/)
- [Amazon EC2 Dedicated Hosts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-overview.html)
- [Oracle licensing on Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Oracle.Concepts.Licensing.html)
- [What is infrastructure as code](https://aws.amazon.com/what-is/iac/)
