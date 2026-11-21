---
version: 1.1
updatedAt: 2026-11-21
---
# Modelos de preços da AWS: sob demanda, Savings Plans, instâncias reservadas, Spot e opções dedicadas

> Domínio do exame: **Faturamento, Preços e Suporte (12%)**, objetivo 4.1 *Comparar os modelos de preços da AWS*.

---

## O que o exame cobra

O guia lista as opções de compra de computação (**sob demanda, instâncias reservadas (Reserved Instances), instâncias Spot, Savings Plans, Dedicated Hosts, Dedicated Instances, Capacity Reservations**), quando usar cada uma, a **flexibilidade das instâncias reservadas**, **como as instâncias reservadas se comportam no AWS Organizations**, **os custos de transferência de dados de entrada e de saída** e **os preços das opções e dos níveis de armazenamento**. Quase toda questão é "qual opção se encaixa neste padrão de uso", então aprenda primeiro o padrão e depois o desconto.

---

## Escolha a opção pelo padrão de uso

| Padrão de uso | Melhor opção | Por quê |
|---------------|--------------|---------|
| Trabalho curto, com picos ou imprevisível, que não pode ser interrompido | **Sob demanda** | Sem compromisso, pagamento por segundo pelo que você iniciar |
| Uso estável por 1 ou 3 anos, com flexibilidade de família de instância, Região, ou também Fargate e Lambda | **Compute Savings Plans** | Compromisso com um valor em USD por hora, o desconto acompanha o uso |
| Uso estável em uma família de instância e uma Região | **EC2 Instance Savings Plans** ou **instâncias reservadas Standard** | Maior desconto por compromisso para EC2 |
| Uso estável, mas você espera mudar a família de instância ou o sistema operacional durante o prazo | **Instâncias reservadas Convertible** | Podem ser trocadas por outra configuração |
| Trabalho flexível, tolerante a falhas e reiniciável (lote, análise, renderização, CI) | **Instâncias Spot** | Capacidade ociosa, maior desconto, pode ser interrompida |
| Licenças vinculadas ao servidor (por soquete, por núcleo, por VM) ou regras que proíbem compartilhar um servidor físico que você não vê | **Dedicated Hosts** | Um servidor físico inteiro, com visibilidade de soquetes e núcleos |
| Hardware de locatário único sem controle de licença ou de posicionamento | **Dedicated Instances** | Hardware dedicado à sua conta, cobrado por instância |
| Capacidade garantida em uma AZ, sem compromisso de longo prazo | **Capacity Reservations sob demanda** | Reserva capacidade, não dá desconto por si só |

Regra prática: o compromisso compra desconto, a interrupção compra um desconto maior, e nenhum dos dois serve para trabalho curto que não pode parar.

---

## Sob demanda e granularidade de cobrança

- **Sob demanda**: sem pagamento antecipado e sem prazo. A tarifa por hora é fixa, e você pode iniciar e parar a qualquer momento.
- O uso sob demanda do EC2 é cobrado **por segundo, com mínimo de 60 segundos**, para Linux, Windows, RHEL e Ubuntu Pro (em 21/11/2026). Alguns sistemas operacionais, como o SUSE Linux Enterprise Server, ainda são cobrados por hora cheia.
- Uma instância que roda por 2 horas, 10 minutos e 30 segundos em Linux paga exatamente esse tempo, sem arredondar para 3 horas.

---

## Savings Plans

Um Savings Plan é um compromisso de gastar um **valor constante em USD por hora** por **1 ou 3 anos**. O que passar do compromisso é cobrado pelas tarifas sob demanda. O pagamento pode ser All Upfront, Partial Upfront ou No Upfront.

| Tipo | Aplica-se a | Flexibilidade | Desconto máximo (de até, em 21/11/2026) |
|------|-------------|---------------|------------------------------------------|
| **Compute Savings Plans** | EC2, AWS Fargate, AWS Lambda | Qualquer família de instância, tamanho, AZ, Região, sistema operacional ou tenancy | 66 por cento |
| **EC2 Instance Savings Plans** | Somente EC2 | Uma família de instância em uma Região; tamanho, AZ, sistema operacional e tenancy podem mudar | 72 por cento |
| **SageMaker Savings Plans** | Uso do Amazon SageMaker AI | Dentro do SageMaker AI | 64 por cento |
| **Database Savings Plans** | Uso elegível de bancos de dados | Somente 1 ano, No Upfront | 35 por cento |

- Os benefícios são **compartilhados em uma organização do AWS Organizations por padrão**. A conta de gerenciamento pode limitar o compartilhamento.
- Os Savings Plans **não reservam capacidade**. Use Capacity Reservations para isso.
- O **uso Spot não é coberto** pelos Savings Plans.
- Não existe Savings Plan para o Amazon S3.

---

## Instâncias reservadas (RIs)

Uma RI é um compromisso com uma configuração de instância constante (tipo de instância e Região) por **1 ou 3 anos**, com pagamento **All Upfront, Partial Upfront ou No Upfront**. Prazo mais longo e mais pagamento antecipado dão um desconto maior.

| | RI Standard | RI Convertible |
|--|-------------|----------------|
| Desconto máximo (de até, em 21/11/2026) | 72 por cento | 66 por cento |
| Pode mudar | AZ, tamanho da instância (Linux), tipo de rede | Família de instância, sistema operacional, tenancy, opção de pagamento |
| Vender o prazo não usado no **Reserved Instance Marketplace** | Sim | Não |

**Capacidade:** somente uma **RI zonal** (comprada para uma AZ específica) reserva capacidade. Uma **RI regional** aplica o desconto ao uso correspondente em qualquer AZ da Região (e entre tamanhos), mas não reserva capacidade.

```text
Zonal RI     -> discount + capacity reserved in us-east-1a
Regional RI  -> discount in any AZ of us-east-1, no capacity reservation
Capacity Reservation -> capacity in one AZ, no discount by itself
```

**No AWS Organizations:** o faturamento consolidado trata todas as contas como uma só, então uma hora de RI não usada, comprada por uma conta, pode dar desconto ao uso correspondente em outra. A conta que fez a compra recebe o benefício primeiro. A **conta de gerenciamento** pode desativar o compartilhamento de descontos de RIs e Savings Plans para contas específicas.

**Outros serviços com reservas** (o Cost Explorer dá recomendações de reserva para eles): Amazon EC2, Amazon RDS, Amazon ElastiCache, Amazon OpenSearch Service, Amazon Redshift, Amazon MemoryDB e Amazon DynamoDB (capacidade reservada). O AWS Lambda e o Amazon S3 não têm reservas.

---

## Instâncias Spot

- O Spot usa **capacidade ociosa do EC2** com até 90 por cento de desconto sobre o preço sob demanda (em 21/11/2026).
- O **Amazon EC2 define o preço Spot** de cada tipo de instância em cada AZ e o ajusta gradualmente com base na oferta e na demanda de longo prazo. Você não dá lances.
- Quando o EC2 precisa da capacidade de volta, você recebe um **aviso de interrupção de dois minutos**, e a instância é encerrada, parada ou hibernada. Uma recomendação de rebalanceamento pode chegar antes, quando o risco aumenta.
- Use para trabalho flexível e interrompível. Nunca para o primário de um banco de dados, um serviço de checkout ou um job que não pode reiniciar.

---

## Dedicated Hosts, Dedicated Instances, Capacity Reservations

| Necessidade | Dedicated Host | Dedicated Instance |
|-------------|----------------|--------------------|
| Cobrança | Por host | Por instância |
| Visibilidade de soquetes e núcleos | Sim | Não |
| Afinidade de host (a instância permanece no mesmo servidor) | Sim | Não |
| Trazer sua própria licença por soquete ou por núcleo | Sim | Apenas parcialmente |

As Dedicated Host Reservations dão até 70 por cento de desconto sobre o preço sob demanda do Dedicated Host. As **Capacity Reservations** mantêm capacidade em uma AZ específica pelo tempo que você precisar; tratam de disponibilidade, não de preço.

---

## Preços de transferência de dados e de armazenamento

```text
Internet ──(in: free)──> AWS Region ──(out to internet: charged)──> Internet
Region A ──(out of A: charged)──> Region B (in: free)
AZ 1 <──(charged in both directions for metered resources)──> AZ 2
```

- Os dados **de entrada vindos da internet** são gratuitos. Os dados **de saída para a internet** são cobrados, em faixas que ficam mais baratas com o volume. Os primeiros 100 GB por mês de saída para a internet são gratuitos atualmente, somados entre serviços e Regiões.
- Entre Regiões, a cobrança incide sobre os dados que **saem da Região de origem**.
- Entre AZs da mesma Região, os recursos medidos pagam pelo tráfego nas duas direções. Alguns serviços têm tráfego gratuito dentro da Região, por exemplo S3 para EC2 na mesma Região.
- O **Amazon S3** cobra armazenamento (tamanho, duração, classe de armazenamento), solicitações e recuperações, transferência de dados, recursos de gerenciamento e replicação. As tarifas por GB caem nas faixas de maior volume.
- O **AWS Lambda** cobra solicitações mais duração em GB-segundos. O **Amazon Lightsail** vende pacotes mensais fixos (computação, armazenamento SSD, franquia de transferência) para uma fatura previsível.

---

## Nível gratuito da AWS (Free Tier) (em 21/11/2026)

- As contas criadas **a partir de 15 de julho de 2025** escolhem um **plano de conta gratuito (Free)** ou um **plano de conta pago (Paid)** no cadastro e recebem **créditos** para gastar em serviços da AWS.
- O **plano Free** dura atualmente até seis meses: termina quando esse período passa ou os créditos acabam, o que ocorrer primeiro, e nunca cobra de você, a menos que você faça upgrade para o Paid. Alguns serviços não estão disponíveis nele.
- As ofertas **Always Free** (mais de 30 serviços, por exemplo as solicitações do Lambda a cada mês) continuam disponíveis com limites mensais e não expiram.
- As contas do **plano Paid** também podem usar **testes** de curta duração de serviços específicos.

> Material de estudo antigo diz que o Free Tier tem três tipos (Always Free, 12 Months Free, Trials) e que o t2.micro é a instância gratuita; a documentação oficial atual diz que esse modelo é o Free Tier **legado**, mantido apenas para contas criadas antes de 15 de julho de 2025 (12 meses a partir da criação da conta, pagamento conforme o uso acima dos limites). As contas novas usam o plano Free ou Paid com créditos.

---

## Atenção

- **O Spot não tem lances.** O EC2 define o preço Spot. Uma questão que fala em "vence o maior lance" usa uma redação ultrapassada.
- **As Scheduled Reserved Instances não podem mais ser compradas.** Elas não são uma opção atual para uma janela noturna ou semanal.
- **Somente as RIs zonais reservam capacidade.** As RIs regionais, os Savings Plans e o Spot não dão garantia de capacidade; as Capacity Reservations dão.
- **Compute vs EC2 Instance Savings Plans:** somente o Compute cobre Fargate e Lambda e se move entre Regiões e famílias. O EC2 Instance fica preso a uma família em uma Região.
- **Somente as RIs Standard** podem ser vendidas no Reserved Instance Marketplace. Isso é um recurso do EC2, não do AWS Marketplace.
- **Dedicated Host, não Dedicated Instance,** para licenças por soquete ou por núcleo.
- **Os dados de entrada são gratuitos; os de saída são cobrados.** O tráfego entre AZs também não é gratuito, e por isso designs Multi-AZ com muita comunicação mostram custos de transferência.
- **O Spot não serve para trabalho que não pode ser interrompido,** mesmo quando a questão diz "menor custo".

---

## Verificação rápida

1. Uma equipe move workloads entre famílias de instância e Regiões e também executa contêineres no Fargate. Qual compromisso? **Compute Savings Plans.**
2. Uma instância reservada regional garante capacidade em uma AZ? **Não. Somente uma RI zonal (ou uma Capacity Reservation) garante.**
3. Quem define o preço Spot? **O Amazon EC2, com base na oferta e na demanda de longo prazo. Não há lance.**
4. Uma empresa envia 5 TB do escritório para o S3. O envio é cobrado como transferência de dados? **Não. Os dados de entrada vindos da internet são gratuitos.**
5. Qual opção do EC2 atende a uma licença de banco de dados por núcleo que precisa permanecer no mesmo servidor físico? **Dedicated Host.**

---

## Documentação oficial

- [Amazon EC2 billing and purchasing options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-purchasing-options.html)
- [Amazon EC2 Reserved Instances pricing](https://aws.amazon.com/ec2/pricing/reserved-instances/)
- [Savings Plans FAQ](https://aws.amazon.com/savingsplans/faq/)
- [Spot Instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-instances.html)
- [Dedicated Hosts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-overview.html)
- [Understanding data transfer charges](https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html)
- [RI and Savings Plans discount sharing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ri-turn-off.html)
- [AWS Free Tier](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)
